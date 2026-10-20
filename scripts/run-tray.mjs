import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nodePath = process.execPath;
const tsxPath = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverPath = path.join(root, 'server', 'index.ts');

const logFile = path.join(root, '.data', 'launcher.log');
fs.mkdirSync(path.dirname(logFile), { recursive: true });
const out = fs.openSync(logFile, 'a');

const child = spawn(nodePath, [tsxPath, serverPath, '--tray'], {
  cwd: root,
  detached: true,
  stdio: ['ignore', out, out],
  windowsHide: true,
});

child.unref();
process.exit(0);
