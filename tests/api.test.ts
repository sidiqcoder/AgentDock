import test from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../src/api.js';

test('folder picker explains when the running server does not support its endpoint', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ error: 'Endpoint tidak ditemukan.' }, { status: 404 }),
  );
  await assert.rejects(
    api('/directories?path=D%3A%5CProyek'),
    /server Agent Dock.*jalankan kembali/,
  );
});

test('API preserves folder validation and resource errors', async (t) => {
  for (const [status, error] of [
    [400, 'Direktori tidak ditemukan atau tidak dapat diakses: D:\\missing'],
    [404, 'Riwayat proses tidak ditemukan.'],
  ] as const) {
    const mock = t.mock.method(globalThis, 'fetch', async () =>
      Response.json({ error }, { status }),
    );
    await assert.rejects(api('/directories'), { message: error });
    mock.mock.restore();
  }
});

test('folder picker sends the encoded workspace path and returns the listing', async (t) => {
  const workspace = 'D:\\Proyek\\proyek & satu';
  const listing = { path: workspace, parent: 'D:\\Proyek', directories: [], shortcuts: [] };
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    assert.equal(url, `/api/directories?path=${encodeURIComponent(workspace)}`);
    return Response.json(listing);
  });
  assert.deepEqual(await api(`/directories?path=${encodeURIComponent(workspace)}`), listing);
});
