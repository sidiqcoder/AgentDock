import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ExternalSession, ExternalSessionDetail, Message } from '../shared/types.js';
import { findExecutable, quoteShell } from './local-integrations.js';

const execFileAsync = promisify(execFile);

export async function findOpenCodePath(home = homedir()): Promise<string | undefined> {
  const local = process.env.LOCALAPPDATA || path.join(home, 'AppData/Local');
  const programFiles = process.env.ProgramFiles || 'C:/Program Files';
  const appdata = process.env.APPDATA || path.join(home, 'AppData/Roaming');
  return findExecutable('opencode', [
    path.join(programFiles, 'nodejs/node_modules/opencode-ai/bin/opencode.exe'),
    path.join(appdata, 'npm/node_modules/opencode-ai/bin/opencode.exe'),
    path.join(local, 'Programs/opencode/opencode.exe'),
  ]);
}

export function resolveExecArgs(
  executable: string,
  args: string[],
): { file: string; fileArgs: string[] } {
  if (
    process.platform === 'win32' &&
    (executable.endsWith('.cmd') || executable.endsWith('.bat'))
  ) {
    const directExe = path.join(
      path.dirname(executable),
      'node_modules/opencode-ai/bin/opencode.exe',
    );
    if (existsSync(directExe)) {
      return { file: directExe, fileArgs: args };
    }
    return {
      file: process.env.ComSpec || 'cmd.exe',
      fileArgs: ['/d', '/s', '/c', executable, ...args],
    };
  }
  return { file: executable, fileArgs: args };
}

export function parseOpenCodeSessionList(stdout: string): ExternalSession[] {
  const bracketIndex = stdout.indexOf('[');
  if (bracketIndex === -1) return [];
  try {
    const rawList = JSON.parse(stdout.slice(bracketIndex));
    if (!Array.isArray(rawList)) return [];
    return rawList
      .flatMap((item: any): ExternalSession[] => {
        if (!item || !item.id) return [];
        return [
          {
            id: String(item.id),
            title: String(item.title || 'Untitled Session'),
            directory: String(item.directory || ''),
            createdAt: item.created ? new Date(item.created).toISOString() : undefined,
            updatedAt: item.updated ? new Date(item.updated).toISOString() : undefined,
            agent: 'opencode',
          },
        ];
      })
      .sort((a, b) => Date.parse(b.updatedAt || '0') - Date.parse(a.updatedAt || '0'));
  } catch {
    return [];
  }
}

export function parseOpenCodeExport(stdout: string): ExternalSessionDetail {
  const braceIndex = stdout.indexOf('{');
  if (braceIndex === -1) throw new Error('Format export OpenCode tidak valid.');
  const data = JSON.parse(stdout.slice(braceIndex));
  const info = data?.info || {};
  const id = String(info.id || '');
  if (!id) throw new Error('ID sesi tidak ditemukan dalam export OpenCode.');
  const title = String(info.title || 'Sesi OpenCode');
  const directory = String(info.directory || '');
  const createdAt = info.time?.created ? new Date(info.time.created).toISOString() : undefined;
  const updatedAt = info.time?.updated ? new Date(info.time.updated).toISOString() : undefined;
  const model = info.model
    ? `${info.model.providerID || ''}/${info.model.modelID || ''}`.replace(/^\//, '')
    : undefined;

  const messages: Message[] = [];
  let summary = '';

  if (Array.isArray(data?.messages)) {
    for (const msg of data.messages) {
      const role =
        msg.info?.role === 'user' ? 'user' : msg.info?.role === 'assistant' ? 'assistant' : null;
      if (!role) continue;

      const textParts = (Array.isArray(msg.parts) ? msg.parts : [])
        .filter((p: any) => p?.type === 'text' && typeof p?.text === 'string' && p.text.trim())
        .map((p: any) => p.text.trim());

      const content = textParts.join('\n\n');
      if (!content) continue;

      const at = msg.info?.time?.created
        ? new Date(msg.info.time.created).toISOString()
        : new Date().toISOString();

      messages.push({
        id: String(msg.info?.id || `ext-${messages.length + 1}`),
        role,
        content,
        at,
      });

      if (role === 'assistant') {
        summary = content.slice(0, 300);
      }
    }
  }

  return {
    id,
    title,
    directory,
    createdAt,
    updatedAt,
    messages,
    summary: summary || undefined,
    model: model || undefined,
    agent: 'opencode',
  };
}

export function buildResumeCommand(
  agent: 'opencode' | 'codex',
  executable: string,
  sessionId: string,
): string {
  const prefix = process.platform === 'win32' ? '& ' : '';
  const cleanId = sessionId.trim().replace(/[^a-zA-Z0-9_-]/g, '');
  if (agent === 'codex') {
    return `${prefix}${quoteShell(executable)} resume ${cleanId} --no-alt-screen --no-daemon`;
  }
  return `${prefix}${quoteShell(executable)} -s ${cleanId}`;
}

export async function listExternalSessions(
  agent: 'opencode' | 'codex' = 'opencode',
  options: { cwd?: string; maxCount?: number } = {},
): Promise<ExternalSession[]> {
  if (agent === 'opencode') {
    const opencode = await findOpenCodePath();
    if (!opencode) throw new Error('OpenCode CLI belum terpasang atau tidak ditemukan.');
    const { file, fileArgs } = resolveExecArgs(opencode, [
      'session',
      'list',
      '--format',
      'json',
      ...(options.maxCount ? ['-n', String(options.maxCount)] : []),
    ]);
    const { stdout } = await execFileAsync(file, fileArgs, {
      timeout: 15000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });
    let sessions = parseOpenCodeSessionList(stdout);
    if (options.cwd) {
      const targetCwd = path.resolve(options.cwd).toLowerCase();
      // Keep sessions in current dir first
      sessions = [
        ...sessions.filter(
          (s) => s.directory && path.resolve(s.directory).toLowerCase() === targetCwd,
        ),
        ...sessions.filter(
          (s) => !s.directory || path.resolve(s.directory).toLowerCase() !== targetCwd,
        ),
      ];
    }
    return sessions;
  }
  return [];
}

export async function getExternalSessionDetail(
  agent: 'opencode' | 'codex' = 'opencode',
  sessionId: string,
): Promise<ExternalSessionDetail> {
  if (agent === 'opencode') {
    const cleanId = sessionId.trim().replace(/[^a-zA-Z0-9_-]/g, '');
    if (!cleanId) throw new Error('ID sesi tidak valid.');
    const opencode = await findOpenCodePath();
    if (!opencode) throw new Error('OpenCode CLI belum terpasang atau tidak ditemukan.');
    const { file, fileArgs } = resolveExecArgs(opencode, ['export', cleanId]);
    const { stdout } = await execFileAsync(file, fileArgs, {
      timeout: 15000,
      maxBuffer: 25 * 1024 * 1024,
      windowsHide: true,
    });
    return parseOpenCodeExport(stdout);
  }
  throw new Error(`Agent ${agent} belum mendukung export riwayat.`);
}
