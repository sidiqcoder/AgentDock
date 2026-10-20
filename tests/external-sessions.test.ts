import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseOpenCodeSessionList,
  parseOpenCodeExport,
  buildResumeCommand,
  resolveExecArgs,
} from '../server/external-sessions.js';
import { Manager, detectTerminalPrompt } from '../server/manager.js';
import { Store } from '../server/store.js';

test('parseOpenCodeSessionList parses valid JSON array, handles text prefix, and sorts by update time', () => {
  const sample = `
Some log output from CLI
[
  {
    "id": "ses_old",
    "title": "Old Session",
    "directory": "D:\\\\Old",
    "created": 1700000000000,
    "updated": 1700001000000
  },
  {
    "id": "ses_new",
    "title": "New Session",
    "directory": "D:\\\\New",
    "created": 1700002000000,
    "updated": 1700003000000
  }
]`;
  const result = parseOpenCodeSessionList(sample);
  assert.equal(result.length, 2);
  assert.equal(result[0].id, 'ses_new');
  assert.equal(result[0].title, 'New Session');
  assert.equal(result[0].directory, 'D:\\New');
  assert.equal(result[0].agent, 'opencode');
  assert.equal(result[1].id, 'ses_old');

  // Corrupted or empty output
  assert.deepEqual(parseOpenCodeSessionList('No sessions'), []);
  assert.deepEqual(parseOpenCodeSessionList(''), []);
});

test('parseOpenCodeExport parses transcript, strips preamble, and extracts user/assistant text', () => {
  const exportPayload = `Exporting session: ses_123
{
  "info": {
    "id": "ses_123",
    "title": "Akses Session",
    "directory": "D:\\\\Proyek",
    "time": {
      "created": 1792500000000,
      "updated": 1792500050000
    },
    "model": {
      "providerID": "router9",
      "modelID": "ag/gemini-3.8-flash"
    }
  },
  "messages": [
    {
      "info": {
        "id": "msg_u1",
        "role": "user",
        "time": { "created": 1792500000100 }
      },
      "parts": [
        { "type": "text", "text": "Halo tolong bantu saya." }
      ]
    },
    {
      "info": {
        "id": "msg_a1",
        "role": "assistant",
        "time": { "created": 1792500002000 }
      },
      "parts": [
        { "type": "step-start" },
        { "type": "reasoning", "text": "Thinking..." },
        { "type": "text", "text": "Tentu, apa yang bisa saya bantu?" },
        { "type": "step-finish" }
      ]
    }
  ]
}`;
  const parsed = parseOpenCodeExport(exportPayload);
  assert.equal(parsed.id, 'ses_123');
  assert.equal(parsed.title, 'Akses Session');
  assert.equal(parsed.directory, 'D:\\Proyek');
  assert.equal(parsed.model, 'router9/ag/gemini-3.8-flash');
  assert.equal(parsed.messages.length, 2);
  assert.equal(parsed.messages[0].role, 'user');
  assert.equal(parsed.messages[0].content, 'Halo tolong bantu saya.');
  assert.equal(parsed.messages[1].role, 'assistant');
  assert.equal(parsed.messages[1].content, 'Tentu, apa yang bisa saya bantu?');
  assert.equal(parsed.summary, 'Tentu, apa yang bisa saya bantu?');
});

test('buildResumeCommand generates correct CLI flags and sanitized session ID', () => {
  const cmdOpenCode = buildResumeCommand('opencode', 'opencode', 'ses_abc123');
  assert.match(cmdOpenCode, /-s ses_abc123$/);

  const cmdCodex = buildResumeCommand('codex', 'codex', 'ses_xyz789');
  assert.match(cmdCodex, /resume ses_xyz789 --no-alt-screen --no-daemon/);
});

test('resolveExecArgs passes direct executable or cmd wrapper on Windows', () => {
  const resolved = resolveExecArgs('my-agent.exe', ['arg1', 'arg2']);
  assert.equal(resolved.file, 'my-agent.exe');
  assert.deepEqual(resolved.fileArgs, ['arg1', 'arg2']);
});

test('Manager creates session with resume command and external metadata', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'agent-dock-test-'));
  try {
    const store = new Store(dir);
    await store.load();
    store.state.connectors = [
      { id: 'local-opencode', name: 'OpenCode · lokal', runtime: 'terminal', command: 'opencode' },
    ];
    const manager = new Manager(store, 'http://127.0.0.1:4310');
    const session = manager.create(
      'local-opencode',
      'Resumed Session',
      undefined,
      process.cwd(),
      false,
      {
        command: 'opencode -s ses_test123',
        externalSessionId: 'ses_test123',
        externalAgent: 'opencode',
        messages: [{ id: 'm1', role: 'user', content: 'test user', at: new Date().toISOString() }],
        summary: 'Previous summary',
      },
    );

    assert.equal(session.command, 'opencode -s ses_test123');
    assert.equal(session.externalSessionId, 'ses_test123');
    assert.equal(session.externalAgent, 'opencode');
    assert.equal(session.messages.length, 1);
    assert.equal(session.summary, 'Previous summary');
    assert.match(session.activity[0].text, /ses_test123/);
    await manager.shutdown();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('detectTerminalPrompt detects permission requests and interactive questions', () => {
  assert.equal(
    detectTerminalPrompt('Allow bash command npm test? [y/n]'),
    'Allow bash command npm test? [y/n]',
  );
  assert.equal(
    detectTerminalPrompt('Do you want to execute this command? (y/n)'),
    'Do you want to execute this command? (y/n)',
  );
  assert.equal(
    detectTerminalPrompt('Allow Codex to run this command? (y)es / (n)o'),
    'Allow Codex to run this command? (y)es / (n)o',
  );
  assert.equal(
    detectTerminalPrompt("? Allow bash command 'git status'\n  > Allow once\n    Deny"),
    "? Allow bash command 'git status'",
  );
  // Non-prompt logs should not trigger
  assert.equal(detectTerminalPrompt('Compiling src/index.ts... done in 200ms'), undefined);
  assert.equal(detectTerminalPrompt('Running test suite [1/10] tests passed'), undefined);
  assert.equal(detectTerminalPrompt(''), undefined);
});
