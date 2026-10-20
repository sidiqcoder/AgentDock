import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseCodexLimits, readCodexLog, readCodexAccount } from '../server/codex-quota.js';
import { ageQuota, readRateLimitHeaders, readTokenUsage } from '../server/usage.js';
import { readRouterUsage, UsageService } from '../server/usage-report.js';
import { consumeChatStream } from '../server/protocol.js';
import { Store } from '../server/store.js';
import type { TokenUsage } from '../shared/types.js';

async function temporary() {
  await mkdir('.cache/test-data', { recursive: true });
  return mkdtemp(path.resolve('.cache/test-data/usage-'));
}

test('usage preserves absent data, accepts real zeroes, and keeps cached tokens inside input', () => {
  assert.equal(readTokenUsage(null), undefined);
  assert.equal(readTokenUsage({}), undefined);
  assert.equal(readTokenUsage({ total_tokens: -2, prompt_tokens: '20' }), undefined);
  assert.deepEqual(
    readTokenUsage({
      prompt_tokens: 100,
      completion_tokens: 0,
      prompt_tokens_details: { cached_tokens: 80 },
    }),
    {
      inputTokens: 100,
      outputTokens: 0,
      totalTokens: 100,
      cachedTokens: 80,
    },
  );
  assert.equal(readTokenUsage({ total_tokens: 0 })?.totalTokens, 0);
  assert.equal(readTokenUsage({ input_tokens: 10 })?.outputTokens, undefined);
});

test('SSE reports usage-only chunks without confusing them with assistant text', async () => {
  const source =
    'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\r\n\r\ndata: {"choices":[],"usage":{"prompt_tokens":8,"completion_tokens":2,"total_tokens":10}}\r\n\r\ndata: [DONE]\r\n\r\n';
  let text = '';
  const recorded: { tokens?: TokenUsage } = {};
  await consumeChatStream(
    new ReadableStream({
      start(controller) {
        const bytes = new TextEncoder().encode(source);
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    }),
    (chunk) => {
      text += chunk;
    },
    (usage) => {
      recorded.tokens = usage;
    },
  );
  assert.equal(text, 'OK');
  assert.equal(recorded.tokens?.totalTokens, 10);
});

test('rate-limit headers retain exhausted limits and do not fabricate missing values or resets', () => {
  const now = Date.parse('2026-10-20T04:00:00Z');
  assert.equal(readRateLimitHeaders(new Headers(), 'model', now), undefined);
  assert.equal(
    readRateLimitHeaders(new Headers({ 'x-ratelimit-remaining-tokens': '' }), 'model', now),
    undefined,
  );
  const quota = readRateLimitHeaders(
    new Headers({
      'x-ratelimit-limit-requests': '60',
      'x-ratelimit-remaining-requests': '0',
      'x-ratelimit-reset-requests': '1h2m3.5s',
      'x-ratelimit-remaining-tokens': '200',
      'x-ratelimit-reset-tokens': 'invalid',
      'x-ratelimit-limit-project-tokens': '500',
      'x-ratelimit-remaining-project-tokens': '300',
    }),
    'model-a',
    now,
  )!;
  assert.equal(quota.windows[0].remaining, 0);
  assert.equal(quota.windows[0].resetsAt, '2026-10-20T05:02:03.500Z');
  assert.equal(quota.windows[1].limit, undefined);
  assert.equal(quota.windows[1].resetsAt, undefined);
  assert.equal(quota.windows[2].remaining, 300);
  const aged = ageQuota(quota, now + 600001);
  assert.equal(aged.status, 'stale');
  assert.equal(aged.windows[0].remaining, 0);
});

test('Codex respects multiple buckets, missing windows, and real window durations', () => {
  const observed = new Date().toISOString();
  const result = parseCodexLimits(
    {
      rateLimitsByLimitId: {
        codex: { planType: 'plus', primary: { usedPercent: 85, windowDurationMins: 10080 } },
        additional: { primary: { usedPercent: 100, windowDurationMins: 300 }, secondary: null },
      },
    },
    observed,
    'test',
  );
  assert.equal(result.plan, 'plus');
  assert.equal(result.windows.length, 2);
  assert.equal(result.windows[0].remaining, 15);
  assert.match(result.windows[0].label, /7 hari/);
  assert.match(result.windows[1].label, /5 jam/);
  assert.equal(result.windows[1].remaining, 0);
  const legacy = parseCodexLimits(
    { limit_id: 'codex', primary: { used_percent: 12, window_minutes: 300 } },
    observed,
    'log',
  );
  assert.equal(legacy.windows[0].remaining, 88);
  assert.equal(parseCodexLimits({}, observed, 'none').status, 'unavailable');
});

test('Codex local fallback selects latest token event and tolerates partial JSONL without exposing chat', async () => {
  const directory = await temporary();
  try {
    await mkdir(path.join(directory, '2026/10/20'), { recursive: true });
    const events = [
      { type: 'response_item', secret: 'private prompt must never appear' },
      {
        type: 'event_msg',
        timestamp: new Date().toISOString(),
        payload: {
          type: 'token_count',
          rate_limits: { primary: { used_percent: 30, window_minutes: 300 } },
        },
      },
    ];
    await writeFile(
      path.join(directory, '2026/10/20/latest.jsonl'),
      events.map((e) => JSON.stringify(e)).join('\n') + '\n{"partial":',
    );
    const quota = await readCodexLog(directory);
    assert.equal(quota?.windows[0].remaining, 70);
    assert.equal(JSON.stringify(quota).includes('private prompt'), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Codex account helper handles missing executables without leaking native errors', async () => {
  await assert.rejects(
    readCodexAccount(path.resolve('.cache/no-such-codex-executable')),
    /Pembacaan akun Codex/,
  );
});

test('router reads retained daily totals without credentials, creating files, or double-counting cached input', async () => {
  const directory = await temporary();
  const file = path.join(directory, 'router.sqlite');
  try {
    const db = new DatabaseSync(file);
    db.exec(
      'CREATE TABLE usageDaily (dateKey TEXT, data TEXT); CREATE TABLE providerConnections (data TEXT)',
    );
    db.prepare('INSERT INTO providerConnections VALUES (?)').run(
      '{"accessToken":"private-secret"}',
    );
    const insert = db.prepare('INSERT INTO usageDaily VALUES (?, ?)');
    insert.run(
      '2026-10-19',
      JSON.stringify({
        requests: 2,
        promptTokens: 100,
        completionTokens: 20,
        cachedTokens: 80,
        byProvider: { antigravity: { requests: 2, promptTokens: 100, completionTokens: 20 } },
      }),
    );
    insert.run(
      '2026-10-20',
      JSON.stringify({
        requests: 1,
        promptTokens: 40,
        completionTokens: 5,
        byProvider: { antigravity: { requests: 1, promptTokens: 40, completionTokens: 5 } },
      }),
    );
    db.close();
    const before = await readFile(file);
    const usage = await readRouterUsage(file);
    assert.equal(usage.requests, 3);
    assert.equal(usage.totalTokens, 165);
    assert.equal(usage.cachedTokens, 80);
    assert.equal(usage.providers[0].requests, 3);
    assert.equal(JSON.stringify(usage).includes('private-secret'), false);
    assert.deepEqual(await readFile(file), before);
    const missing = path.join(directory, 'missing.sqlite');
    await assert.rejects(readRouterUsage(missing));
    await assert.rejects(readFile(missing), { code: 'ENOENT' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('usage report isolates adapters, deduplicates concurrent reads, and works with older state', async () => {
  const store = new Store('unused');
  store.state.connectors = [
    { id: 'codex', name: 'Codex', runtime: 'terminal', apiKey: 'do-not-expose' },
    {
      id: 'router',
      name: 'Router',
      runtime: 'openai',
      localIntegration: '9router',
      baseUrl: 'http://127.0.0.1:20128/v1',
    },
    { id: 'cli', name: 'CLI', runtime: 'terminal' },
  ];
  let reads = 0;
  const service = new UsageService(store, {
    codex: async () => {
      reads++;
      throw new Error('private-server-message');
    },
    router: async () => ({ requests: 10, source: 'fixture', note: 'test', providers: [] }),
  });
  const reports = await Promise.all([service.report(), service.report()]);
  assert.equal(reads, 1);
  assert.equal(reports[0].entries[0].quota.status, 'error');
  assert.equal(reports[0].entries[2].local, undefined);
  assert.equal(reports[0].entries[2].quota.status, 'unavailable');
  assert.equal(reports[0].router?.requests, 10);
  assert.equal(JSON.stringify(reports).includes('private'), false);
  assert.equal(JSON.stringify(reports).includes('do-not-expose'), false);
});
