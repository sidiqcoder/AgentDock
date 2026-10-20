import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Box,
  Cable,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Command,
  Copy,
  FileText,
  Folder,
  Globe,
  Gauge,
  History,
  LayoutDashboard,
  LoaderCircle,
  Maximize2,
  MessageSquare,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Square,
  TerminalSquare,
  Trash2,
  Workflow,
  X,
} from 'lucide-react';
import type {
  Connector,
  ExternalSession,
  Runtime,
  Session,
  Snapshot,
  Status,
} from '../shared/types';
import { runtimeLabels, statusLabels } from '../shared/types';
import { api } from './api';
import ConnectorForm from './ConnectorForm';
import TerminalView, { type TerminalEvent } from './TerminalView';
import RunHistory from './RunHistory';
import DirectoryField from './DirectoryField';
import TerminalLauncher from './TerminalLauncher';
import ProjectSettings from './ProjectSettings';
import ProjectApproval from './ProjectApproval';
const UsageQuota = lazy(() => import('./UsageQuota'));

const icons = { terminal: TerminalSquare, openai: Globe, webhook: Workflow };
const filters: { id: Status | 'all'; label: string }[] = [
  { id: 'all', label: 'Semua sesi' },
  { id: 'running', label: 'Berjalan' },
  { id: 'waiting', label: 'Butuh masukan' },
  { id: 'completed', label: 'Selesai' },
  { id: 'idle', label: 'Belum berjalan' },
  { id: 'failed', label: 'Gagal' },
  { id: 'stopped', label: 'Dihentikan' },
];
function isHistory(session: Session) {
  return !session.alive && ['completed', 'failed', 'stopped'].includes(session.status);
}
function relative(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
  return seconds < 60
    ? 'baru saja'
    : seconds < 3600
      ? `${Math.floor(seconds / 60)} mnt lalu`
      : seconds < 86400
        ? `${Math.floor(seconds / 3600)} jam lalu`
        : `${Math.floor(seconds / 86400)} hari lalu`;
}
function ProviderIcon({
  runtime,
  name = '',
  small = false,
}: {
  runtime: Runtime;
  name?: string;
  small?: boolean;
}) {
  const Icon = icons[runtime];
  return (
    <span
      className={`provider-icon ${runtime} ${small ? 'small' : ''} ${name.toLowerCase().includes('claude') ? 'claude' : ''}`}
    >
      {name.toLowerCase().includes('claude') ? (
        <span className="claude-mark">✳</span>
      ) : (
        <Icon size={small ? 16 : 22} strokeWidth={1.6} />
      )}
    </span>
  );
}
function Badge({ status }: { status: Status }) {
  return (
    <span className={`badge ${status}`}>
      <i />
      {statusLabels[status]}
    </span>
  );
}

export default function App() {
  const [data, setData] = useState<Snapshot>({ sessions: [], connectors: [], cwd: '' });
  const [ready, setReady] = useState(false);
  const [connected, setConnected] = useState(false);
  const [page, setPage] = useState<
    'dashboard' | 'sessions' | 'history' | 'connections' | 'activity' | 'usage'
  >('dashboard');
  const [filter, setFilter] = useState<Status | 'all'>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const [tab, setTab] = useState<'live' | 'summary' | 'activity' | 'history'>('live');
  const [agentId, setAgentId] = useState('all');
  const [sort, setSort] = useState<'latest' | 'oldest'>('latest');
  const [connectorModal, setConnectorModal] = useState<Connector | 'new'>();
  const [sessionModal, setSessionModal] = useState<Connector | 'choose'>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [message, setMessage] = useState('');
  const socket = useRef<WebSocket | null>(null);
  const outputListeners = useRef(new Set<(event: TerminalEvent) => void>());
  const chatEnd = useRef<HTMLDivElement>(null);
  const selected = data.sessions.find((session) => session.id === selectedId);
  const selectedConnector = data.connectors.find(
    (connector) => connector.id === selected?.connectorId,
  );
  const waiting = data.sessions.filter((session) => session.status === 'waiting');
  const counts = (status: Status) =>
    data.sessions.filter((session) => session.status === status).length;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 30000);
    return () => clearInterval(timer);
  }, []);
  void tick;
  useEffect(() => {
    let active = true;
    let retry: ReturnType<typeof setTimeout>;
    async function connect() {
      try {
        const snapshot = await api<Snapshot>('/bootstrap');
        if (!active) return;
        setData(snapshot);
        setReady(true);
        const ws = new WebSocket(
          `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`,
        );
        socket.current = ws;
        ws.onopen = () => {
          if (active) setConnected(true);
        };
        ws.onmessage = (event) => {
          if (!active) return;
          try {
            const payload = JSON.parse(event.data);
            if (payload.type === 'snapshot') setData(payload.data);
            if (payload.type === 'output')
              for (const listener of outputListeners.current) listener(payload);
            if (payload.type === 'error') setError(payload.error);
          } catch {
            setError('Pesan dari server tidak dapat dibaca.');
          }
        };
        ws.onclose = () => {
          if (active) {
            setConnected(false);
            retry = setTimeout(connect, 2000);
          }
        };
        ws.onerror = () => ws.close();
      } catch (err) {
        if (active) {
          setError((err as Error).message);
          retry = setTimeout(connect, 3000);
        }
      }
    }
    void connect();
    return () => {
      active = false;
      clearTimeout(retry);
      socket.current?.close();
    };
  }, []);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(''), 3500);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected?.messages, selectedId]);
  useEffect(() => {
    setMessage('');
    setTab('live');
  }, [selectedId]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key !== '/' ||
        (event.target as HTMLElement)?.matches('input, textarea, select, [contenteditable]') ||
        document.querySelector('dialog[open]')
      )
        return;
      const input = document.querySelector<HTMLInputElement>('input[aria-label="Cari sesi"]');
      if (input) {
        event.preventDefault();
        input.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const send = useCallback((value: unknown) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(value));
  }, []);
  const subscribeOutput = useCallback((listener: (event: TerminalEvent) => void) => {
    outputListeners.current.add(listener);
    return () => {
      outputListeners.current.delete(listener);
    };
  }, []);
  async function action(key: string, callback: () => Promise<unknown>) {
    if (busy) return false;
    setBusy(key);
    setError('');
    try {
      await callback();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy('');
    }
  }
  const select = (session: Session) => {
    setSelectedId(session.id);
    if (page !== 'sessions' && page !== 'history') setPage('dashboard');
  };
  const openSessions = (destination: 'sessions' | 'history', connectorId = 'all') => {
    setPage(destination);
    setAgentId(connectorId);
    setFilter('all');
    setQuery('');
    setSelectedId(undefined);
    setExpanded(false);
  };
  const showFilter = (value: Status | 'all') => {
    setFilter(value);
    setAgentId('all');
    setPage('dashboard');
  };
  async function demo() {
    await action('demo', async () => {
      const session = await api<Session>('/demo', 'POST', {});
      setSelectedId(session.id);
      setPage('dashboard');
      setFilter('all');
      setAgentId('all');
      setQuery('');
    });
  }
  async function createSession(
    connector: Connector,
    name: string,
    model?: string,
    cwd?: string,
    projectAccess = false,
  ) {
    await action('create', async () => {
      const session = await api<Session>('/sessions', 'POST', {
        connectorId: connector.id,
        name,
        model,
        cwd,
        projectAccess,
      });
      setSelectedId(session.id);
      setSessionModal(undefined);
      setPage('dashboard');
      setFilter('all');
      setAgentId(connector.id);
      setQuery('');
    });
  }
  async function resumeSession(
    connector: Connector,
    externalSessionId: string,
    agent: 'opencode' | 'codex',
    name?: string,
    cwd?: string,
  ) {
    await action('resume', async () => {
      const session = await api<Session>('/external-sessions/resume', 'POST', {
        connectorId: connector.id,
        externalSessionId,
        agent,
        name,
        cwd,
      });
      setSelectedId(session.id);
      setSessionModal(undefined);
      setPage('dashboard');
      setFilter('all');
      setAgentId(connector.id);
      setQuery('');
      setNotice(`Sesi ${agent === 'opencode' ? 'OpenCode' : 'Codex'} berhasil dihubungkan.`);
    });
  }
  async function importLocal() {
    await action('import-local', async () => {
      const result = await api<{ connectors: Connector[]; warnings: string[] }>(
        '/integrations/local/import',
        'POST',
        {},
      );
      setNotice(`${result.connectors.length} koneksi lokal berhasil dihubungkan.`);
      if (result.warnings.length) setError(result.warnings.join(' '));
    });
  }
  async function submitMessage() {
    if (!selected || !message.trim()) return;
    await action('message', async () => {
      await api(`/sessions/${selected.id}/message`, 'POST', { message });
      setMessage('');
    });
  }
  const historyCount = data.sessions.filter(isHistory).length;
  const sessions = data.sessions
    .filter(
      (session) =>
        (page !== 'history' || isHistory(session)) &&
        (page !== 'sessions' || !isHistory(session)) &&
        (agentId === 'all' || session.connectorId === agentId) &&
        (filter === 'all' || session.status === filter) &&
        `${session.name} ${session.connectorName} ${session.model || ''} ${session.summary} ${session.messages.map((item) => item.content).join(' ')}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    )
    .sort((a, b) =>
      sort === 'latest'
        ? b.updatedAt.localeCompare(a.updatedAt)
        : a.updatedAt.localeCompare(b.updatedAt),
    );
  const globalActivity = data.sessions
    .flatMap((session) => session.activity.map((event) => ({ ...event, session })))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 100);
  const activeCount = data.sessions.filter((session) => session.alive).length;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            setPage('dashboard');
          }}
        >
          <span className="brand-mark">
            A<span />
          </span>
          <span>
            agent<span className="brand-light">dock</span>
            <sup>v1</sup>
          </span>
        </a>
        <div className="workspace-switch">
          <div className="workspace-avatar">
            <Box size={17} />
          </div>
          <div>
            <strong>Personal workspace</strong>
            <small>
              <i /> Local environment
            </small>
          </div>
          <ChevronDown size={14} />
        </div>
        <span className="nav-caption">WORKSPACE</span>
        <nav className="main-nav" aria-label="Navigasi utama">
          <button
            className={page === 'dashboard' ? 'active' : ''}
            onClick={() => showFilter('all')}
          >
            <LayoutDashboard size={17} />
            Overview<span className="nav-count">{data.sessions.length}</span>
          </button>
          <button
            className={page === 'sessions' ? 'active' : ''}
            title="Sessions"
            onClick={() => openSessions('sessions')}
          >
            <TerminalSquare size={17} />
            Sessions<span className="nav-count">{data.sessions.length - historyCount}</span>
          </button>
          <button
            className={page === 'history' ? 'active' : ''}
            title="History"
            onClick={() => openSessions('history')}
          >
            <History size={17} />
            History<span className="nav-count">{historyCount}</span>
          </button>
          <button
            className={page === 'connections' ? 'active' : ''}
            onClick={() => setPage('connections')}
          >
            <Cable size={17} />
            Koneksi<span className="nav-count">{data.connectors.length}</span>
          </button>
          <button className={page === 'usage' ? 'active' : ''} onClick={() => setPage('usage')}>
            <Gauge size={17} />
            Usage & Quota
          </button>
          <button
            className={page === 'activity' ? 'active' : ''}
            onClick={() => setPage('activity')}
          >
            <Activity size={17} />
            Aktivitas
          </button>
        </nav>
        <div className="nav-section-title">
          <span className="nav-caption">PERLU PERHATIAN</span>
          <span className={`attention-count ${waiting.length ? 'has-items' : ''}`}>
            {waiting.length}
          </span>
        </div>
        <button
          className={`attention-nav ${waiting.length ? 'has-items' : ''}`}
          onClick={() => showFilter('waiting')}
        >
          <MessageSquare size={16} />
          Menunggu masukan
          <ChevronRight size={14} />
        </button>
        <div className="sidebar-sessions">
          <div className="nav-section-title">
            <span className="nav-caption">SESI TERBARU</span>
            <button
              className="icon-button"
              aria-label="Sesi baru"
              onClick={() => setSessionModal('choose')}
            >
              <Plus size={15} />
            </button>
          </div>
          {[...data.sessions]
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .slice(0, 5)
            .map((session) => (
              <button
                key={session.id}
                className={`sidebar-session ${selectedId === session.id ? 'selected' : ''}`}
                onClick={() => select(session)}
              >
                <i className={`status-dot ${session.status}`} />
                <span>{session.name}</span>
                <ArrowUpRight size={12} />
              </button>
            ))}
          {!data.sessions.length && (
            <p className="sidebar-empty">
              Sesi pertama kamu
              <br />
              akan muncul di sini.
            </p>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="local-card">
            <span className="local-card-icon">
              <ShieldCheck size={18} />
            </span>
            <strong>Runs on your machine.</strong>
            <p>CLI tetap lokal. Koneksi API mengikuti endpoint pilihanmu.</p>
            <span className="mono">
              <i /> 127.0.0.1:{location.port || '80'}
            </span>
          </div>
          <div className="profile">
            <span className="profile-avatar">Y</span>
            <div>
              <strong>Your workspace</strong>
              <small>Personal · Local</small>
            </div>
            <span className="version mono">0.1.0</span>
          </div>
        </div>
      </aside>
      <main className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>
              {page === 'dashboard'
                ? 'Overview'
                : page === 'sessions'
                  ? 'Sessions'
                  : page === 'history'
                    ? 'History'
                    : page === 'connections'
                      ? 'Koneksi'
                      : page === 'usage'
                        ? 'Usage & Quota'
                        : 'Aktivitas'}
            </strong>
          </div>
          <div className="topbar-right">
            <span className={`connection-indicator ${connected ? 'online' : ''}`}>
              <i />
              {connected
                ? 'Local server connected'
                : ready
                  ? 'Menghubungkan ulang…'
                  : 'Menghubungkan…'}
            </span>
            <span className="top-divider" />
            <button
              className="icon-button notification"
              aria-label="Lihat sesi yang membutuhkan masukan"
              onClick={() => showFilter('waiting')}
            >
              <Bell size={18} />
              {waiting.length > 0 && <i />}
            </button>
            <span className="user-avatar">Y</span>
          </div>
        </header>
        <div className="page-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span className="tiny-line" />
                YOUR LOCAL COMMAND CENTER
              </div>
              <h1>
                {page === 'dashboard'
                  ? 'Semua agent. Satu kendali.'
                  : page === 'sessions'
                    ? 'Beberapa sesi. Satu agent.'
                    : page === 'history'
                      ? 'Pekerjaan lalu, tetap tersimpan.'
                      : page === 'connections'
                        ? 'Terhubung, dengan caramu.'
                        : page === 'usage'
                          ? 'Pemakaian jelas. Limit terpantau.'
                          : 'Setiap langkah, tercatat.'}
              </h1>
              <p>
                {page === 'dashboard'
                  ? 'Pantau pekerjaan, beri arahan, dan lanjutkan dari tempat yang sama.'
                  : page === 'sessions'
                    ? 'Jalankan beberapa sesi sekaligus dan pindah sesi tanpa menghentikan pekerjaan.'
                    : page === 'history'
                      ? 'Buka kembali percakapan, output terminal, dan hasil sesi di Agent Dock.'
                      : page === 'connections'
                        ? 'Satukan CLI lokal, model dari router, dan workflow n8n.'
                        : page === 'usage'
                          ? 'Periksa token, sisa kuota, dan waktu reset setiap koneksi.'
                          : 'Ikuti perjalanan tugas dan keputusan di seluruh sesi.'}
              </p>
            </div>
            <button
              className="button primary"
              onClick={() =>
                page === 'connections'
                  ? setConnectorModal('new')
                  : setSessionModal(
                      data.connectors.find((connector) => connector.id === agentId) || 'choose',
                    )
              }
            >
              <Plus size={17} />
              {page === 'connections' ? 'Tambah koneksi' : 'Sesi baru'}
            </button>
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <CircleHelp size={17} />
              <span>{error}</span>
              <button className="icon-button" onClick={() => setError('')} aria-label="Tutup error">
                <X size={16} />
              </button>
            </div>
          )}
          {(page === 'dashboard' || page === 'sessions' || page === 'history') && (
            <>
              {page === 'dashboard' && (
                <section className="stats-grid" aria-label="Ringkasan status">
                  {[
                    {
                      status: 'running' as Status,
                      label: 'Sedang berjalan',
                      icon: Activity,
                      note: 'Agent mengerjakan tugas',
                      color: 'green',
                    },
                    {
                      status: 'waiting' as Status,
                      label: 'Butuh masukan',
                      icon: MessageSquare,
                      note: 'Giliranmu untuk merespons',
                      color: 'amber',
                    },
                    {
                      status: 'completed' as Status,
                      label: 'Tugas selesai',
                      icon: CheckCheck,
                      note: 'Siap untuk langkah berikutnya',
                      color: 'blue',
                    },
                    {
                      status: 'idle' as Status,
                      label: 'Siap dijalankan',
                      icon: Clock3,
                      note: 'Menunggu tugas pertamanya',
                      color: 'gray',
                    },
                  ].map((stat) => (
                    <button
                      className={`stat-card ${stat.color} ${filter === stat.status ? 'chosen' : ''}`}
                      key={stat.status}
                      onClick={() => showFilter(stat.status)}
                    >
                      <div className="stat-top">
                        <span>{stat.label}</span>
                        <stat.icon size={17} />
                      </div>
                      <div className="stat-number">
                        {String(counts(stat.status)).padStart(2, '0')}
                        <span className={`mini-chart ${stat.color}`}>
                          {[9, 15, 11, 21, 18, 27, 23, 32].map((height, index) => (
                            <i key={index} style={{ height, opacity: 0.15 + index * 0.09 }} />
                          ))}
                        </span>
                      </div>
                      <small>
                        <i />
                        {stat.note}
                      </small>
                    </button>
                  ))}
                </section>
              )}
              {page !== 'history' && waiting.length > 0 && (
                <button
                  className="attention-banner"
                  onClick={() => {
                    const next = waiting.find((s) => s.id !== selectedId) || waiting[0];
                    select(next);
                    setTab('live');
                  }}
                >
                  <span className="attention-icon">
                    <MessageSquare size={18} />
                  </span>
                  <span>
                    <strong>{waiting.length} sesi menunggu keputusanmu</strong>
                    <small>
                      {waiting[0].question || 'Buka sesi dan berikan masukan untuk melanjutkan.'}
                    </small>
                  </span>
                  <span className="attention-action">
                    Tinjau sekarang
                    <ArrowRight size={15} />
                  </span>
                </button>
              )}
              <section
                className={`workspace-grid ${selected ? 'has-selection' : ''} ${expanded ? 'detail-expanded' : ''}`}
              >
                <div className="sessions-section">
                  <div className="section-heading">
                    <h2>
                      {page === 'history' ? 'Riwayat sesi' : 'Sesi agent'}{' '}
                      <span>{sessions.length}</span>
                    </h2>
                    <button className="text-button" onClick={() => setPage('connections')}>
                      Kelola koneksi
                      <ArrowUpRight size={13} />
                    </button>
                  </div>
                  <div className="session-agent-toolbar">
                    <label>
                      Agent
                      <select
                        aria-label="Filter agent"
                        value={agentId}
                        onChange={(event) => setAgentId(event.target.value)}
                      >
                        <option value="all">Semua agent</option>
                        {data.connectors.map((connector) => (
                          <option key={connector.id} value={connector.id}>
                            {connector.name} (
                            {
                              data.sessions.filter(
                                (session) => session.connectorId === connector.id && session.alive,
                              ).length
                            }{' '}
                            aktif)
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Urutan
                      <select
                        aria-label="Urutan sesi"
                        value={sort}
                        onChange={(event) => setSort(event.target.value as 'latest' | 'oldest')}
                      >
                        <option value="latest">Terakhir diperbarui</option>
                        <option value="oldest">Paling lama diperbarui</option>
                      </select>
                    </label>
                    <button
                      className="button secondary small"
                      onClick={() =>
                        setSessionModal(
                          data.connectors.find((connector) => connector.id === agentId) || 'choose',
                        )
                      }
                    >
                      <Plus size={14} /> Sesi baru
                    </button>
                  </div>
                  <div className="session-toolbar">
                    <div className="filter-tabs">
                      {filters
                        .filter((item) =>
                          page === 'history'
                            ? ['all', 'completed', 'failed', 'stopped'].includes(item.id)
                            : page === 'sessions'
                              ? ['all', 'running', 'waiting', 'idle', 'completed'].includes(item.id)
                              : true,
                        )
                        .map((item) => (
                          <button
                            className={filter === item.id ? 'active' : ''}
                            key={item.id}
                            onClick={() => setFilter(item.id)}
                          >
                            {item.label}
                            {item.id === 'waiting' && waiting.length > 0 && (
                              <span>{waiting.length}</span>
                            )}
                          </button>
                        ))}
                    </div>
                    <label className="search-box">
                      <Search size={15} />
                      <input
                        aria-label="Cari sesi"
                        placeholder="Cari sesi…"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                      />
                      <kbd>/</kbd>
                    </label>
                  </div>
                  {!sessions.length ? (
                    <div className="empty-state">
                      <div className="empty-orbit">
                        <span />
                        <span />
                        <span />
                        <TerminalSquare size={28} />
                      </div>
                      <span className="eyebrow">
                        {data.sessions.length ? 'TAKE A BREATHER' : 'READY WHEN YOU ARE'}
                      </span>
                      <h3>
                        {data.sessions.length
                          ? 'Belum ada sesi di sini.'
                          : page === 'history'
                            ? 'Belum ada riwayat sesi.'
                            : 'Ruang kerja siap. Mulai satu sesi.'}
                      </h3>
                      <p>
                        {data.sessions.length
                          ? 'Coba filter lain atau buat sesi baru untuk tugas berikutnya.'
                          : page === 'history'
                            ? 'Sesi yang selesai, gagal, atau dihentikan akan muncul di sini.'
                            : 'Hubungkan agent favoritmu, beri tugas, dan ikuti setiap langkahnya dari sini.'}
                      </p>
                      <div className="empty-actions">
                        <button
                          className="button primary"
                          onClick={() => setSessionModal('choose')}
                        >
                          <Plus size={15} />
                          {data.sessions.length || page === 'history'
                            ? 'Buat sesi baru'
                            : 'Buat sesi pertama'}
                        </button>
                        <button
                          className="button secondary"
                          disabled={!!busy || !connected}
                          onClick={demo}
                        >
                          {busy === 'demo' ? (
                            <LoaderCircle size={15} className="spin" />
                          ) : (
                            <Play size={14} />
                          )}
                          Coba demo lokal
                        </button>
                      </div>
                      <span className="empty-footnote">
                        Demo memakai proses lokal. Tanpa API key.
                      </span>
                    </div>
                  ) : (
                    <div className="session-list">
                      {sessions.map((session) => (
                        <button
                          className={`session-card ${selectedId === session.id ? 'selected' : ''}`}
                          key={session.id}
                          onClick={() => select(session)}
                        >
                          <div className="session-card-top">
                            <ProviderIcon runtime={session.runtime} name={session.connectorName} />
                            <div className="session-title">
                              <h3>{session.name}</h3>
                              <span>
                                {session.connectorName}
                                <span className="separator">/</span>
                                {runtimeLabels[session.runtime]}
                                {session.externalSessionId && (
                                  <>
                                    <span className="separator">/</span>
                                    {session.externalAgent === 'opencode' ? 'OpenCode' : 'Codex'}
                                  </>
                                )}
                              </span>
                            </div>
                            <Badge status={session.status} />
                          </div>
                          <p className={session.status === 'waiting' ? 'question-preview' : ''}>
                            {session.error ||
                              session.question ||
                              session.summary ||
                              session.messages.at(-1)?.content ||
                              (isHistory(session)
                                ? 'Buka sesi untuk melihat output dan aktivitas sebelumnya.'
                                : 'Sesi siap. Jalankan agent atau kirim tugas pertamamu.')}
                          </p>
                          <div className="session-card-bottom">
                            <span>
                              <Folder size={12} />
                              {session.runtime === 'terminal' || session.projectAccess
                                ? (
                                    session.cwd ||
                                    data.connectors.find((c) => c.id === session.connectorId)?.cwd
                                  )
                                    ?.split(/[\\/]/)
                                    .filter(Boolean)
                                    .at(-1) || 'Local workspace'
                                : session.runtime === 'openai'
                                  ? session.model ||
                                    data.connectors.find((c) => c.id === session.connectorId)?.model
                                  : 'Workflow'}
                            </span>
                            <span>
                              {session.alive && <span className="session-alive">Aktif · </span>}
                              {relative(session.updatedAt)}
                              <ArrowUpRight size={13} />
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="sessions-footer">
                    <span>
                      <i className="status-dot running" />
                      {activeCount} sesi aktif di workspace ini
                    </span>
                    <span className="mono">LOCAL FIRST. HUMAN IN CONTROL.</span>
                  </div>
                </div>
                {selected && (
                  <section className="detail-panel" aria-label={`Detail sesi ${selected.name}`}>
                    <div className="detail-header">
                      <ProviderIcon
                        runtime={selected.runtime}
                        name={selected.connectorName}
                        small
                      />
                      <div>
                        <h2>{selected.name}</h2>
                        <span>{selected.connectorName}</span>
                      </div>
                      <div className="detail-header-actions">
                        {selectedConnector && (
                          <button
                            className="icon-button"
                            aria-label="Sesi baru dari agent ini"
                            title="Sesi baru dari agent ini"
                            onClick={() => setSessionModal(selectedConnector)}
                          >
                            <Plus size={16} />
                          </button>
                        )}
                        <button
                          className="icon-button"
                          aria-label={expanded ? 'Perkecil sesi' : 'Perbesar sesi'}
                          onClick={() => setExpanded(!expanded)}
                        >
                          <Maximize2 size={15} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label="Tutup detail"
                          onClick={() => {
                            setSelectedId(undefined);
                            setExpanded(false);
                          }}
                        >
                          <X size={17} />
                        </button>
                      </div>
                    </div>
                    <div className="session-metadata">
                      {(selected.runtime === 'terminal' || selected.projectAccess) && (
                        <span className="session-directory mono">
                          <Folder size={12} /> {selected.cwd || selectedConnector?.cwd || data.cwd}
                        </span>
                      )}
                      {selected.externalSessionId && (
                        <span className="mono" title={`ID: ${selected.externalSessionId}`}>
                          <TerminalSquare size={12} />{' '}
                          {selected.externalAgent === 'opencode' ? 'OpenCode' : 'Codex'}:{' '}
                          {selected.externalSessionId.slice(0, 14)}…
                        </span>
                      )}
                      <span>Dibuat {new Date(selected.createdAt).toLocaleString('id-ID')}</span>
                      <span>
                        {
                          data.sessions.filter(
                            (session) =>
                              session.connectorId === selected.connectorId && session.alive,
                          ).length
                        }{' '}
                        sesi aktif dari agent ini
                      </span>
                    </div>
                    <div className="detail-status">
                      <Badge status={selected.status} />
                      <span className="mono">
                        {selected.alive ? '● SESSION ACTIVE' : '○ SESSION INACTIVE'}
                      </span>
                    </div>
                    {selected.runtime === 'openai' && (
                      <ProjectSettings
                        key={selected.id}
                        session={selected}
                        defaultPath={data.cwd}
                        disabled={!!busy || !connected || selected.alive}
                        save={(enabled, cwd) =>
                          action('project', () =>
                            api(`/sessions/${selected.id}/project`, 'POST', { enabled, cwd }),
                          )
                        }
                      />
                    )}
                    {selectedConnector?.localIntegration === 'antigravity' && (
                      <div className="detail-integration-note">
                        Prompt memerlukan bridge native di Antigravity IDE. Pertanyaan dan ringkasan
                        otomatis tersedia jika agent IDE menjalankan pelaporan dalam tugas. Memutus
                        adapter tidak menghentikan tugas di IDE.
                      </div>
                    )}
                    <div className="detail-tabs">
                      <button
                        className={tab === 'live' ? 'active' : ''}
                        onClick={() => setTab('live')}
                      >
                        {selected.runtime === 'terminal' ? (
                          <TerminalSquare size={14} />
                        ) : (
                          <MessageSquare size={14} />
                        )}
                        {selected.runtime === 'terminal' ? 'Terminal' : 'Percakapan'}
                      </button>
                      <button
                        className={tab === 'summary' ? 'active' : ''}
                        onClick={() => setTab('summary')}
                      >
                        <FileText size={14} />
                        Ringkasan{selected.summary && <i />}
                      </button>
                      <button
                        className={tab === 'activity' ? 'active' : ''}
                        onClick={() => setTab('activity')}
                      >
                        <Activity size={14} />
                        Aktivitas
                      </button>
                      {selected.runtime === 'terminal' && (
                        <button
                          className={tab === 'history' ? 'active' : ''}
                          onClick={() => setTab('history')}
                        >
                          <History size={14} /> Riwayat proses{' '}
                          {selected.runs?.length ? `(${selected.runs.length})` : ''}
                        </button>
                      )}
                    </div>
                    {selected.question && !selected.pendingAction && (
                      <div className="question-box">
                        <MessageSquare size={16} />
                        <div>
                          <strong>Agent membutuhkan masukanmu</strong>
                          <p>{selected.question}</p>
                        </div>
                      </div>
                    )}
                    {selected.error && <div className="detail-error">{selected.error}</div>}
                    <div className="detail-body">
                      {tab === 'history' && <RunHistory session={selected} />}
                      {tab === 'live' &&
                        (selected.runtime === 'terminal' ? (
                          <>
                            <div className="terminal-chrome">
                              <span>
                                <i />
                                <i />
                                <i />
                              </span>
                              <span className="mono">
                                {selectedConnector?.command?.slice(0, 70)}
                              </span>
                              <span className="mono">PTY</span>
                            </div>
                            <TerminalView
                              id={selected.id}
                              connected={connected}
                              send={send}
                              subscribeOutput={subscribeOutput}
                            />
                            {!selected.alive && (
                              <TerminalLauncher
                                key={selected.id}
                                session={selected}
                                defaultPath={selectedConnector?.cwd || data.cwd}
                                disabled={!!busy || !connected}
                                start={(cwd) =>
                                  action('start', () =>
                                    api(`/sessions/${selected.id}/start`, 'POST', { cwd }),
                                  )
                                }
                              />
                            )}
                          </>
                        ) : (
                          <div className="chat-messages">
                            {!selected.messages.length && (
                              <div className="chat-empty">
                                <ProviderIcon runtime={selected.runtime} />
                                <h3>
                                  {selected.runtime === 'openai'
                                    ? 'Mulai percakapan.'
                                    : 'Beri workflow sebuah tugas.'}
                                </h3>
                                <p>
                                  {selected.runtime === 'openai'
                                    ? `Pesanmu akan dikirim ke ${selected.model || selectedConnector?.model}.`
                                    : 'Kirim instruksi dan pantau status workflow di sini.'}
                                </p>
                              </div>
                            )}
                            {selected.messages
                              .filter((msg) => msg.content || selected.status === 'running')
                              .map((msg) => (
                                <div className={`chat-message ${msg.role}`} key={msg.id}>
                                  <div className="message-label">
                                    {msg.role === 'user' ? (
                                      <ArrowUpRight size={13} />
                                    ) : (
                                      <ArrowDownLeft size={13} />
                                    )}
                                    {msg.role === 'user' ? 'Kamu' : selected.connectorName}
                                    <time>
                                      {new Date(msg.at).toLocaleTimeString('id-ID', {
                                        hour: '2-digit',
                                        minute: '2-digit',
                                      })}
                                    </time>
                                  </div>
                                  <div className="message-content">
                                    {msg.content || (
                                      <span className="muted">Menyiapkan jawaban…</span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            {selected.status === 'running' && (
                              <div className="working-indicator">
                                <LoaderCircle size={14} className="spin" />
                                {selected.runtime === 'webhook'
                                  ? 'Workflow berjalan · menunggu hasil atau callback'
                                  : 'Model sedang menjawab…'}
                              </div>
                            )}
                            {selected.pendingAction && (
                              <ProjectApproval
                                action={selected.pendingAction}
                                disabled={!!busy || !connected}
                                decide={(approved) =>
                                  action('approval', () =>
                                    api(`/sessions/${selected.id}/approval`, 'POST', {
                                      actionId: selected.pendingAction!.id,
                                      approved,
                                    }),
                                  )
                                }
                              />
                            )}
                            <div ref={chatEnd} />
                          </div>
                        ))}
                      {tab === 'summary' && (
                        <div className="summary-content">
                          {selected.summary ? (
                            <>
                              <div className="summary-label">
                                <CheckCheck size={18} />
                                <span>
                                  {selected.summarySource === 'output'
                                    ? 'Cuplikan output terakhir'
                                    : 'Hasil dari agent'}
                                </span>
                                <button
                                  className="icon-button"
                                  aria-label="Salin ringkasan"
                                  onClick={() =>
                                    action('copy', async () => {
                                      await navigator.clipboard.writeText(selected.summary);
                                      setNotice('Ringkasan disalin.');
                                    })
                                  }
                                >
                                  <Copy size={14} />
                                </button>
                              </div>
                              {selected.summarySource === 'output' && (
                                <p className="summary-note">
                                  CLI belum mengirim ringkasan melalui hook. Berikut cuplikan
                                  terminal, yang mungkin berisi tampilan antarmuka.
                                </p>
                              )}
                              <pre>{selected.summary}</pre>
                              <div className="summary-next">
                                <ArrowRight size={16} />
                                <span>
                                  {selected.runtime === 'terminal' && !selected.alive
                                    ? 'Jalankan ulang agent untuk tugas baru. Pemulihan konteks mengikuti kemampuan CLI.'
                                    : 'Kirim instruksi berikutnya untuk melanjutkan sesi ini.'}
                                </span>
                              </div>
                            </>
                          ) : (
                            <div className="tab-empty">
                              <FileText size={28} />
                              <h3>Hasilnya akan ada di sini.</h3>
                              <p>
                                Model dan workflow mengirim hasil otomatis. Untuk CLI, hubungkan
                                hook ringkasan atau lihat cuplikan output saat proses berakhir.
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                      {tab === 'activity' && (
                        <div className="activity-list">
                          {selected.activity
                            .slice()
                            .reverse()
                            .map((event) => (
                              <div className="activity-item" key={event.id}>
                                <i />
                                <div>
                                  <p>{event.text}</p>
                                  <time>{new Date(event.at).toLocaleString('id-ID')}</time>
                                </div>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                    <div className="detail-bottom">
                      {selected.runtime === 'terminal' && selected.alive && (
                        <div className="manual-status">
                          <span>Status CLI</span>
                          <select
                            aria-label="Ubah status CLI"
                            value={
                              ['running', 'waiting', 'completed'].includes(selected.status)
                                ? selected.status
                                : 'running'
                            }
                            onChange={(event) =>
                              action('status', () =>
                                api(`/sessions/${selected.id}/status`, 'POST', {
                                  status: event.target.value,
                                }),
                              )
                            }
                          >
                            <option value="running">Berjalan</option>
                            <option value="waiting">Butuh masukan</option>
                            <option value="completed">Selesai</option>
                          </select>
                          <span title="Gunakan hook untuk laporan status otomatis.">
                            <CircleHelp size={13} />
                          </span>
                        </div>
                      )}
                      <div className="composer">
                        <textarea
                          aria-label="Pesan untuk agent"
                          placeholder={
                            selected.status === 'waiting'
                              ? 'Jawab permintaan agent…'
                              : selected.status === 'completed'
                                ? 'Apa langkah berikutnya?'
                                : 'Kirim tugas atau instruksi…'
                          }
                          value={message}
                          onChange={(event) => setMessage(event.target.value)}
                          rows={2}
                          disabled={
                            !connected ||
                            (selected.runtime === 'terminal'
                              ? !selected.alive
                              : selected.runtime === 'openai'
                                ? selected.alive
                                : selected.status === 'running')
                          }
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                              event.preventDefault();
                              void submitMessage();
                            }
                          }}
                        />
                        <div className="composer-footer">
                          <span>
                            <Command size={12} />
                            Enter untuk kirim <span>·</span> Shift + Enter baris baru
                          </span>
                          <button
                            className="send-button"
                            aria-label="Kirim pesan"
                            disabled={
                              !!busy ||
                              !connected ||
                              !message.trim() ||
                              (selected.runtime === 'terminal'
                                ? !selected.alive
                                : selected.runtime === 'openai'
                                  ? selected.alive
                                  : selected.status === 'running')
                            }
                            onClick={submitMessage}
                          >
                            {busy === 'message' ? (
                              <LoaderCircle size={16} className="spin" />
                            ) : (
                              <ArrowUpRight size={18} />
                            )}
                          </button>
                        </div>
                      </div>
                      <div className="session-controls">
                        <span className="mono">{selected.id.slice(0, 8)}</span>
                        {selected.alive ? (
                          <button
                            className="text-button danger"
                            disabled={!!busy}
                            onClick={() =>
                              action('stop', () => api(`/sessions/${selected.id}/stop`, 'POST', {}))
                            }
                          >
                            <Square size={11} />
                            {selected.runtime === 'webhook'
                              ? 'Hentikan pemantauan'
                              : selectedConnector?.localIntegration === 'antigravity'
                                ? 'Putuskan adapter IDE'
                                : 'Hentikan sesi'}
                          </button>
                        ) : (
                          <button
                            className="text-button muted"
                            disabled={!!busy}
                            onClick={() =>
                              action('delete', async () => {
                                await api(`/sessions/${selected.id}`, 'DELETE');
                                setSelectedId(undefined);
                              })
                            }
                          >
                            <Trash2 size={12} />
                            Hapus sesi
                          </button>
                        )}
                      </div>
                    </div>
                  </section>
                )}
              </section>
              {!selected && (
                <div className="integration-strip">
                  <div>
                    <Cable size={18} />
                    <span>Bekerja dengan alat yang sudah kamu pakai.</span>
                  </div>
                  <div className="integration-names">
                    <span>
                      <TerminalSquare size={15} />
                      Codex
                    </span>
                    <span className="claude-text">✳ Claude Code</span>
                    <span>
                      <Globe size={15} />
                      9router
                    </span>
                    <span>
                      <Workflow size={15} />
                      n8n
                    </span>
                    <span className="more-integrations">+ CLI & API lainnya</span>
                  </div>
                </div>
              )}
            </>
          )}
          {page === 'usage' && (
            <Suspense fallback={<p className="muted">Memuat usage & quota…</p>}>
              <UsageQuota connectors={data.connectors} connected={connected} />
            </Suspense>
          )}
          {page === 'connections' && (
            <>
              <div className="connections-intro">
                <Cable size={18} />
                <p>
                  <strong>Koneksi adalah konfigurasi. Sesi adalah pekerjaan.</strong> Buat beberapa
                  sesi dari satu koneksi untuk menangani tugas yang berbeda.
                </p>
                <button
                  className="button secondary"
                  disabled={!!busy || !connected}
                  onClick={importLocal}
                >
                  {busy === 'import-local' ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : (
                    <Cable size={15} />
                  )}
                  Hubungkan instalasi lokal
                </button>
              </div>
              <div className="connections-grid">
                {data.connectors.map((connector) => (
                  <article className="connector-card" key={connector.id}>
                    <div className="connector-card-header">
                      <ProviderIcon runtime={connector.runtime} name={connector.name} />
                      <button
                        className="icon-button"
                        aria-label={`Pengaturan ${connector.name}`}
                        onClick={() => setConnectorModal(connector)}
                      >
                        <Settings2 size={17} />
                      </button>
                    </div>
                    <h3>{connector.name}</h3>
                    <span className="connector-type">{runtimeLabels[connector.runtime]}</span>
                    {connector.localIntegration && (
                      <span className="local-integration-label">
                        Terdeteksi di komputer ini
                        {connector.availableModels
                          ? ` · ${connector.availableModels.length} model`
                          : ''}
                      </span>
                    )}
                    <code>
                      {connector.runtime === 'terminal' ? connector.command : connector.baseUrl}
                    </code>
                    <p>
                      {connector.runtime === 'terminal'
                        ? connector.cwd
                        : connector.runtime === 'openai'
                          ? connector.model
                          : 'POST · status callback'}
                    </p>
                    <div className="connector-sessions">
                      <button
                        className="text-button"
                        onClick={() => openSessions('sessions', connector.id)}
                      >
                        <i className="status-dot running" />
                        {
                          data.sessions.filter(
                            (session) => session.connectorId === connector.id && session.alive,
                          ).length
                        }{' '}
                        aktif
                        <span>
                          {' '}
                          /{' '}
                          {
                            data.sessions.filter(
                              (session) =>
                                session.connectorId === connector.id && !isHistory(session),
                            ).length
                          }{' '}
                          sesi
                        </span>
                      </button>
                      <button
                        className="text-button"
                        onClick={() => openSessions('history', connector.id)}
                      >
                        <History size={13} />
                        {
                          data.sessions.filter(
                            (session) => session.connectorId === connector.id && isHistory(session),
                          ).length
                        }{' '}
                        riwayat
                      </button>
                    </div>
                    {connector.integrationNote && (
                      <div className="connector-note">{connector.integrationNote}</div>
                    )}
                    {connector.runtime === 'openai' && (
                      <div className="bridge-actions">
                        <button
                          className="text-button"
                          disabled={!!busy || !connected}
                          onClick={() =>
                            action(`test-${connector.id}`, async () => {
                              const result = await api<{ message: string; latencyMs: number }>(
                                `/connectors/${connector.id}/test`,
                                'POST',
                                {},
                              );
                              setNotice(
                                `${result.message} (${(result.latencyMs / 1000).toFixed(1)} dtk)`,
                              );
                            })
                          }
                        >
                          {busy === `test-${connector.id}` ? (
                            <LoaderCircle size={13} className="spin" />
                          ) : (
                            <Cable size={13} />
                          )}
                          Uji koneksi
                        </button>
                        <span className="directory-note muted">
                          Mengirim satu pesan teks singkat ke model.
                        </span>
                      </div>
                    )}
                    {connector.localIntegration === 'antigravity' && (
                      <div className="bridge-actions">
                        <a
                          className="text-button"
                          href="/api/integrations/antigravity/extension"
                          download
                        >
                          Unduh bridge IDE
                          <ArrowDownLeft size={13} />
                        </a>
                        <button
                          className="text-button"
                          disabled={!!busy}
                          onClick={() =>
                            action('check-bridge', async () => {
                              const status = await api<{ connected: boolean }>(
                                '/integrations/antigravity/status',
                              );
                              if (status.connected) setNotice('Panel agent Antigravity terhubung.');
                              else
                                setError(
                                  'Bridge belum aktif. Pasang VSIX, buka folder proyek ini di Antigravity IDE, lalu jalankan Agent Dock: Connect workspace.',
                                );
                            })
                          }
                        >
                          Periksa bridge
                          <Cable size={13} />
                        </button>
                      </div>
                    )}
                    <div className="connector-footer">
                      <span>
                        <i />
                        {connector.runtime === 'terminal'
                          ? 'Konfigurasi lokal'
                          : connector.hasKey
                            ? 'Kredensial tersedia'
                            : 'Tanpa kredensial'}
                      </span>
                      <button className="text-button" onClick={() => setSessionModal(connector)}>
                        Buat sesi
                        <ArrowRight size={14} />
                      </button>
                    </div>
                    <button
                      className="delete-connector"
                      aria-label={`Hapus koneksi ${connector.name}`}
                      onClick={() =>
                        action('remove-connector', () =>
                          api(`/connectors/${connector.id}`, 'DELETE'),
                        )
                      }
                    >
                      <Trash2 size={12} />
                    </button>
                  </article>
                ))}
                <button className="add-connector-card" onClick={() => setConnectorModal('new')}>
                  <span>
                    <Plus size={23} />
                  </span>
                  <strong>Tambahkan koneksi</strong>
                  <small>Alatmu berikutnya, di workspace yang sama.</small>
                </button>
              </div>
            </>
          )}
          {page === 'activity' && (
            <section className="global-activity">
              <div className="section-heading">
                <h2>
                  Aktivitas terbaru <span>{globalActivity.length}</span>
                </h2>
                <span className="live-label">
                  <i />
                  LIVE UPDATES
                </span>
              </div>
              {globalActivity.length ? (
                globalActivity.map((event) => (
                  <button
                    className="global-activity-row"
                    key={event.id}
                    onClick={() => select(event.session)}
                  >
                    <ProviderIcon
                      runtime={event.session.runtime}
                      name={event.session.connectorName}
                      small
                    />
                    <div>
                      <strong>{event.session.name}</strong>
                      <p>{event.text}</p>
                    </div>
                    <time>{relative(event.at)}</time>
                    <ArrowUpRight size={15} />
                  </button>
                ))
              ) : (
                <div className="tab-empty">
                  <Activity size={28} />
                  <h3>Belum ada aktivitas.</h3>
                  <p>Jalankan sesi pertama untuk mulai mencatat perjalanan tugas.</p>
                </div>
              )}
            </section>
          )}
          <footer className="page-footer">
            <span>
              Agent Dock <span className="muted">/</span> Personal command center
            </span>
            <span>
              <ShieldCheck size={12} />
              Kamu yang memegang kendali.
            </span>
          </footer>
        </div>
      </main>
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
      {connectorModal && (
        <ConnectorForm
          connector={connectorModal === 'new' ? undefined : connectorModal}
          cwd={data.cwd}
          close={() => setConnectorModal(undefined)}
          saved={() => setNotice('Koneksi berhasil disimpan.')}
        />
      )}
      {sessionModal && (
        <SessionModal
          connectors={data.connectors}
          defaultCwd={data.cwd}
          error={error}
          initial={sessionModal === 'choose' ? undefined : sessionModal}
          close={() => setSessionModal(undefined)}
          create={createSession}
          resume={resumeSession}
          busy={!!busy}
          addConnector={() => {
            setSessionModal(undefined);
            setConnectorModal('new');
          }}
        />
      )}
    </div>
  );
}

function SessionModal({
  connectors,
  defaultCwd,
  error,
  initial,
  close,
  create,
  resume,
  busy,
  addConnector,
}: {
  connectors: Connector[];
  defaultCwd: string;
  error: string;
  initial?: Connector;
  close: () => void;
  create: (
    connector: Connector,
    name: string,
    model?: string,
    cwd?: string,
    projectAccess?: boolean,
  ) => void;
  resume: (
    connector: Connector,
    externalSessionId: string,
    agent: 'opencode' | 'codex',
    name?: string,
    cwd?: string,
  ) => void;
  busy: boolean;
  addConnector: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [id, setId] = useState(initial?.id || connectors[0]?.id || '');
  const [name, setName] = useState('');
  const [model, setModel] = useState('');
  const [cwd, setCwd] = useState('');
  const [projectAccess, setProjectAccess] = useState(false);
  const [sessionMode, setSessionMode] = useState<'new' | 'resume'>('new');
  const [externalSessions, setExternalSessions] = useState<ExternalSession[]>([]);
  const [loadingExt, setLoadingExt] = useState(false);
  const [selectedExtId, setSelectedExtId] = useState('');
  const [extError, setExtError] = useState('');

  const current = connectors.find((c) => c.id === id);
  const isOpenCode =
    current?.localIntegration === 'opencode' ||
    current?.id === 'local-opencode' ||
    current?.name.toLowerCase().includes('opencode');

  useEffect(() => {
    setModel(current?.model || '');
    setCwd(current?.cwd || defaultCwd);
    setProjectAccess(false);
    setSessionMode('new');
  }, [id]);

  useEffect(() => {
    if (sessionMode === 'resume' && isOpenCode) {
      setLoadingExt(true);
      setExtError('');
      api<{ sessions: ExternalSession[] }>('/external-sessions?agent=opencode')
        .then((res) => {
          const list = res.sessions || [];
          setExternalSessions(list);
          if (list.length) {
            setSelectedExtId(list[0].id);
          }
        })
        .catch((err) => {
          setExtError((err as Error).message);
        })
        .finally(() => setLoadingExt(false));
    }
  }, [sessionMode, isOpenCode]);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const selectedExt = externalSessions.find((s) => s.id === selectedExtId);

  return (
    <dialog
      className="modal session-modal"
      ref={dialog}
      onCancel={close}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="modal-top">
        <span className="eyebrow">
          <TerminalSquare size={14} />
          {sessionMode === 'resume' ? 'RESUME EXTERNAL SESSION' : 'NEW SESSION'}
        </span>
        <button className="icon-button" aria-label="Tutup" onClick={close}>
          <X size={18} />
        </button>
      </div>
      <h2>{sessionMode === 'resume' ? 'Lanjutkan sesi yang ada.' : 'Satu sesi, satu fokus.'}</h2>
      <p className="muted">
        {sessionMode === 'resume'
          ? 'Pilih sesi agent eksternal untuk dibuka dan dilanjutkan di Agent Dock.'
          : 'Pilih koneksi dan siapkan ruang untuk tugas berikutnya.'}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const connector = connectors.find((c) => c.id === id);
          if (!connector) return;
          if (sessionMode === 'resume' && selectedExtId) {
            resume(
              connector,
              selectedExtId,
              'opencode',
              name.trim() || selectedExt?.title,
              selectedExt?.directory,
            );
            return;
          }
          create(
            connector,
            name,
            connector.runtime === 'openai' ? model : undefined,
            connector.runtime === 'terminal' || projectAccess ? cwd.trim() : undefined,
            connector.runtime === 'openai' && projectAccess,
          );
        }}
      >
        <label>
          Gunakan koneksi
          <select value={id} onChange={(event) => setId(event.target.value)} required>
            {connectors.map((connector) => (
              <option key={connector.id} value={connector.id}>
                {connector.name} · {runtimeLabels[connector.runtime]}
              </option>
            ))}
          </select>
        </label>

        {isOpenCode && (
          <div className="session-mode-switch">
            <button
              type="button"
              className={`session-mode-btn ${sessionMode === 'new' ? 'active' : ''}`}
              onClick={() => setSessionMode('new')}
            >
              Sesi Baru (Kosong)
            </button>
            <button
              type="button"
              className={`session-mode-btn ${sessionMode === 'resume' ? 'active' : ''}`}
              onClick={() => setSessionMode('resume')}
            >
              Lanjutkan Sesi OpenCode Lokal
            </button>
          </div>
        )}

        {sessionMode === 'resume' ? (
          <>
            {loadingExt ? (
              <div className="form-note">
                <LoaderCircle size={14} className="spin" /> Memuat daftar sesi OpenCode lokal…
              </div>
            ) : extError ? (
              <div className="form-error">{extError}</div>
            ) : externalSessions.length === 0 ? (
              <div className="form-note">
                Tidak ditemukan sesi OpenCode lokal pada komputer ini.
              </div>
            ) : (
              <>
                <label>
                  Pilih sesi OpenCode
                  <select
                    value={selectedExtId}
                    onChange={(event) => setSelectedExtId(event.target.value)}
                    required
                  >
                    {externalSessions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title} — {s.directory}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedExt && (
                  <div className="form-note" style={{ fontSize: '11px' }}>
                    <div>
                      <strong>Judul:</strong> {selectedExt.title}
                    </div>
                    <div>
                      <strong>Workspace:</strong> {selectedExt.directory || '—'}
                    </div>
                    <div>
                      <strong>ID Sesi:</strong> <code>{selectedExt.id}</code>
                    </div>
                    {selectedExt.updatedAt && (
                      <div>
                        <strong>Terakhir aktif:</strong> {relative(selectedExt.updatedAt)}
                      </div>
                    )}
                  </div>
                )}
                <label>
                  Nama sesi di dashboard <span className="optional">opsional</span>
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={150}
                    placeholder={selectedExt?.title || 'Judul sesi'}
                  />
                </label>
              </>
            )}
          </>
        ) : (
          <>
            {current?.runtime === 'openai' && (
              <label className="project-mode">
                <input
                  type="checkbox"
                  checked={projectAccess}
                  onChange={(event) => setProjectAccess(event.target.checked)}
                  disabled={busy}
                />{' '}
                Agent proyek · akses file di folder pilihan
              </label>
            )}
            {(current?.runtime === 'terminal' ||
              (current?.runtime === 'openai' && projectAccess)) && (
              <>
                <DirectoryField
                  key={id}
                  value={cwd}
                  onChange={setCwd}
                  defaultPath={current.cwd || defaultCwd}
                  disabled={busy}
                />
                <p className="muted directory-note">
                  Folder ini menjadi workspace sesi. Agent akan bekerja pada proyek di dalamnya.
                  {projectAccess && ' Penulisan file dan pembuatan folder meminta persetujuanmu.'}
                </p>
              </>
            )}
            {current?.runtime === 'openai' && (
              <label>
                Model untuk sesi ini
                <input
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  list="session-model-options"
                  required
                  placeholder="Pilih ID model"
                />
                <datalist id="session-model-options">
                  {(current.availableModels || [current.model || '']).map((value) => (
                    <option key={value} value={value} />
                  ))}
                </datalist>
                {current.availableModels && (
                  <small className="model-count">
                    {current.availableModels.length} model tersedia dari endpoint lokal.
                  </small>
                )}
              </label>
            )}
            <button type="button" className="text-button add-inline" onClick={addConnector}>
              <Plus size={13} />
              Hubungkan CLI, model API, atau n8n baru
            </button>
            <label>
              Nama sesi <span className="optional">opsional</span>
              <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={150}
                placeholder="Mis. Refactor autentikasi"
              />
            </label>
            <div className="form-note">
              Sesi dibuat dalam status belum berjalan. Kamu bisa memeriksa pengaturannya sebelum
              menjalankan tugas.
            </div>
          </>
        )}

        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={close}>
            Batal
          </button>
          <button
            className="button primary"
            type="submit"
            disabled={busy || !id || (sessionMode === 'resume' && !selectedExtId)}
          >
            {busy ? 'Memproses…' : sessionMode === 'resume' ? 'Lanjutkan sesi ini' : 'Buat sesi'}
            <ArrowRight size={15} />
          </button>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </dialog>
  );
}
