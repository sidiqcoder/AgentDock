import { useState } from 'react';
import { Play } from 'lucide-react';
import type { Session } from '../shared/types';
import DirectoryField from './DirectoryField';

export default function TerminalLauncher({
  session,
  defaultPath,
  disabled,
  start,
}: {
  session: Session;
  defaultPath: string;
  disabled: boolean;
  start: (cwd: string) => void;
}) {
  const [cwd, setCwd] = useState(session.cwd || defaultPath);
  return (
    <form
      className="terminal-launcher"
      onSubmit={(event) => {
        event.preventDefault();
        if (cwd.trim()) start(cwd.trim());
      }}
    >
      <DirectoryField value={cwd} onChange={setCwd} defaultPath={defaultPath} disabled={disabled} />
      <div className="terminal-idle">
        <span>
          {session.status === 'idle'
            ? 'Pilih folder proyek, lalu jalankan agent.'
            : 'Proses telah berakhir. Pilih folder untuk menjalankan ulang.'}
        </span>
        <button className="button small primary" type="submit" disabled={disabled || !cwd.trim()}>
          <Play size={13} /> {session.status === 'idle' ? 'Jalankan agent' : 'Jalankan ulang'}
        </button>
      </div>
    </form>
  );
}
