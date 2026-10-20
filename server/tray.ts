import { spawn, exec, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { isAutoStartEnabled, enableAutoStart, disableAutoStart } from './autostart.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function openBrowser(url: string) {
  if (process.platform === 'win32') {
    exec(`start "" "${url}"`);
  } else if (process.platform === 'darwin') {
    exec(`open "${url}"`);
  } else {
    exec(`xdg-open "${url}"`);
  }
}

export interface TrayOptions {
  port: number;
  origin: string;
  onQuit: () => void;
}

export interface TrayController {
  kill: () => void;
  notify: (title: string, text: string) => void;
}

export function initTray(options: TrayOptions): TrayController | null {
  if (process.platform !== 'win32') {
    return null;
  }

  const { port, origin, onQuit } = options;
  const scriptPath = path.join(root, 'server', 'tray.ps1');
  const iconPath = path.join(root, 'public', 'icon.ico');
  const tooltip = `Agent Dock (Port ${port})`;

  let psProcess: ChildProcess | null = null;

  try {
    psProcess = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-WindowStyle',
        'Hidden',
        '-InputFormat',
        'Text',
        '-OutputFormat',
        'Text',
        '-File',
        scriptPath,
        '-IconPath',
        iconPath,
        '-Tooltip',
        tooltip,
      ],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
  } catch (error) {
    console.error('Gagal menjalankan proses tray:', error);
    return null;
  }

  const sendCommand = (cmd: Record<string, unknown>) => {
    if (psProcess && psProcess.stdin && psProcess.stdin.writable) {
      psProcess.stdin.write(`${JSON.stringify(cmd)}\n`, 'utf8');
    }
  };

  const getAutoStartLabel = () =>
    isAutoStartEnabled() ? '✓ Auto-start Windows (Aktif)' : '○ Aktifkan Auto-start';

  const MENU_INDEX = {
    DASHBOARD: 0,
    SEP_1: 1,
    STATUS: 2,
    AUTOSTART: 3,
    SEP_2: 4,
    QUIT: 5,
  };

  // Add initial menu items
  sendCommand({
    action: 'add-item',
    index: MENU_INDEX.DASHBOARD,
    title: '🌐 Buka Dashboard',
    enabled: true,
    isBold: true,
  });

  sendCommand({
    action: 'add-item',
    index: MENU_INDEX.SEP_1,
    title: '-',
    enabled: false,
  });

  sendCommand({
    action: 'add-item',
    index: MENU_INDEX.STATUS,
    title: `⚡ Port: ${port} (Aktif)`,
    enabled: false,
  });

  sendCommand({
    action: 'add-item',
    index: MENU_INDEX.AUTOSTART,
    title: getAutoStartLabel(),
    enabled: true,
  });

  sendCommand({
    action: 'add-item',
    index: MENU_INDEX.SEP_2,
    title: '-',
    enabled: false,
  });

  sendCommand({
    action: 'add-item',
    index: MENU_INDEX.QUIT,
    title: '❌ Tutup Agent Dock',
    enabled: true,
  });

  if (psProcess.stdout) {
    const rl = readline.createInterface({ input: psProcess.stdout });
    rl.on('line', (line) => {
      try {
        const evt = JSON.parse(line.trim());
        if (evt.type === 'click_icon') {
          // Direct click or double click on the tray icon itself
          openBrowser(origin);
        } else if (evt.type === 'click_item') {
          if (evt.index === MENU_INDEX.DASHBOARD) {
            openBrowser(origin);
          } else if (evt.index === MENU_INDEX.AUTOSTART) {
            if (isAutoStartEnabled()) {
              disableAutoStart();
              sendCommand({
                action: 'balloon',
                title: 'Agent Dock',
                text: 'Auto-start saat Windows booting dinonaktifkan.',
              });
            } else {
              enableAutoStart();
              sendCommand({
                action: 'balloon',
                title: 'Agent Dock',
                text: 'Auto-start saat Windows booting berhasil diaktifkan.',
              });
            }
            sendCommand({
              action: 'update-item',
              index: MENU_INDEX.AUTOSTART,
              title: getAutoStartLabel(),
              enabled: true,
            });
          } else if (evt.index === MENU_INDEX.QUIT) {
            onQuit();
          }
        }
      } catch {
        // Ignore JSON parse errors from PowerShell background noise
      }
    });
  }

  if (psProcess.stderr) {
    psProcess.stderr.on('data', () => {});
  }

  psProcess.on('error', (err) => {
    console.error('Tray process error:', err);
  });

  const kill = () => {
    try {
      sendCommand({ action: 'kill' });
    } catch {}
    setTimeout(() => {
      if (psProcess && !psProcess.killed) {
        try {
          psProcess.kill();
        } catch {}
      }
      psProcess = null;
    }, 300);
  };

  const notify = (title: string, text: string) => {
    sendCommand({ action: 'balloon', title, text });
  };

  return { kill, notify };
}
