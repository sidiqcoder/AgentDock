const [status, text = ''] = process.argv.slice(2);
if (!['running', 'waiting', 'completed', 'failed'].includes(status)) {
  console.error(
    'Pemakaian: node scripts/report-event.mjs waiting|completed|running|failed "pesan"',
  );
  process.exit(1);
}
if (!process.env.AGENT_DOCK_HOOK_URL || !process.env.AGENT_DOCK_HOOK_TOKEN) {
  console.error('Jalankan skrip dari proses yang diluncurkan oleh Agent Dock.');
  process.exit(1);
}
const body = {
  status,
  ...(status === 'waiting'
    ? { question: text }
    : status === 'completed'
      ? { summary: text }
      : { message: text }),
};
const response = await fetch(process.env.AGENT_DOCK_HOOK_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.AGENT_DOCK_HOOK_TOKEN}`,
  },
  body: JSON.stringify(body),
});
if (!response.ok) {
  console.error(`Hook ditolak: HTTP ${response.status}`);
  process.exit(1);
}
