import { readFile } from 'node:fs/promises';
import path from 'node:path';
try {
  const record = JSON.parse(await readFile(path.resolve('.data/antigravity-bridge.json'), 'utf8'));
  const response = await fetch(record.url + '/health', {
    headers: { Authorization: `Bearer ${record.token}` },
    signal: AbortSignal.timeout(3000),
  });
  const health = await response.json();
  if (!response.ok || !health.nativeCommand)
    throw new Error('IDE belum mengonfirmasi dukungan panel agent native.');
  console.log(
    JSON.stringify({ ok: true, nativeCommand: health.nativeCommand, workspace: health.workspace }),
  );
} catch (error) {
  console.error(
    'FAIL: Belum ada koneksi terverifikasi dari panel agent Antigravity IDE. ' + error.message,
  );
  process.exitCode = 1;
}
