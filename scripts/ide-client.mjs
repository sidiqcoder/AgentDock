import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function sendIdePrompt(workspace, prompt) {
  let record;
  try {
    record = JSON.parse(
      await readFile(path.join(workspace, '.data/antigravity-bridge.json'), 'utf8'),
    );
  } catch {
    throw new Error(
      'Bridge Antigravity belum aktif. Pasang .data/agent-dock-antigravity-bridge.vsix di IDE, buka workspace ini, lalu jalankan Agent Dock: Connect workspace.',
    );
  }
  const url = new URL(record.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port)
    throw new Error('Alamat bridge IDE tidak valid.');
  const response = await fetch(url.origin + '/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${record.token}` },
    body: JSON.stringify({ workspace, prompt }),
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
  });
  const result = await response.json();
  if (
    !response.ok ||
    result.accepted !== true ||
    result.nativeCommand !== 'antigravity.sendPromptToAgentPanel'
  )
    throw new Error(result.error || 'Panel agent native belum mengonfirmasi prompt.');
  return result;
}
