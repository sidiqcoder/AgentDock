import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  CircleHelp,
  Clock3,
  Gauge,
  LoaderCircle,
  RefreshCw,
  Search,
} from 'lucide-react';
import type { Connector, QuotaSnapshot, QuotaWindow, UsageReport } from '../shared/types';
import { runtimeLabels } from '../shared/types';
import { api } from './api';
import { ageQuota } from '../shared/usage';

const number = (value?: number) => (value === undefined ? '—' : value.toLocaleString('id-ID'));
const time = (value: string) =>
  new Date(value).toLocaleString('id-ID', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

function QuotaMeter({ window, stale }: { window: QuotaWindow; stale: boolean }) {
  const percent = window.limit
    ? Math.min(100, Math.max(0, (window.remaining / window.limit) * 100))
    : undefined;
  const low = !stale && percent !== undefined && percent <= 20;
  return (
    <div className={`quota-meter ${stale ? 'is-stale' : ''} ${low ? 'is-low' : ''}`}>
      <div className="quota-meter-label">
        <span>{window.label}</span>
        <strong>
          {number(window.remaining)}
          {window.unit === 'percent'
            ? '%'
            : ` ${window.unit === 'tokens' ? 'token' : 'permintaan'}`}{' '}
          <small>tersisa{stale ? ' · data lama' : ''}</small>
        </strong>
      </div>
      {percent !== undefined && (
        <div
          className="quota-track"
          role="meter"
          aria-label={`Sisa ${window.label}${stale ? ' (data lama)' : ''}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <span style={{ width: `${percent}%` }} />
        </div>
      )}
      <div className="quota-meter-meta">
        <span>
          {window.unit === 'percent'
            ? 'Sisa jendela kuota'
            : `Limit ${number(window.limit)} ${window.unit === 'tokens' ? 'token' : 'permintaan'}`}
        </span>
        <span>
          {window.resetsAt ? `Reset ${time(window.resetsAt)}` : 'Waktu reset belum tersedia'}
        </span>
      </div>
    </div>
  );
}

function QuotaStatus({ quota }: { quota: QuotaSnapshot }) {
  const exhausted = quota.status === 'available' && quota.windows.some((w) => w.remaining === 0);
  const label = exhausted
    ? 'Limit habis'
    : {
        available: 'Kuota tersedia',
        unavailable: 'Belum tersedia',
        stale: 'Data lama',
        error: 'Gagal diperiksa',
      }[quota.status];
  return (
    <span className={`quota-status ${exhausted ? 'exhausted' : quota.status}`}>
      <i />
      {label}
    </span>
  );
}

export default function UsageQuota({
  connectors,
  connected,
}: {
  connectors: Connector[];
  connected: boolean;
}) {
  const [report, setReport] = useState<UsageReport>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [automatic, setAutomatic] = useState(true);
  const requestId = useRef(0);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const load = useCallback(async (refresh = false) => {
    const id = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const result = await api<UsageReport>(`/usage${refresh ? '?refresh=1' : ''}`);
      if (id === requestId.current) setReport(result);
    } catch (err) {
      if (id === requestId.current) {
        const message = (err as Error).message;
        setError(
          message === 'Endpoint tidak ditemukan.'
            ? 'Server masih menjalankan versi sebelumnya. Mulai ulang Agent Dock setelah sesi aktif selesai.'
            : message,
        );
      }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);
  const connectorIds = connectors.map((c) => c.id).join(',');
  useEffect(() => {
    if (!connected) {
      setLoading(false);
      return;
    }
    void load();
    const timer = automatic
      ? setInterval(() => {
          if (!document.hidden) void load();
        }, 60000)
      : undefined;
    return () => {
      clearInterval(timer);
      requestId.current++;
    };
  }, [connected, automatic, connectorIds, load]);

  const entries = report?.entries || [];
  const requests = entries.reduce((sum, entry) => sum + (entry.local?.requests || 0), 0);
  const tokenEntries = entries.filter((entry) => entry.local?.totalTokens !== undefined);
  const totalTokens = tokenEntries.length
    ? tokenEntries.reduce((sum, entry) => sum + entry.local!.totalTokens!, 0)
    : undefined;
  const available =
    connected && !error
      ? entries.filter((e) => ageQuota(e.quota, now).status === 'available').length
      : 0;
  const visible = connectors.filter((c) =>
    `${c.name} ${c.localIntegration || ''} ${runtimeLabels[c.runtime]}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );

  return (
    <section className="usage-page" aria-label="Usage & Quota">
      <div className="usage-toolbar">
        <div className="usage-last-check" role="status" aria-live="polite">
          <Clock3 size={14} />
          {loading
            ? 'Memeriksa pemakaian dan limit…'
            : report
              ? `Diperiksa ${time(report.checkedAt)}`
              : 'Belum diperiksa'}
        </div>
        <div className="usage-refresh-actions">
          <label>
            <input
              type="checkbox"
              checked={automatic}
              onChange={(e) => setAutomatic(e.target.checked)}
            />
            Otomatis · 60 dtk
          </label>
          <button
            className="button secondary"
            disabled={!connected || loading}
            onClick={() => void load(true)}
          >
            {loading ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}
            Perbarui
          </button>
        </div>
      </div>
      {!connected && (
        <div className="usage-callout">
          Koneksi server terputus. Data yang ditampilkan belum diperbarui.
        </div>
      )}
      {error && (
        <div className="error-banner" role="alert">
          <CircleHelp size={16} />
          <span>
            {error}
            {report ? ' Data sebelumnya tetap ditampilkan.' : ''}
          </span>
        </div>
      )}
      <div className="usage-summary">
        <article>
          <span>Permintaan Agent Dock</span>
          <strong>{report ? number(requests) : '—'}</strong>
          <small>Dicatat sejak fitur usage aktif</small>
        </article>
        <article>
          <span>Token tercatat</span>
          <strong>{number(totalTokens)}</strong>
          <small>Hanya token yang dilaporkan provider</small>
        </article>
        <article>
          <span>Kuota dapat dibaca</span>
          <strong>
            {report ? available : '—'}
            <em> / {connectors.length}</em>
          </strong>
          <small>Data lama perlu diperbarui</small>
        </article>
      </div>
      <div className="usage-callout">
        <CircleHelp size={17} />
        <p>
          Pemakaian Agent Dock dan sisa kuota akun memiliki cakupan berbeda. Kuota akun dapat
          dipakai bersama aplikasi lain. Tanda <strong>—</strong> berarti data belum tersedia.
        </p>
      </div>
      <div className="usage-section-heading">
        <h2>
          Per koneksi <span>{connectors.length}</span>
        </h2>
        <div className="usage-search">
          <Search size={15} />
          <input
            aria-label="Cari koneksi usage"
            placeholder="Cari koneksi…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      <div className="usage-grid" aria-busy={loading}>
        {visible.map((connector) => {
          const entry = entries.find((e) => e.connectorId === connector.id);
          const aged = entry ? ageQuota(entry.quota, now) : undefined;
          const quota: QuotaSnapshot | undefined =
            aged && (!connected || !!error) && aged.status === 'available'
              ? { ...aged, status: 'stale' }
              : aged;
          const local = entry?.local;
          return (
            <article className="usage-card" key={connector.id}>
              <div className="usage-card-heading">
                <div>
                  <span className="usage-provider-icon">
                    <Gauge size={19} />
                  </span>
                  <div>
                    <h3>{connector.name}</h3>
                    <small>
                      {runtimeLabels[connector.runtime]}
                      {entry ? ` · ${entry.activeSessions} sesi aktif` : ''}
                    </small>
                  </div>
                </div>
                {quota ? (
                  <QuotaStatus quota={quota} />
                ) : (
                  <span className="quota-status unavailable">Belum diperiksa</span>
                )}
              </div>
              <div className="usage-local-stats">
                <div>
                  <span>Permintaan</span>
                  <strong>{number(local?.requests)}</strong>
                </div>
                <div>
                  <span>Token masuk</span>
                  <strong>{number(local?.inputTokens)}</strong>
                </div>
                <div>
                  <span>Token keluar</span>
                  <strong>{number(local?.outputTokens)}</strong>
                </div>
              </div>
              {local && (
                <p className="usage-coverage">
                  {local.measuredRequests} dari {local.requests} permintaan memiliki data token
                  {local.cachedTokens !== undefined
                    ? ` · ${number(local.cachedTokens)} token cache (bagian dari token masuk)`
                    : ''}
                  .
                </p>
              )}
              {!local && connector.runtime === 'terminal' && (
                <p className="usage-coverage">
                  Token dan jumlah prompt CLI belum dilaporkan ke Agent Dock.
                </p>
              )}
              {quota?.windows.length ? (
                <div className="quota-meters">
                  {quota.windows.map((window) => (
                    <QuotaMeter
                      key={window.id}
                      window={window}
                      stale={quota.status === 'stale' || !connected || !!error}
                    />
                  ))}
                </div>
              ) : (
                <div className="quota-unavailable">
                  <Gauge size={21} />
                  <span>Sisa kuota belum tersedia</span>
                </div>
              )}
              {quota && <p className="usage-note">{quota.note}</p>}
              {quota?.accountTokens !== undefined && (
                <p className="usage-account-tokens">
                  Token aktivitas akun Codex: <strong>{number(quota.accountTokens)}</strong> ·
                  seluruh akun, terpisah dari Agent Dock.
                </p>
              )}
              <div className="usage-card-footer">
                <span>
                  {quota?.source || 'Menunggu pemeriksaan'}
                  {quota?.plan ? ` · ${quota.plan}` : ''}
                </span>
                {quota?.observedAt && (
                  <time
                    dateTime={quota.observedAt}
                    title={new Date(quota.observedAt).toLocaleString('id-ID')}
                  >
                    {time(quota.observedAt)}
                  </time>
                )}
              </div>
              {connector.localIntegration === '9router' && connector.baseUrl && (
                <a
                  className="text-button usage-provider-link"
                  href={new URL('/dashboard/usage', connector.baseUrl).href}
                  target="_blank"
                  rel="noreferrer"
                >
                  Buka Usage 9router
                  <ArrowUpRight size={13} />
                </a>
              )}
            </article>
          );
        })}
      </div>
      {!visible.length && (
        <div className="usage-empty">
          {connectors.length
            ? 'Tidak ada koneksi yang cocok.'
            : 'Tambahkan koneksi untuk melihat usage dan quota.'}
        </div>
      )}
      {report?.routerNote && (
        <div className="usage-callout">
          <CircleHelp size={17} />
          <p>{report.routerNote}</p>
        </div>
      )}
      {report?.router && (
        <section className="router-usage" aria-label="Statistik seluruh router">
          <div className="usage-section-heading">
            <h2>Statistik 9router</h2>
            <span className="muted">Seluruh aplikasi · riwayat tersimpan</span>
          </div>
          <div className="usage-local-stats">
            <div>
              <span>Permintaan</span>
              <strong>{number(report.router.requests)}</strong>
            </div>
            <div>
              <span>Token masuk</span>
              <strong>{number(report.router.inputTokens)}</strong>
            </div>
            <div>
              <span>Token keluar</span>
              <strong>{number(report.router.outputTokens)}</strong>
            </div>
          </div>
          {report.router.providers.length > 0 && (
            <div className="usage-table-wrap">
              <table className="usage-table">
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Permintaan</th>
                    <th>Token masuk</th>
                    <th>Token keluar</th>
                  </tr>
                </thead>
                <tbody>
                  {report.router.providers.map((provider) => (
                    <tr key={provider.name}>
                      <td>{provider.name}</td>
                      <td>{number(provider.requests)}</td>
                      <td>{number(provider.inputTokens)}</td>
                      <td>{number(provider.outputTokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="usage-note">{report.router.note}</p>
        </section>
      )}
    </section>
  );
}
