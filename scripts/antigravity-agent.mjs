import { createInterface } from 'node:readline';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sendIdePrompt } from './ide-client.mjs';

if (!process.env.AGENT_DOCK_HOOK_URL || !process.env.AGENT_DOCK_HOOK_TOKEN) {
  console.error('Jalankan adapter ini dari koneksi Antigravity IDE di Agent Dock.');
  process.exit(1);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(
  process.env.AGENT_DOCK_DATA_DIR || path.join(root, '.data'),
  'ide-handoffs',
  process.env.AGENT_DOCK_SESSION,
);
await mkdir(directory, { recursive: true });
const stateFile = path.join(directory, 'current.json');
const taskFile = path.join(directory, 'task.md');
const input = createInterface({ input: process.stdin, output: process.stdout });
async function report(status, payload = {}) {
  const response = await fetch(process.env.AGENT_DOCK_HOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.AGENT_DOCK_HOOK_TOKEN}`,
    },
    body: JSON.stringify({ status, ...payload }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Hook ditolak: HTTP ${response.status}`);
}
console.log('\nANTIGRAVITY IDE / AGENT DOCK\n');
console.log('Prompt dikirim ke panel agent native melalui ekstensi Agent Dock.');
console.log('Adapter tidak membaca percakapan IDE secara diam-diam.');
console.log('Hook pada konteks tugas mengirim status, pertanyaan, dan ringkasan kembali.');
console.log('Jika IDE tidak menjalankan hook, periksa IDE dan gunakan Status CLI manual.');
console.log('Pasang .data/agent-dock-antigravity-bridge.vsix di IDE, lalu Reload Window.');
console.log('Ketik /exit untuk memutus adapter tanpa menutup IDE.\n');
await report('waiting', {
  question: 'Apa tugas untuk Antigravity IDE? Balasan dikirim ke chat agent di IDE.',
});
try {
  for await (const line of input) {
    let message = line.trim();
    try {
      const parsed = JSON.parse(message);
      if (typeof parsed.agentDockMessage === 'string') message = parsed.agentDockMessage;
    } catch {
      /* Plain terminal input. */
    }
    if (['/exit', '/quit'].includes(message)) break;
    if (!message) continue;
    const taskId = randomUUID();
    await writeFile(
      stateFile,
      JSON.stringify({
        taskId,
        url: process.env.AGENT_DOCK_HOOK_URL,
        token: process.env.AGENT_DOCK_HOOK_TOKEN,
      }),
      { mode: 0o600 },
    );
    const callback = `& '${process.execPath.replaceAll("'", "''")}' '${path.join(root, 'scripts/report-ide.mjs').replaceAll("'", "''")}' '${stateFile.replaceAll("'", "''")}' '${taskId}'`;
    const instructions = `# Tugas dari Agent Dock\n\n${message}\n\n## Laporan kembali ke dashboard\n\nKerjakan tugas ini di workspace yang benar dengan izin normal IDE. Jangan melewati persetujuan pengguna.\nUntuk melaporkan progres, jalankan perintah PowerShell berikut dari terminal. Jangan menampilkan isi current.json atau token hook.\n\n- Sebelum mulai: ${callback} running\n- Saat perlu keputusan: ${callback} waiting "PERTANYAAN untuk pengguna"\n- Setelah selesai: ${callback} completed "RINGKASAN hasil dan validasi"\n- Jika gagal: ${callback} failed "PENJELASAN kegagalan"\n\nJangan menganggap task selesai hanya karena prompt sudah dikirim. Tunggu masukan pengguna jika diperlukan.\n`;
    await writeFile(taskFile, instructions, { mode: 0o600 });
    await report('running');
    console.log('\nMengirim instruksi ke Antigravity IDE…');
    try {
      const delivery = await sendIdePrompt(process.cwd(), instructions);
      console.log(
        `Panel agent native mengonfirmasi penerimaan prompt (${delivery.nativeCommand}). Menunggu hasil dari IDE.`,
      );
      console.log('Balasan / instruksi berikutnya bisa diketik di sini. /exit untuk memutus.\n');
    } catch (error) {
      console.error(error.message);
      await report('failed', { message: error.message });
    }
  }
} finally {
  input.close();
  await rm(stateFile, { force: true });
  console.log('Adapter terputus. Jendela dan tugas IDE tetap mengikuti pengaturan IDE.');
}
