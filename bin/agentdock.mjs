#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const serverScript = path.join(root, 'server', 'index.ts');

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Agent Dock (@sidiq/agentdock)
Local orchestrator & dashboard to supervise CLI agents, chat with models, and run workflows.

Usage:
  agentdock [options]
  npx @sidiq/agentdock [options]

Options:
  --port <number>     Set port number (default: 4310, or PORT env)
  --no-tray           Disable Windows system tray icon
  --tray              Enable Windows system tray icon
  --production        Run with pre-built production assets (default)
  -v, --version       Show version number
  -h, --help          Show help message

Environment variables:
  PORT                  Port to listen on (default 4310)
  AGENT_DOCK_DATA_DIR   Custom directory to store sessions & state
`);
  process.exit(0);
}

if (args.includes('--version') || args.includes('-v')) {
  try {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    console.log(pkg.version);
  } catch {
    console.log('0.1.0');
  }
  process.exit(0);
}

// Ensure production flag is included by default if not running dev
const forwardArgs = [...args];
if (!forwardArgs.includes('--production') && !forwardArgs.includes('--dev')) {
  forwardArgs.push('--production');
}
if (!forwardArgs.includes('--open') && !forwardArgs.includes('--no-open')) {
  forwardArgs.push('--open');
}

let tsxCli;
try {
  tsxCli = fileURLToPath(import.meta.resolve('tsx/cli'));
} catch {
  tsxCli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
}

const child = spawn(process.execPath, [tsxCli, serverScript, ...forwardArgs], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
