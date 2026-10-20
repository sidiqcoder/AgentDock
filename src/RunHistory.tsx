import { useEffect, useState } from 'react';
import { History, LoaderCircle } from 'lucide-react';
import type { Session, SessionRun } from '../shared/types';
import { statusLabels } from '../shared/types';
import { api } from './api';

export default function RunHistory({ session }: { session: Session }) {
  const [runId, setRunId] = useState('');
  const [run, setRun] = useState<SessionRun>();
  const [error, setError] = useState('');
  const runs = session.runs || [];
  const selectedId = runs.some((item) => item.id === runId) ? runId : runs.at(-1)?.id;
  useEffect(() => {
    let active = true;
    setRun(undefined);
    setError('');
    if (selectedId) {
      void api<SessionRun>(`/sessions/${session.id}/runs/${selectedId}`)
        .then((result) => {
          if (active) setRun(result);
        })
        .catch((err: Error) => {
          if (active) setError(err.message);
        });
    }
    return () => {
      active = false;
    };
  }, [session.id, selectedId]);

  if (!runs.length)
    return (
      <div className="tab-empty">
        <History size={28} />
        <h3>Belum ada proses sebelumnya.</h3>
        <p>
          Output proses saat ini ada di tab Terminal. Saat dijalankan ulang, proses sebelumnya
          disimpan di sini.
        </p>
      </div>
    );
  return (
    <div className="run-history">
      <label>
        Proses sebelumnya
        <select
          aria-label="Pilih riwayat proses"
          value={selectedId}
          onChange={(event) => setRunId(event.target.value)}
        >
          {[...runs].reverse().map((item) => (
            <option key={item.id} value={item.id}>
              {new Date(item.startedAt).toLocaleString('id-ID')} · {statusLabels[item.status]} ·{' '}
              {item.id.slice(0, 8)}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" className="detail-error">
          {error}
        </p>
      )}
      {!run && !error && (
        <p className="muted">
          <LoaderCircle size={14} className="spin" /> Memuat riwayat…
        </p>
      )}
      {run && (
        <>
          {run.cwd && <p className="directory-current mono">Direktori: {run.cwd}</p>}
          <p className="muted">
            {statusLabels[run.status]} · Berakhir {new Date(run.endedAt).toLocaleString('id-ID')}
          </p>
          {run.error && <p className="detail-error">{run.error}</p>}
          {run.summary && (
            <>
              <h3>{run.summarySource === 'output' ? 'Cuplikan output terakhir' : 'Ringkasan'}</h3>
              <pre>{run.summary}</pre>
            </>
          )}
          <h3>Output terminal tersimpan</h3>
          <pre>{run.output.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '') || 'Tidak ada output.'}</pre>
        </>
      )}
    </div>
  );
}
