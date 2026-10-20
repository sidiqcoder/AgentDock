import { readFile } from 'node:fs/promises';
const [file, taskId, status, text = ''] = process.argv.slice(2);
if (!file || !taskId || !['running', 'waiting', 'completed', 'failed'].includes(status)) {
  console.error('Pemakaian: node report-ide.mjs HANDOFF_JSON TASK_ID STATUS "pesan"');
  process.exit(1);
}
try {
  const handoff = JSON.parse(await readFile(file, 'utf8'));
  if (handoff.taskId !== taskId) throw new Error('Tugas ini sudah digantikan oleh instruksi baru.');
  const body = {
    status,
    ...(status === 'waiting'
      ? { question: text }
      : status === 'completed'
        ? { summary: text }
        : { message: text }),
  };
  const response = await fetch(handoff.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${handoff.token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Hook ditolak: HTTP ${response.status}.`);
  console.log('Status tugas dilaporkan ke Agent Dock.');
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
