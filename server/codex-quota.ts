import { spawn } from 'node:child_process';
import { readdir, stat, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type { QuotaSnapshot, QuotaWindow } from '../shared/types.js';
import { findExecutable } from './local-integrations.js';
import { ageQuota, nonnegative } from './usage.js';

export function parseCodexLimits(result: any, observedAt: string, source: string): QuotaSnapshot {
  const buckets =
    result?.rateLimitsByLimitId && Object.keys(result.rateLimitsByLimitId).length
      ? Object.entries(result.rateLimitsByLimitId)
      : [[result?.rateLimits?.limitId || 'codex', result?.rateLimits ?? result]];
  const windows: QuotaWindow[] = [];
  let plan: string | undefined;
  for (const [id, raw] of buckets) {
    const bucket = raw as any;
    if (!bucket || typeof bucket !== 'object') continue;
    if (typeof (bucket.planType ?? bucket.plan_type) === 'string')
      plan = bucket.planType ?? bucket.plan_type;
    for (const key of ['primary', 'secondary'] as const) {
      const data = bucket[key];
      if (!data) continue;
      const used = nonnegative(data.usedPercent ?? data.used_percent);
      if (used === undefined) continue;
      const minutes = nonnegative(data.windowDurationMins ?? data.window_minutes);
      const reset = nonnegative(data.resetsAt ?? data.resets_at);
      const label =
        minutes === undefined
          ? key === 'primary'
            ? 'Limit utama'
            : 'Limit tambahan'
          : minutes % 1440 === 0
            ? `${minutes / 1440} hari`
            : minutes % 60 === 0
              ? `${minutes / 60} jam`
              : `${minutes} menit`;
      windows.push({
        id: `${id}:${key}`,
        label: `${bucket.limitName || bucket.limit_name || id} · ${label}`,
        unit: 'percent',
        limit: 100,
        remaining: Math.max(0, 100 - used),
        resetsAt:
          reset !== undefined && reset < 8.64e12 ? new Date(reset * 1000).toISOString() : undefined,
      });
    }
  }
  return ageQuota({
    status: windows.length ? 'available' : 'unavailable',
    source,
    checkedAt: new Date().toISOString(),
    observedAt,
    plan,
    windows,
    note: windows.length
      ? 'Kuota akun Codex lokal, dibagi dengan pemakaian akun yang sama di aplikasi lain.'
      : 'Codex belum mengembalikan jendela limit. Login API key tidak menyediakan kuota paket ChatGPT.',
  });
}

// Only account reads are sent. No thread, model turn, shell or tool is started.
export async function readCodexAccount(
  executable: string,
  timeoutMs = 12000,
): Promise<QuotaSnapshot> {
  const child = spawn(executable, ['--no-daemon', 'app-server', '--listen', 'stdio://'], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  });
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout });
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  let nextId = 0;
  let failure: Error | undefined;
  const fail = () => {
    failure = new Error('Pembacaan akun Codex tidak tersedia. Periksa instalasi dan login CLI.');
    for (const item of pending.values()) item.reject(failure);
    pending.clear();
  };
  child.on('error', fail);
  child.on('exit', fail);
  child.stdin.on('error', fail);
  const timer = setTimeout(() => {
    fail();
    child.kill();
  }, timeoutMs);
  const request = (method: string, params?: unknown) =>
    new Promise<any>((resolve, reject) => {
      if (failure) {
        reject(failure);
        return;
      }
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ id, method, ...(params ? { params } : {}) }) + '\n');
    });
  lines.on('line', (line) => {
    try {
      const event = JSON.parse(line);
      const item = pending.get(event.id);
      if (!item) return;
      pending.delete(event.id);
      if (event.error)
        item.reject(
          new Error('Codex belum dapat membaca data akun; periksa login atau versi CLI.'),
        );
      else item.resolve(event.result);
    } catch {
      /* Ignore non-protocol output without exposing it to the browser. */
    }
  });
  try {
    await request('initialize', {
      clientInfo: { name: 'agent_dock', title: 'Agent Dock', version: '0.1.0' },
    });
    child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    const [limits, usage] = await Promise.allSettled([
      request('account/rateLimits/read'),
      request('account/usage/read'),
    ]);
    if (limits.status === 'rejected') throw limits.reason;
    const result = parseCodexLimits(limits.value, new Date().toISOString(), 'Codex · API akun');
    if (usage.status === 'fulfilled')
      result.accountTokens = nonnegative(usage.value?.summary?.lifetimeTokens);
    return result;
  } finally {
    clearTimeout(timer);
    lines.close();
    child.stdin.end();
    child.kill();
  }
}

export async function readCodexLog(directory: string): Promise<QuotaSnapshot | undefined> {
  // Visit recent date directories first and read bounded file tails, never full conversations.
  const files: { file: string; mtime: number }[] = [];
  const walk = async (dir: string, depth: number) => {
    const entries = await readdir(dir, { withFileTypes: true });
    if (depth < 3) {
      for (const entry of entries
        .filter((e) => e.isDirectory())
        .sort((a, b) => b.name.localeCompare(a.name))) {
        if (files.length >= 12) break;
        await walk(path.join(dir, entry.name), depth + 1);
      }
    } else {
      for (const entry of entries.filter((e) => e.isFile() && e.name.endsWith('.jsonl'))) {
        const file = path.join(dir, entry.name);
        files.push({ file, mtime: (await stat(file)).mtimeMs });
      }
    }
  };
  try {
    await walk(directory, 0);
  } catch {
    return;
  }
  let latest: QuotaSnapshot | undefined;
  for (const item of files.sort((a, b) => b.mtime - a.mtime).slice(0, 12)) {
    const file = await open(item.file, 'r');
    let text: string;
    try {
      const size = (await file.stat()).size;
      const buffer = Buffer.alloc(Math.min(size, 512000));
      const { bytesRead } = await file.read(
        buffer,
        0,
        buffer.length,
        Math.max(0, size - buffer.length),
      );
      text = buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
      await file.close();
    }
    for (const line of text.split('\n').reverse()) {
      if (!line.includes('"token_count"')) continue;
      try {
        const event = JSON.parse(line);
        if (
          event.type !== 'event_msg' ||
          event.payload?.type !== 'token_count' ||
          !event.payload.rate_limits ||
          !Number.isFinite(Date.parse(event.timestamp))
        )
          continue;
        const quota = parseCodexLimits(
          event.payload.rate_limits,
          event.timestamp,
          'Codex · catatan lokal',
        );
        if (quota.windows.length && (!latest || event.timestamp > latest.observedAt!))
          latest = quota;
        if (quota.windows.length) break;
      } catch {
        /* A partially written final JSONL line is expected for active agents. */
      }
    }
  }
  return latest;
}

export async function getCodexQuota(home = homedir()): Promise<QuotaSnapshot> {
  const executable = await findExecutable('codex', [
    path.join(
      process.env.LOCALAPPDATA || path.join(home, 'AppData/Local'),
      'Programs/OpenAI/Codex/bin/codex.exe',
    ),
  ]);
  if (executable && !/\.(cmd|bat)$/i.test(executable)) {
    try {
      return await readCodexAccount(executable);
    } catch {
      /* Local logs remain usable offline. */
    }
  }
  const codexHome = process.env.CODEX_HOME || path.join(home, '.codex');
  const logged = await readCodexLog(path.join(codexHome, 'sessions'));
  if (logged)
    return {
      ...logged,
      note: `${logged.note} API akun belum dapat dihubungi; ditampilkan catatan terakhir.`,
    };
  return {
    status: 'unavailable',
    source: 'Codex lokal',
    checkedAt: new Date().toISOString(),
    windows: [],
    note: 'Belum ada data limit Codex. Login ke CLI lalu jalankan satu tugas, atau periksa /status di terminal Codex.',
  };
}
