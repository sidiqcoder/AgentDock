import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

test('IDE callback helper authenticates without exposing tokens and rejects stale task IDs', async () => {
  let calls = 0;
  let received: unknown;
  let authorization = '';
  const server = createServer(async (req, res) => {
    calls++;
    authorization = req.headers.authorization || '';
    let raw = '';
    for await (const chunk of req) raw += chunk;
    received = JSON.parse(raw);
    res.end('{"ok":true}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = path.resolve('.cache/test-data');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'ide-handoff-'));
  const file = path.join(directory, 'current.json');
  const run = (taskId: string) =>
    new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [path.resolve('scripts/report-ide.mjs'), file, taskId, 'completed', 'Hasil siap.'],
        { windowsHide: true },
      );
      let output = '';
      child.stdout.on('data', (data) => {
        output += data;
      });
      child.stderr.on('data', (data) => {
        output += data;
      });
      child.once('error', reject);
      child.once('close', (code) => resolve({ code, output }));
    });
  try {
    await writeFile(
      file,
      JSON.stringify({
        taskId: 'current-task',
        url: `http://127.0.0.1:${(server.address() as { port: number }).port}/hook`,
        token: 'private-callback-token',
      }),
    );
    const good = await run('current-task');
    assert.equal(good.code, 0);
    assert.equal(authorization, 'Bearer private-callback-token');
    assert.deepEqual(received, { status: 'completed', summary: 'Hasil siap.' });
    assert.equal(good.output.includes('private-callback-token'), false);
    const stale = await run('old-task');
    assert.equal(stale.code, 1);
    assert.equal(calls, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
