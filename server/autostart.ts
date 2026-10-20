import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function getStartupDir(): string {
  return path.join(
    process.env.APPDATA || '',
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Startup',
  );
}

export function getVbsPath(): string {
  return path.join(getStartupDir(), 'agent-dock.vbs');
}

export function isAutoStartEnabled(): boolean {
  try {
    return fs.existsSync(getVbsPath());
  } catch {
    return false;
  }
}

export function enableAutoStart(): boolean {
  try {
    const startupDir = getStartupDir();
    if (!fs.existsSync(startupDir)) {
      fs.mkdirSync(startupDir, { recursive: true });
    }

    const vbsPath = getVbsPath();
    const vbsContent = [
      'Set WshShell = CreateObject("WScript.Shell")',
      `WshShell.CurrentDirectory = "${root}"`,
      'WshShell.Run "cmd.exe /c npm run tray", 0, False',
      '',
    ].join('\r\n');

    fs.writeFileSync(vbsPath, vbsContent, 'utf8');
    return true;
  } catch (error) {
    console.error('Gagal mengaktifkan auto-start:', error);
    return false;
  }
}

export function disableAutoStart(): boolean {
  try {
    const vbsPath = getVbsPath();
    if (fs.existsSync(vbsPath)) {
      fs.unlinkSync(vbsPath);
    }
    return true;
  } catch (error) {
    console.error('Gagal menonaktifkan auto-start:', error);
    return false;
  }
}
