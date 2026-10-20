import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Cable, Globe, TerminalSquare, Workflow, X } from 'lucide-react';
import type { Connector, Runtime } from '../shared/types';
import { api } from './api';

const types = [
  {
    runtime: 'terminal' as Runtime,
    name: 'CLI lokal',
    detail: 'Codex, Claude, Gemini, atau perintah lain.',
    icon: TerminalSquare,
  },
  {
    runtime: 'openai' as Runtime,
    name: 'Model API',
    detail: '9router, Ollama, dan API kompatibel OpenAI.',
    icon: Globe,
  },
  {
    runtime: 'webhook' as Runtime,
    name: 'n8n / Webhook',
    detail: 'Jalankan workflow, terima hasil dan masukan.',
    icon: Workflow,
  },
];
export default function ConnectorForm({
  connector,
  cwd,
  close,
  saved,
}: {
  connector?: Connector;
  cwd: string;
  close: () => void;
  saved: (connector: Connector) => void;
}) {
  const [runtime, setRuntime] = useState<Runtime | undefined>(connector?.runtime);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const values: Record<string, unknown> = { runtime };
    for (const [key, value] of Object.entries(data)) if (String(value).trim()) values[key] = value;
    try {
      saved(
        await api<Connector>(
          connector ? `/connectors/${connector.id}` : '/connectors',
          connector ? 'PUT' : 'POST',
          values,
        ),
      );
      close();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="modal"
      onCancel={close}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="modal-top">
        <span className="eyebrow">
          <Cable size={14} /> CONNECTIONS
        </span>
        <button className="icon-button" aria-label="Tutup" onClick={close}>
          <X size={18} />
        </button>
      </div>
      <h2>{connector ? 'Pengaturan koneksi' : 'Hubungkan cara kerjamu.'}</h2>
      <p className="muted">Agent, model, atau workflow. Semua punya tempat di sini.</p>
      {!runtime ? (
        <div className="runtime-choices">
          {types.map((type) => (
            <button
              key={type.runtime}
              onClick={() => setRuntime(type.runtime)}
              className="runtime-choice"
            >
              <span className={`provider-icon ${type.runtime}`}>
                <type.icon size={23} />
              </span>
              <span>
                <strong>{type.name}</strong>
                <small>{type.detail}</small>
              </span>
              <ArrowRight size={18} />
            </button>
          ))}
        </div>
      ) : (
        <form onSubmit={submit}>
          <div className="form-kind">
            <button type="button" onClick={() => setRuntime(undefined)} className="text-button">
              <ArrowLeft size={14} /> Jenis koneksi
            </button>
            <span>{types.find((t) => t.runtime === runtime)?.name}</span>
          </div>
          <label>
            Nama koneksi
            <input
              autoFocus
              name="name"
              required
              maxLength={100}
              defaultValue={connector?.name}
              placeholder={
                runtime === 'terminal'
                  ? 'Mis. Codex · proyek utama'
                  : runtime === 'openai'
                    ? 'Mis. 9router lokal'
                    : 'Mis. n8n · riset'
              }
            />
          </label>
          {runtime === 'terminal' ? (
            <>
              <label>
                Perintah untuk menjalankan
                <input
                  name="command"
                  required
                  defaultValue={connector?.command}
                  placeholder="codex"
                  className="mono"
                />
              </label>
              <label>
                Direktori kerja
                <input
                  name="cwd"
                  defaultValue={connector?.cwd || cwd}
                  placeholder={cwd}
                  className="mono"
                />
              </label>
              <div className="form-note">
                Memakai CLI, login, dan izin lokal yang sudah kamu siapkan. Perintah dijalankan
                melalui shell lokal.
              </div>
            </>
          ) : (
            <>
              <label>
                {runtime === 'openai' ? 'Base URL (termasuk /v1)' : 'Webhook URL'}
                <input
                  name="baseUrl"
                  type="url"
                  required
                  defaultValue={connector?.baseUrl}
                  placeholder={
                    runtime === 'openai'
                      ? 'http://localhost:20128/v1'
                      : 'http://localhost:5678/webhook/agent-dock'
                  }
                  className="mono"
                />
              </label>
              {runtime === 'openai' && (
                <label>
                  ID model
                  <input
                    name="model"
                    required
                    defaultValue={connector?.model}
                    placeholder="Salin ID model dari router kamu"
                    className="mono"
                    list="connector-model-options"
                  />
                  <datalist id="connector-model-options">
                    {connector?.availableModels?.map((model) => (
                      <option key={model} value={model} />
                    ))}
                  </datalist>
                </label>
              )}
              <div className="form-row">
                <label>
                  {runtime === 'openai' ? 'API key' : 'Bearer token'}{' '}
                  <span className="optional">opsional</span>
                  <input
                    name="apiKey"
                    type="password"
                    autoComplete="new-password"
                    placeholder={
                      connector?.hasKey
                        ? 'Tersimpan · kosongkan untuk mempertahankan'
                        : 'Disimpan hanya di server lokal'
                    }
                  />
                </label>
                <label>
                  Atau variabel lingkungan
                  <input
                    name="apiKeyEnv"
                    defaultValue={connector?.apiKeyEnv}
                    placeholder="ROUTER_API_KEY"
                    pattern="[A-Za-z_][A-Za-z0-9_]*"
                    className="mono"
                  />
                </label>
              </div>
              {runtime === 'openai' && (
                <label>
                  Instruksi sistem <span className="optional">opsional</span>
                  <textarea
                    name="systemPrompt"
                    rows={3}
                    defaultValue={connector?.systemPrompt}
                    placeholder="Bagaimana model ini harus membantu kamu?"
                  />
                </label>
              )}
              <div className="form-note">
                {runtime === 'openai'
                  ? 'Mendukung percakapan teks dan mode Agent proyek. Aktifkan akses proyek pada sesi untuk membaca file dan mengusulkan perubahan. Eksekusi perintah shell tersedia melalui CLI agent atau workflow.'
                  : 'Kirim tugas melalui POST. Workflow dapat melaporkan status dan meminta masukan melalui callback. Lihat README untuk kontraknya.'}{' '}
                Kredensial tersimpan dalam file lokal .data; gunakan variabel lingkungan jika
                diperlukan.
              </div>
            </>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button type="button" className="button secondary" onClick={close}>
              Batal
            </button>
            <button disabled={busy} className="button primary" type="submit">
              {busy ? 'Menyimpan…' : connector ? 'Simpan perubahan' : 'Tambahkan koneksi'}
              <ArrowRight size={15} />
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
