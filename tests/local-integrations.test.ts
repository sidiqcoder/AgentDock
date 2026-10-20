import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { findLocalRouter, listModels, quoteShell } from '../server/local-integrations.js';

test('local import reuses only loopback router configuration, leaving cloud credentials alone', () => {
  const provider = findLocalRouter({
    provider: {
      cloud: { options: { baseURL: 'https://cloud.example:20128/v1', apiKey: 'must-not-import' } },
      unrelated: { options: { baseURL: 'http://localhost:9999/v1', apiKey: 'not-the-router' } },
      router9: { options: { baseURL: 'http://localhost:20128/v1', apiKey: 'local-key' } },
    },
  });
  assert.equal(provider?.[0], 'router9');
  assert.equal(
    findLocalRouter({ provider: { cloud: { options: { baseURL: 'https://cloud.example/v1' } } } }),
    undefined,
  );
});
test('router model discovery forwards credentials server-side and deduplicates IDs', async () => {
  let authorization = '';
  const server = createServer((req, res) => {
    authorization = req.headers.authorization || '';
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/empty/models') {
      res.end('{"data":[]}');
      return;
    }
    res.end(
      JSON.stringify({
        data: [{ id: 'ag/model-a' }, { id: 'ag/model-a' }, { id: 'model-b' }, { other: 'ignore' }],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const models = await listModels({
      id: 'router',
      name: 'Router',
      runtime: 'openai',
      baseUrl: baseUrl + '/v1/',
      apiKey: 'private-key',
    });
    assert.deepEqual(models, ['ag/model-a', 'model-b']);
    assert.equal(authorization, 'Bearer private-key');
    await assert.rejects(
      listModels({ id: 'empty', name: 'Empty', runtime: 'openai', baseUrl: baseUrl + '/empty' }),
      /tidak mengembalikan/,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test('launcher paths escape apostrophes as data for PowerShell and POSIX shells', () => {
  assert.equal(quoteShell("C:/O'Brien/app.exe", 'win32'), "'C:/O''Brien/app.exe'");
  assert.equal(quoteShell("/tmp/O'Brien/app", 'linux'), "'/tmp/O'\\''Brien/app'");
});
