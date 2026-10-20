import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { Connector, QuotaSnapshot, RouterUsage, UsageReport } from '../shared/types.js';
import { getCodexQuota } from './codex-quota.js';
import { ageQuota, nonnegative } from './usage.js';
import type { Store } from './store.js';

export async function readRouterUsage(database: string): Promise<RouterUsage> {
  // access first: never create a database or initialize another application's storage.
  await access(database);
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    const rows = db.prepare('SELECT data FROM usageDaily').all();
    let requests = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedTokens = 0;
    const providers = new Map<
      string,
      { name: string; requests: number; inputTokens: number; outputTokens: number }
    >();
    for (const row of rows) {
      const day = JSON.parse(String(row.data));
      requests += nonnegative(day.requests) ?? 0;
      inputTokens += nonnegative(day.promptTokens) ?? 0;
      outputTokens += nonnegative(day.completionTokens) ?? 0;
      cachedTokens += nonnegative(day.cachedTokens) ?? 0;
      for (const [name, raw] of Object.entries(day.byProvider || {})) {
        const data = raw as Record<string, unknown>;
        const provider = providers.get(name) || {
          name,
          requests: 0,
          inputTokens: 0,
          outputTokens: 0,
        };
        provider.requests += nonnegative(data.requests) ?? 0;
        provider.inputTokens += nonnegative(data.promptTokens) ?? 0;
        provider.outputTokens += nonnegative(data.completionTokens) ?? 0;
        providers.set(name, provider);
      }
    }
    return {
      requests,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      cachedTokens,
      source: '9router · statistik lokal',
      note: 'Seluruh riwayat harian yang masih disimpan router, termasuk aplikasi lain. Ini bukan sisa kuota akun provider dan tidak dijumlahkan lagi ke pemakaian Agent Dock.',
      providers: [...providers.values()].sort((a, b) => b.requests - a.requests),
    };
  } finally {
    db.close();
  }
}

async function localRouterUsage(): Promise<RouterUsage> {
  const home = homedir();
  const directories =
    process.platform === 'win32'
      ? [path.join(process.env.APPDATA || path.join(home, 'AppData/Roaming'), '9router/db')]
      : [path.join(home, '.9router/db'), path.join(home, '.config/9router/db')];
  for (const directory of directories) {
    const file = path.join(directory, 'data.sqlite');
    try {
      await access(file);
    } catch {
      continue;
    }
    return readRouterUsage(file);
  }
  throw new Error('Statistik lokal router belum ditemukan.');
}

function isLocalRouter(connector: Connector) {
  if (connector.localIntegration !== '9router' || !connector.baseUrl) return false;
  try {
    const url = new URL(connector.baseUrl);
    return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.port === '20128';
  } catch {
    return false;
  }
}

function unavailable(connector: Connector): QuotaSnapshot {
  let note = 'Provider belum menyediakan data sisa kuota ke Agent Dock.';
  if (connector.localIntegration === '9router')
    note =
      'Sisa kuota mengikuti setiap akun provider di 9router. API dashboard router memerlukan login tersendiri; buka halaman Usage di 9router untuk memeriksa kuota akun.';
  else if (connector.localIntegration === 'antigravity')
    note =
      'Bridge IDE saat ini menyediakan pengiriman tugas dan status, belum kuota akun. Periksa quota di Antigravity IDE. Kuota akun 9router tidak otomatis sama dengan akun IDE.';
  else if (connector.localIntegration === 'opencode')
    note =
      'OpenCode memakai limit provider dan model yang dipilih. Periksa usage provider tersebut; bila memakai 9router, statistik router tersedia di bawah.';
  else if (connector.id === 'claude')
    note =
      'Jalankan /usage di Claude Code untuk melihat limit akun. Agent Dock tidak menyisipkan perintah ke sesi yang sedang berjalan.';
  else if (connector.id === 'gemini')
    note =
      'Periksa /stats di Gemini CLI dan halaman quota akun Google yang digunakan. Preset belum membuktikan CLI sudah login.';
  else if (connector.runtime === 'openai')
    note =
      'Limit akan ditampilkan jika provider mengirim header rate limit saat tugas dijalankan. API kompatibel OpenAI tidak memiliki endpoint saldo atau kuota universal.';
  else if (connector.runtime === 'webhook')
    note =
      'Limit workflow mengikuti instalasi dan paket layanan webhook. Periksa usage di layanan asal.';
  return {
    status: 'unavailable',
    source: 'Belum tersedia',
    checkedAt: new Date().toISOString(),
    note,
    windows: [],
  };
}

class CachedRead<T> {
  private value?: T;
  private at = 0;
  private pending?: Promise<T>;
  constructor(private read: () => Promise<T>) {}
  get(refresh: boolean): Promise<T> {
    if (this.pending) return this.pending;
    if (this.value && Date.now() - this.at < (refresh ? 10000 : 60000))
      return Promise.resolve(this.value);
    this.pending = this.read()
      .then((value) => {
        this.value = value;
        this.at = Date.now();
        return value;
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }
}

export class UsageService {
  private codex: CachedRead<QuotaSnapshot>;
  private router: CachedRead<RouterUsage>;
  constructor(
    private store: Store,
    readers: {
      codex?: () => Promise<QuotaSnapshot>;
      router?: () => Promise<RouterUsage>;
    } = {},
  ) {
    this.codex = new CachedRead(readers.codex || getCodexQuota);
    this.router = new CachedRead(readers.router || localRouterUsage);
  }
  async report(refresh = false): Promise<UsageReport> {
    const connectors = [...this.store.state.connectors];
    const needsCodex = connectors.some((c) => c.localIntegration === 'codex' || c.id === 'codex');
    const needsRouter = connectors.some(isLocalRouter);
    const [codex, router] = await Promise.allSettled([
      needsCodex ? this.codex.get(refresh) : Promise.resolve(undefined),
      needsRouter ? this.router.get(refresh) : Promise.resolve(undefined),
    ]);
    return {
      checkedAt: new Date().toISOString(),
      entries: connectors.map((connector) => {
        let quota = this.store.state.quotas?.[connector.id] || unavailable(connector);
        if (connector.localIntegration === 'codex' || connector.id === 'codex') {
          quota =
            codex.status === 'fulfilled' && codex.value
              ? codex.value
              : {
                  ...unavailable(connector),
                  status: 'error',
                  note: 'Pembacaan kuota Codex gagal. Periksa login CLI lalu coba perbarui kembali.',
                };
        }
        const sessions = this.store.state.sessions.filter((s) => s.connectorId === connector.id);
        return {
          connectorId: connector.id,
          local: this.store.state.usage?.[connector.id],
          sessions: sessions.length,
          activeSessions: sessions.filter((s) => s.alive).length,
          quota: ageQuota(quota),
        };
      }),
      router: router.status === 'fulfilled' ? router.value : undefined,
      routerNote:
        needsRouter && router.status === 'rejected'
          ? 'Statistik lokal 9router belum dapat dibaca. Router jarak jauh dan lokasi penyimpanan khusus dapat diperiksa melalui dashboard 9router.'
          : undefined,
    };
  }
}
