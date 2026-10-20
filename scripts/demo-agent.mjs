import { createInterface } from 'node:readline';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function report(status, payload = {}) {
  const response = await fetch(process.env.AGENT_DOCK_HOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.AGENT_DOCK_HOOK_TOKEN}`,
    },
    body: JSON.stringify({ status, ...payload }),
  });
  if (!response.ok) throw new Error(`Hook gagal: ${response.status}`);
}
console.log('\x1b[38;2;154;228;202m\n  AGENT DOCK / DEMO LOKAL\x1b[0m\n');
console.log('  Ini proses Node.js sungguhan, tanpa model AI atau API key.');
await wait(900);
console.log('  ✓ Sesi lokal terhubung');
await wait(700);
console.log('  ✓ Hook status siap');
const input = createInterface({ input: process.stdin, output: process.stdout });
await report('waiting', {
  question:
    'Apa tugas yang ingin kamu coba? Ketik dari dashboard. Ketik keluar untuk mengakhiri demo.',
});
let count = 0;
while (true) {
  const answer = await new Promise((resolve) =>
    input.question(count ? '\n  Tugas berikutnya (atau keluar) > ' : '\n  Tugas kamu > ', resolve),
  );
  if (answer.trim().toLowerCase() === 'keluar') break;
  await report('running');
  console.log('\n  Memproses masukan...');
  await wait(1400);
  const summary = count
    ? `Perintah lanjutan diterima: “${answer}”. Demo berhasil melanjutkan sesi yang sama.`
    : `Demo selesai. Masukan diterima: “${answer}”.\nTerminal, hook status, dan balasan dashboard berhasil terhubung.\nIni simulasi alur; tidak ada tugas AI yang dieksekusi. Kirim tugas berikutnya untuk mencoba lagi.`;
  console.log(`\n  ${summary.replaceAll('\n', '\n  ')}\n`);
  await report('completed', { summary });
  count++;
}
input.close();
console.log('\n  Demo berakhir. Sampai jumpa!\n');
