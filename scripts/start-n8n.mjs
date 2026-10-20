import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [
  process.env.N8N_CLI_PATH,
  path.join(root, 'node_modules/n8n/bin/n8n'),
  ...(process.env.PATH || '')
    .split(path.delimiter)
    .flatMap((directory) => [
      path.join(directory, 'node_modules/n8n/bin/n8n'),
      path.join(directory, '../lib/node_modules/n8n/bin/n8n'),
      path.join(directory, 'n8n'),
    ]),
].filter(Boolean);
const cli = candidates.find((candidate) => existsSync(candidate));
if (!cli) {
  console.error('n8n belum ditemukan. Pasang n8n atau isi N8N_CLI_PATH dengan path skrip bin/n8n.');
  process.exit(1);
}

const child = spawn(process.execPath, [cli, 'start'], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
  env: {
    ...process.env,
    N8N_USER_FOLDER: path.join(root, '.data/n8n'),
    N8N_HOST: '127.0.0.1',
    N8N_LISTEN_ADDRESS: '127.0.0.1',
    N8N_PORT: '5678',
    N8N_PROTOCOL: 'http',
    N8N_DIAGNOSTICS_ENABLED: 'false',
    N8N_VERSION_NOTIFICATIONS_ENABLED: 'false',
    N8N_TEMPLATES_ENABLED: 'false',
    N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS: 'false',
    N8N_SECURE_COOKIE: 'false',
    N8N_PERSONALIZATION_ENABLED: 'false',
  },
});
child.on('error', (error) => {
  console.error(`n8n gagal dijalankan: ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
