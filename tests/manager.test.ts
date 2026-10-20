import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createServer, type RequestListener } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from '../server/store.js';
import { Manager } from '../server/manager.js';
import type { Status } from '../shared/types.js';

async function setup(handler: RequestListener) {
  const base = path.resolve('.cache/test-data');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'agent-dock-'));
  const store = new Store(directory);
  await store.load();
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const manager = new Manager(store, origin);
  const cleanup = async () => {
    try {
      await manager.shutdown();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  };
  return { directory, store, manager, server, origin, cleanup };
}
async function waitFor(manager: Manager, id: string, status: Status, timeout = 15000) {
  const started = Date.now();
  while (manager.get(id).status !== status) {
    if (manager.get(id).status === 'failed' && status !== 'failed')
      throw new Error(manager.get(id).error);
    if (Date.now() - started > timeout)
      throw new Error(`Timed out waiting for ${status}; current: ${manager.get(id).status}`);
    await delay(30);
  }
}
test('model streaming, credentials, conversation follow-up and persistent restart', async () => {
  const requests: { authorization?: string; body: any }[] = [];
  const fixture = await setup(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    requests.push({ authorization: req.headers.authorization, body: JSON.parse(raw) });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'x-ratelimit-remaining-requests': '9',
      'x-ratelimit-limit-requests': '10',
    });
    res.write('data: {"choices":[{"delta":{"content":"Hasil "}}]}\n\n');
    res.end(
      'data: {"choices":[{"delta":{"content":"selesai"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12,"prompt_tokens_details":{"cached_tokens":5}}}\n\ndata: [DONE]\n\n',
    );
  });
  try {
    fixture.store.state.connectors.push({
      id: 'model',
      name: '9router test',
      runtime: 'openai',
      baseUrl: fixture.origin + '/v1',
      model: 'test/model',
      apiKey: 'test-secret',
    });
    const session = fixture.manager.create('model', 'Riset');
    assert.equal(session.status, 'idle');
    await fixture.manager.send(session.id, 'Tugas pertama');
    assert.equal(session.status, 'running');
    await waitFor(fixture.manager, session.id, 'completed');
    assert.equal(session.summary, 'Hasil selesai');
    assert.equal(requests[0].authorization, 'Bearer test-secret');
    assert.equal(requests[0].body.model, 'test/model');
    assert.equal(requests[0].body.stream_options.include_usage, true);
    assert.equal(fixture.store.state.usage?.model.requests, 1);
    assert.equal(fixture.store.state.usage?.model.measuredRequests, 1);
    assert.equal(fixture.store.state.usage?.model.totalTokens, 12);
    assert.equal(fixture.store.state.quotas?.model.windows[0].remaining, 9);
    assert.equal(JSON.stringify(fixture.manager.snapshot()).includes('test-secret'), false);
    await fixture.manager.send(session.id, 'Tugas lanjutan');
    await waitFor(fixture.manager, session.id, 'completed');
    assert.equal(
      requests[1].body.messages.filter((m: { role: string }) => m.role !== 'system').length,
      3,
    );
    const alternate = fixture.manager.create('model', 'Model pilihan sesi', 'test/alternate');
    await fixture.manager.send(alternate.id, 'Tugas model lain');
    await waitFor(fixture.manager, alternate.id, 'completed');
    assert.equal(requests[2].body.model, 'test/alternate');
    assert.equal(fixture.manager.connector('model').model, 'test/model');
    assert.equal(fixture.store.state.usage?.model.totalTokens, 36);
    assert.equal(fixture.store.state.usage?.model.cachedTokens, 15);
    await fixture.store.save();
    const restored = new Store(fixture.directory);
    await restored.load();
    assert.equal(restored.state.sessions.find((s) => s.id === session.id)!.messages.length, 4);
    assert.equal(restored.state.sessions[0].status, 'completed');
    assert.equal(restored.state.usage?.model.requests, 3);
    assert.equal(restored.state.usage?.model.totalTokens, 36);
  } finally {
    await fixture.cleanup();
  }
});
test('usage tracks JSON, missing usage and failed attempts while surviving session deletion', async () => {
  let request = 0;
  const fixture = await setup((_req, res) => {
    request++;
    res.setHeader('Content-Type', 'application/json');
    if (request === 2) {
      res.writeHead(429, {
        'x-ratelimit-remaining-requests': '0',
        'x-ratelimit-limit-requests': '10',
        'x-ratelimit-reset-requests': '30s',
      });
      res.end('{"error":{"message":"limited"}}');
      return;
    }
    res.end(
      JSON.stringify({
        choices: [{ message: { content: 'OK' } }],
        ...(request === 1
          ? { usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 } }
          : {}),
      }),
    );
  });
  try {
    fixture.store.state.connectors.push({
      id: 'usage-model',
      name: 'Usage model',
      runtime: 'openai',
      baseUrl: fixture.origin + '/v1',
      model: 'test',
    });
    const session = fixture.manager.create('usage-model', 'Usage');
    for (const status of ['completed', 'failed', 'completed'] as const) {
      await fixture.manager.send(session.id, 'Check');
      await waitFor(fixture.manager, session.id, status);
    }
    const usage = fixture.store.state.usage!['usage-model'];
    assert.equal(usage.requests, 3);
    assert.equal(usage.measuredRequests, 1);
    assert.equal(usage.totalTokens, 10);
    assert.equal(fixture.store.state.quotas!['usage-model'].windows[0].remaining, 0);
    fixture.manager.removeSession(session.id);
    await fixture.store.save();
    const restored = new Store(fixture.directory);
    await restored.load();
    assert.equal(restored.state.sessions.length, 0);
    assert.equal(restored.state.usage!['usage-model'].totalTokens, 10);
  } finally {
    await fixture.cleanup();
  }
});

test('n8n accepts a task, asks for input, receives a reply, and completes by authenticated callback', async () => {
  let payload: any;
  const fixture = await setup(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    payload = JSON.parse(raw);
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end('{"message":"Workflow was started"}');
  });
  try {
    fixture.store.state.connectors.push({
      id: 'workflow',
      name: 'n8n',
      runtime: 'webhook',
      baseUrl: fixture.origin + '/webhook/test',
    });
    const session = fixture.manager.create('workflow', 'Workflow');
    await fixture.manager.send(session.id, 'Buat rencana');
    for (let i = 0; i < 100 && !payload; i++) await delay(10);
    assert.ok(payload.callbackUrl.includes(session.id));
    assert.throws(
      () => fixture.manager.hook(session.id, payload.runId, 'wrong-token', { status: 'completed' }),
      /tidak valid/,
    );
    fixture.manager.hook(session.id, payload.runId, payload.callbackToken, {
      status: 'waiting',
      question: 'Lanjutkan?',
    });
    assert.equal(session.status, 'waiting');
    assert.equal(session.question, 'Lanjutkan?');
    const token = payload.callbackToken;
    await fixture.manager.send(session.id, 'Ya, lanjutkan');
    await delay(80);
    assert.equal(payload.message, 'Ya, lanjutkan');
    assert.equal(payload.callbackToken, token);
    fixture.manager.hook(session.id, payload.runId, token, {
      status: 'completed',
      summary: 'Rencana siap.',
      message: 'Sudah selesai.',
    });
    assert.equal(session.status, 'completed');
    assert.equal(session.alive, false);
    assert.equal(session.summary, 'Rencana siap.');
    assert.throws(
      () => fixture.manager.hook(session.id, payload.runId, token, { status: 'running' }),
      /tidak valid/,
    );
  } finally {
    await fixture.cleanup();
  }
});
test('stop aborts an in-flight model and prevents late success', async () => {
  const fixture = await setup((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(': keepalive\n\n');
  });
  try {
    fixture.store.state.connectors.push({
      id: 'model',
      name: 'Slow model',
      runtime: 'openai',
      baseUrl: fixture.origin + '/v1',
      model: 'slow',
    });
    const session = fixture.manager.create('model', 'Cancel');
    await fixture.manager.send(session.id, 'Hello');
    await delay(100);
    fixture.manager.stop(session.id);
    await delay(80);
    assert.equal(session.status, 'stopped');
    assert.equal(session.alive, false);
  } finally {
    await fixture.cleanup();
  }
});
test('real PTY lifecycle: stdin, nonzero exit, replay buffer, duplicate-start protection and restart recovery', async () => {
  const fixture = await setup((_req, res) => res.end());
  try {
    const script = path.join(process.cwd(), 'tests/fixture-agent.mjs');
    const command = `${process.platform === 'win32' ? '& ' : ''}'${process.execPath}' '${script}'`;
    fixture.store.state.connectors.push({
      id: 'pty',
      name: 'Test terminal',
      runtime: 'terminal',
      command,
      cwd: process.cwd(),
    });
    const session = fixture.manager.create('pty', 'Terminal');
    const starts = await Promise.allSettled([
      fixture.manager.start(session.id),
      fixture.manager.start(session.id),
    ]);
    assert.equal(starts.filter((s) => s.status === 'fulfilled').length, 1);
    for (let i = 0; i < 200 && !session.output.includes('READY'); i++) await delay(30);
    assert.match(session.output, /READY/);
    fixture.manager.manualStatus(session.id, 'waiting');
    fixture.manager.terminalInput(session.id, 'hello\r');
    await waitFor(fixture.manager, session.id, 'completed');
    assert.ok(session.output.includes('hello'), JSON.stringify(session.output));
    assert.equal(session.summarySource, 'output');
    const exitSession = fixture.manager.create('pty', 'Exit');
    fixture.store.state.connectors.find((c) => c.id === 'pty')!.command =
      process.platform === 'win32' ? 'exit 7' : 'exit 7';
    await fixture.manager.start(exitSession.id);
    await waitFor(fixture.manager, exitSession.id, 'failed');
    assert.match(exitSession.error, /7/);
    const ideConnector = fixture.store.state.connectors.find((c) => c.id === 'pty')!;
    ideConnector.localIntegration = 'antigravity';
    ideConnector.command = 'exit 0';
    const disconnected = fixture.manager.create('pty', 'IDE adapter closed without final hook');
    await fixture.manager.start(disconnected.id);
    await waitFor(fixture.manager, disconnected.id, 'stopped');
    assert.equal(disconnected.alive, false);
    assert.ok(
      disconnected.activity.some((a) => a.text.includes('tidak menandakan tugas IDE selesai')),
    );
    const running = fixture.manager.create('pty', 'Persisted active');
    running.status = 'running';
    running.alive = true;
    await fixture.store.save();
    const restored = new Store(fixture.directory);
    await restored.load();
    assert.equal(restored.state.sessions[0].status, 'stopped');
    assert.equal(restored.state.sessions[0].alive, false);
  } finally {
    await fixture.cleanup();
  }
});

test('one model connector runs concurrent sessions with independent context and cancellation', async () => {
  const pending = new Map<string, import('node:http').ServerResponse>();
  const fixture = await setup(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const conversation = body.messages.filter(
      (message: { role: string }) => message.role !== 'system',
    );
    assert.equal(conversation.length, 1);
    pending.set(conversation[0].content, res);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(': waiting\n\n');
  });
  try {
    fixture.store.state.connectors.push({
      id: 'shared',
      name: 'Shared model',
      runtime: 'openai',
      baseUrl: fixture.origin + '/v1',
      model: 'test',
    });
    const first = fixture.manager.create('shared', 'First');
    const second = fixture.manager.create('shared', 'Second');
    await Promise.all([
      fixture.manager.send(first.id, 'task-one'),
      fixture.manager.send(second.id, 'task-two'),
    ]);
    for (let i = 0; i < 200 && pending.size < 2; i++) await delay(20);
    assert.equal(pending.size, 2);
    assert.equal(first.alive, true);
    assert.equal(second.alive, true);
    assert.notEqual(first.runId, second.runId);
    fixture.manager.stop(first.id);
    assert.equal(second.status, 'running');
    pending
      .get('task-two')!
      .end(
        'data: {"choices":[{"delta":{"content":"second result"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      );
    await waitFor(fixture.manager, second.id, 'completed');
    assert.equal(first.status, 'stopped');
    assert.deepEqual(first.messages.map((message) => message.content).filter(Boolean), [
      'task-one',
    ]);
    assert.deepEqual(
      second.messages.map((message) => message.content),
      ['task-two', 'second result'],
    );
    await fixture.store.save();
    const restored = new Store(fixture.directory);
    await restored.load();
    assert.equal(
      restored.state.sessions.find((session) => session.id === second.id)!.summary,
      'second result',
    );
  } finally {
    await fixture.cleanup();
  }
});

test('parallel terminals stay isolated and earlier runs survive relaunch and store reload', async () => {
  const fixture = await setup((_req, res) => res.end());
  try {
    const script = path.join(process.cwd(), 'tests/fixture-agent.mjs');
    fixture.store.state.connectors.push({
      id: 'parallel-pty',
      name: 'Parallel CLI',
      runtime: 'terminal',
      cwd: process.cwd(),
      command: `${process.platform === 'win32' ? '& ' : ''}'${process.execPath}' '${script}'`,
    });
    const first = fixture.manager.create('parallel-pty', 'First terminal');
    const second = fixture.manager.create('parallel-pty', 'Second terminal');
    await Promise.all([fixture.manager.start(first.id), fixture.manager.start(second.id)]);
    for (
      let i = 0;
      i < 300 && (!first.output.includes('READY') || !second.output.includes('READY'));
      i++
    )
      await delay(30);
    assert.match(first.output, /READY/);
    assert.match(second.output, /READY/);
    const originalRun = first.runId;
    fixture.manager.terminalInput(first.id, 'first-task\r');
    await waitFor(fixture.manager, first.id, 'completed');
    assert.equal(second.alive, true);
    assert.doesNotMatch(second.output, /first-task/);
    const originalOutput = first.output;
    const originalSummary = first.summary;
    await fixture.manager.start(first.id);
    assert.notEqual(first.runId, originalRun);
    assert.equal(first.runs?.length, 1);
    assert.equal(first.runs![0].id, originalRun);
    assert.equal(first.runs![0].output, originalOutput);
    assert.equal(first.runs![0].summary, originalSummary);
    assert.equal(first.runs![0].status, 'completed');
    assert.equal(
      fixture.manager.snapshot().sessions.find((session) => session.id === first.id)!.runs![0]
        .output,
      '',
    );
    fixture.manager.stop(first.id);
    fixture.manager.terminalInput(second.id, 'second-task\r');
    await waitFor(fixture.manager, second.id, 'completed');
    assert.match(second.output, /second-task/);
    await fixture.store.save();
    const restored = new Store(fixture.directory);
    await restored.load();
    assert.equal(
      restored.state.sessions.find((session) => session.id === first.id)!.runs![0].output,
      originalOutput,
    );
  } finally {
    await fixture.cleanup();
  }
});

test('terminal directories are independent per session, validated before launch and preserved in history', async () => {
  const fixture = await setup((_req, res) => res.end());
  try {
    const firstDirectory = path.join(fixture.directory, 'proyek satu');
    const secondDirectory = path.join(fixture.directory, 'proyek dua');
    await Promise.all([mkdir(firstDirectory), mkdir(secondDirectory)]);
    const script = path.resolve('tests/fixture-agent.mjs');
    const connector = {
      id: 'projects',
      name: 'Project agent',
      runtime: 'terminal' as const,
      cwd: process.cwd(),
      command: `${process.platform === 'win32' ? '& ' : ''}'${process.execPath}' '${script}'`,
    };
    fixture.store.state.connectors.push(connector);
    const first = fixture.manager.create(connector.id, 'First', undefined, firstDirectory);
    const second = fixture.manager.create(connector.id, 'Second', undefined, secondDirectory);
    const defaults = fixture.manager.create(connector.id, 'Default');
    assert.equal(defaults.cwd, process.cwd());
    const missing = path.join(fixture.directory, 'missing');
    await assert.rejects(fixture.manager.start(first.id, missing), /tidak ditemukan/);
    await assert.rejects(fixture.manager.start(first.id, script), /bukan direktori/);
    assert.equal(first.status, 'idle');
    assert.equal(first.cwd, firstDirectory);
    assert.equal(fixture.manager.handles.has(first.id), false);
    await Promise.all([fixture.manager.start(first.id), fixture.manager.start(second.id)]);
    for (
      let i = 0;
      i < 300 && (!first.output.includes('CWD:') || !second.output.includes('CWD:'));
      i++
    )
      await delay(30);
    assert.ok(first.output.includes(`CWD:${firstDirectory}`), first.output);
    assert.ok(second.output.includes(`CWD:${secondDirectory}`), second.output);
    await assert.rejects(fixture.manager.start(first.id, secondDirectory), /masih aktif/);
    assert.equal(first.cwd, firstDirectory);
    fixture.manager.terminalInput(first.id, 'done\r');
    await waitFor(fixture.manager, first.id, 'completed');
    const previousRun = first.runId;
    await assert.rejects(fixture.manager.start(first.id, missing), /tidak ditemukan/);
    assert.equal(first.runId, previousRun);
    assert.equal(first.runs?.length || 0, 0);
    await fixture.manager.start(first.id, secondDirectory);
    assert.equal(first.cwd, secondDirectory);
    assert.equal(first.runs![0].cwd, firstDirectory);
    assert.equal(second.cwd, secondDirectory);
    assert.equal(connector.cwd, process.cwd());
    await fixture.store.save();
    const restored = new Store(fixture.directory);
    await restored.load();
    assert.equal(restored.state.sessions.find((s) => s.id === first.id)!.cwd, secondDirectory);
    assert.equal(
      restored.state.sessions.find((s) => s.id === first.id)!.runs![0].cwd,
      firstDirectory,
    );
    for (let i = 0; i < 300 && !first.output.includes('READY'); i++) await delay(30);
    fixture.manager.terminalInput(first.id, 'done again\r');
    fixture.manager.terminalInput(second.id, 'done too\r');
    await Promise.all([
      waitFor(fixture.manager, first.id, 'completed'),
      waitFor(fixture.manager, second.id, 'completed'),
    ]);
    // Sessions saved before directory selection existed still use the connector default.
    delete defaults.cwd;
    await fixture.manager.start(defaults.id);
    assert.equal(defaults.cwd, connector.cwd);
    for (let i = 0; i < 300 && !defaults.output.includes('READY'); i++) await delay(30);
    fixture.manager.terminalInput(defaults.id, 'default done\r');
    await waitFor(fixture.manager, defaults.id, 'completed');
  } finally {
    await fixture.cleanup();
  }
});

test('project agent executes approved tools, sends observations back and accounts for every model step', async () => {
  const requests: any[] = [];
  const calls = [
    { name: 'create_directory', arguments: '{"path":"docs"}' },
    { name: 'write_file', arguments: '{"path":"docs/README.md","content":"# Documentation"}' },
    { name: 'read_file', arguments: '{"path":"docs/README.md"}' },
  ];
  const fixture = await setup(async (req, res) => {
    let raw = '';
    for await (const part of req) raw += part;
    const body = JSON.parse(raw);
    requests.push(body);
    const call = calls[requests.length - 1];
    res.setHeader('Content-Type', 'text/event-stream');
    res.end(
      `data: ${JSON.stringify({ choices: [{ delta: call ? { tool_calls: [{ index: 0, id: `call-${requests.length}`, type: 'function', function: call }] } : { content: 'Dokumentasi dibuat dan dibaca.' }, finish_reason: call ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } })}\n\ndata: [DONE]\n\n`,
    );
  });
  try {
    const root = path.join(fixture.directory, 'workspace');
    await mkdir(root);
    fixture.store.state.connectors.push({
      id: 'agent',
      name: 'Project model',
      runtime: 'openai',
      baseUrl: fixture.origin + '/v1',
      model: 'test',
    });
    const session = fixture.manager.create('agent', 'Project', undefined, root, true);
    await fixture.manager.send(session.id, 'Buat dokumentasi');
    await waitFor(fixture.manager, session.id, 'waiting');
    assert.equal(session.pendingAction!.tool, 'create_directory');
    const firstAction = session.pendingAction!.id;
    await assert.rejects(readFile(path.join(root, 'docs/README.md')), { code: 'ENOENT' });
    await assert.rejects(fixture.manager.configureProject(session.id, false), /Hentikan/);
    fixture.manager.approve(session.id, firstAction, true);
    assert.throws(() => fixture.manager.approve(session.id, firstAction, true), /tidak berlaku/);
    await waitFor(fixture.manager, session.id, 'waiting');
    assert.equal(session.pendingAction!.content, '# Documentation');
    fixture.manager.approve(session.id, session.pendingAction!.id, true);
    await waitFor(fixture.manager, session.id, 'completed');
    assert.equal(session.pendingAction, undefined);
    assert.equal(await readFile(path.join(root, 'docs/README.md'), 'utf8'), '# Documentation');
    assert.equal(requests.length, 4);
    assert.equal(requests[0].tools.length, 4);
    assert.ok(JSON.parse(requests[1].messages.at(-1).content).success);
    assert.equal(JSON.parse(requests[3].messages.at(-1).content).content, '# Documentation');
    assert.equal(fixture.store.state.usage!.agent.requests, 4);
    assert.equal(fixture.store.state.usage!.agent.totalTokens, 20);
    assert.match(session.summary, /dibuat/);
  } finally {
    await fixture.cleanup();
  }
});

for (const decision of ['denied', 'stopped'] as const) {
  test(`pending project writes remain unapplied when ${decision}`, async () => {
    let requests = 0;
    const fixture = await setup(async (req, res) => {
      let raw = '';
      for await (const part of req) raw += part;
      const body = JSON.parse(raw);
      requests++;
      res.setHeader('Content-Type', 'application/json');
      if (requests === 1)
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: 'write',
                      type: 'function',
                      function: {
                        name: 'write_file',
                        arguments: '{"path":"new.md","content":"hello"}',
                      },
                    },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
          }),
        );
      else {
        assert.ok(JSON.parse(body.messages.at(-1).content).denied);
        res.end(
          '{"choices":[{"message":{"content":"Perubahan ditolak."},"finish_reason":"stop"}]}',
        );
      }
    });
    try {
      fixture.store.state.connectors.push({
        id: 'agent',
        name: 'Agent',
        runtime: 'openai',
        baseUrl: fixture.origin,
        model: 'test',
      });
      const session = fixture.manager.create('agent', 'Agent', undefined, fixture.directory, true);
      await fixture.manager.send(session.id, 'write');
      await waitFor(fixture.manager, session.id, 'waiting');
      const action = session.pendingAction!.id;
      await fixture.store.save();
      const restored = new Store(fixture.directory);
      await restored.load();
      assert.equal(restored.state.sessions[0].pendingAction, undefined);
      assert.equal(restored.state.sessions[0].status, 'stopped');
      if (decision === 'denied') {
        fixture.manager.approve(session.id, action, false);
        await waitFor(fixture.manager, session.id, 'completed');
      } else {
        fixture.manager.stop(session.id);
        await delay(40);
      }
      assert.equal(session.pendingAction, undefined);
      assert.equal(session.alive, false);
      assert.throws(() => fixture.manager.approve(session.id, action, true), /tidak berlaku/);
      await assert.rejects(readFile(path.join(fixture.directory, 'new.md')), { code: 'ENOENT' });
    } finally {
      await fixture.cleanup();
    }
  });
}

test('reasoning-only failures leave no empty assistant messages and subsequent text requests recover', async () => {
  const bodies: any[] = [];
  const fixture = await setup(async (req, res) => {
    let raw = '';
    for await (const part of req) raw += part;
    bodies.push(JSON.parse(raw));
    res.setHeader('Content-Type', 'application/json');
    res.end(
      bodies.length === 1
        ? '{"choices":[{"message":{"content":"","reasoning_content":"do not expose"},"finish_reason":"malformed_function_call"}]}'
        : '{"choices":[{"message":{"content":"AGENT_DOCK_OK"},"finish_reason":"stop"}],"usage":{"total_tokens":3}}',
    );
  });
  try {
    fixture.store.state.connectors.push({
      id: 'model',
      name: 'Model',
      runtime: 'openai',
      baseUrl: fixture.origin,
      model: 'test',
    });
    const session = fixture.manager.create('model', 'Retry');
    await fixture.manager.send(session.id, 'create folder');
    await waitFor(fixture.manager, session.id, 'failed');
    assert.match(session.error, /malformed_function_call/);
    assert.equal(session.messages.length, 1);
    assert.ok(!JSON.stringify(fixture.manager.snapshot()).includes('do not expose'));
    const result = await fixture.manager.testConnection('model');
    assert.equal(result.ok, true);
    assert.equal(session.status, 'failed');
    assert.equal(session.messages.length, 1);
    await fixture.manager.send(session.id, 'hello');
    await waitFor(fixture.manager, session.id, 'completed');
    assert.ok(bodies[2].messages.every((message: { content: string }) => message.content.trim()));
    assert.equal(bodies[2].tools, undefined);
    assert.equal(session.error, '');
    assert.equal(fixture.store.state.usage!.model.requests, 3);
  } finally {
    await fixture.cleanup();
  }
});

test('terminal run history survives storage and recovery without bloating dashboard snapshots', async () => {
  const fixture = await setup((_req, res) => res.end());
  try {
    const first = fixture.manager.create('codex', '');
    const second = fixture.manager.create('codex', '');
    assert.equal(first.name, 'Codex');
    assert.equal(second.name, 'Codex (2)');
    first.runs = [
      {
        id: 'old-run',
        startedAt: '2026-01-01T00:00:00.000Z',
        endedAt: '2026-01-01T00:01:00.000Z',
        status: 'completed',
        output: 'saved terminal transcript',
        summary: 'Prior result',
        summarySource: 'agent',
        error: '',
      },
    ];
    first.output = 'current transcript';
    first.status = 'running';
    first.alive = true;
    first.updatedAt = '2026-01-01T00:02:00.000Z';
    await fixture.store.save();
    const restored = new Store(fixture.directory);
    await restored.load();
    const recovered = restored.state.sessions.find((session) => session.id === first.id)!;
    assert.equal(recovered.status, 'stopped');
    assert.equal(recovered.alive, false);
    assert.ok(recovered.updatedAt > '2026-01-01T00:02:00.000Z');
    assert.equal(recovered.runs![0].output, 'saved terminal transcript');
    assert.equal(recovered.runs![0].summary, 'Prior result');
    assert.equal(recovered.output, 'current transcript');
    const manager = new Manager(restored, fixture.origin);
    const snapshot = manager.snapshot().sessions.find((session) => session.id === first.id)!;
    assert.equal(snapshot.runs![0].output, '');
    assert.equal(snapshot.output, '');
    assert.equal(snapshot.runs![0].summary, 'Prior result');
    assert.equal(recovered.runs![0].output, 'saved terminal transcript');
    manager.removeSession(first.id);
    await restored.save();
    const deleted = new Store(fixture.directory);
    await deleted.load();
    assert.equal(
      deleted.state.sessions.some((session) => session.id === first.id),
      false,
    );
  } finally {
    await fixture.cleanup();
  }
});
