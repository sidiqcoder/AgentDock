import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

test('native IDE bridge acknowledges the actual panel command and rejects unauthenticated requests', async () => {
  const root = path.resolve('.cache/test-data');
  await mkdir(root, { recursive: true });
  const workspace = await mkdtemp(path.join(root, 'native-bridge-'));
  const source = await readFile('extensions/antigravity-bridge/extension.cjs', 'utf8');
  const calls: { command: string; prompt: string }[] = [];
  const vscode = {
    workspace: {
      workspaceFolders: [{ uri: { scheme: 'file', fsPath: workspace } }],
      isTrusted: true,
    },
    commands: {
      getCommands: async () => ['antigravity.sendPromptToAgentPanel'],
      registerCommand: () => ({ dispose() {} }),
      executeCommand: async (command: string, prompt: string) => {
        calls.push({ command, prompt });
      },
    },
    window: {
      createOutputChannel: () => ({ appendLine() {}, dispose() {} }),
      createStatusBarItem: () => ({ show() {}, dispose() {} }),
    },
    StatusBarAlignment: { Right: 1 },
  };
  const exports: any = {};
  const require = createRequire(import.meta.url);
  runInNewContext(source, {
    exports,
    Buffer,
    require: (name: string) => (name === 'vscode' ? vscode : require(name)),
  });
  const { sendIdePrompt } = await import(
    pathToFileURL(path.resolve('scripts/ide-client.mjs')).href
  );
  try {
    await assert.rejects(
      sendIdePrompt(workspace, 'Must not be silently accepted'),
      /Bridge Antigravity belum aktif/,
    );
    await exports.activate({ subscriptions: [] });
    const result = await sendIdePrompt(workspace, 'AGENT_DOCK_NATIVE_DELIVERY_TEST');
    assert.equal(result.accepted, true);
    assert.deepEqual(calls, [
      { command: 'antigravity.sendPromptToAgentPanel', prompt: 'AGENT_DOCK_NATIVE_DELIVERY_TEST' },
    ]);
    const pairing = JSON.parse(
      await readFile(path.join(workspace, '.data/antigravity-bridge.json'), 'utf8'),
    );
    const denied = await fetch(pairing.url + '/prompt', {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-token' },
      body: '{"prompt":"not allowed"}',
    });
    assert.equal(denied.status, 403);
    vscode.workspace.isTrusted = false;
    await assert.rejects(sendIdePrompt(workspace, 'Do not bypass trust'), /trust/);
    assert.equal(calls.length, 1);
    const health = await (
      await fetch(pairing.url + '/health', {
        headers: { Authorization: `Bearer ${pairing.token}` },
      })
    ).json();
    assert.equal(health.accepted, 1);
    assert.equal(JSON.stringify(health).includes(pairing.token), false);
  } finally {
    await exports.deactivate();
    await rm(workspace, { recursive: true, force: true });
  }
});
