import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const startupDir = path.join(
  process.env.APPDATA || '',
  'Microsoft',
  'Windows',
  'Start Menu',
  'Programs',
  'Startup',
);
const vbsPath = path.join(startupDir, 'agent-dock.vbs');

const cmd = process.argv[2] || 'status';

if (cmd === 'enable') {
  if (!fs.existsSync(startupDir)) {
    fs.mkdirSync(startupDir, { recursive: true });
  }

  const vbsContent = [
    'Set WshShell = CreateObject("WScript.Shell")',
    `WshShell.CurrentDirectory = "${root}"`,
    'WshShell.Run "cmd.exe /c npm run tray", 0, False',
    '',
  ].join('\r\n');

  fs.writeFileSync(vbsPath, vbsContent, 'utf8');
  console.log(`[Auto-start] BERHASIL DI-ENABLE:`);
  console.log(`File: ${vbsPath}`);
  console.log(`Agent Dock akan otomatis jalan di background setiap kali laptop dinyalakan.`);
} else if (cmd === 'disable') {
  if (fs.existsSync(vbsPath)) {
    fs.unlinkSync(vbsPath);
    console.log(`[Auto-start] BERHASIL DI-DISABLE (file dihapus dari folder Startup).`);
  } else {
    console.log(`[Auto-start] Sudah dalam keadaan nonaktif.`);
  }
} else if (cmd === 'status') {
  const isEnabled = fs.existsSync(vbsPath);
  console.log(`[Auto-start Status]: ${isEnabled ? 'AKTIF (ENABLED)' : 'NONAKTIF (DISABLED)'}`);
  if (isEnabled) {
    console.log(`Lokasi file startup: ${vbsPath}`);
    console.log(`Isi script:\n${fs.readFileSync(vbsPath, 'utf8')}`);
  }
} else {
  console.log(`Penggunaan: node scripts/autostart.mjs [enable|disable|status]`);
}
