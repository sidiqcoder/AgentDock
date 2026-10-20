import { useState } from 'react';
import { Folder, Settings2 } from 'lucide-react';
import type { Session } from '../shared/types';
import DirectoryField from './DirectoryField';

export default function ProjectSettings({
  session,
  defaultPath,
  disabled,
  save,
}: {
  session: Session;
  defaultPath: string;
  disabled: boolean;
  save: (enabled: boolean, cwd: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [enabled, setEnabled] = useState(!!session.projectAccess);
  const [cwd, setCwd] = useState(session.cwd || defaultPath);
  return (
    <div className="project-settings">
      <div className="project-settings-heading">
        <span>
          <Folder size={13} /> {session.projectAccess ? 'Agent proyek' : 'Mode percakapan'}
        </span>
        <button
          type="button"
          className="text-button"
          disabled={disabled}
          onClick={() => {
            setEnabled(true);
            setCwd(session.cwd || defaultPath);
            setEditing(!editing);
          }}
        >
          <Settings2 size={12} />{' '}
          {editing ? 'Tutup' : session.projectAccess ? 'Ubah proyek' : 'Aktifkan Agent proyek'}
        </button>
      </div>
      {!editing && (
        <p className="directory-note">
          {session.projectAccess
            ? session.cwd
            : 'Aktifkan Agent proyek untuk membaca file, membuat folder, dan menulis file.'}
        </p>
      )}
      {editing && (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (await save(enabled, cwd)) setEditing(false);
          }}
        >
          <label className="project-mode">
            <input
              type="checkbox"
              checked={enabled}
              disabled={disabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />{' '}
            Agent proyek
          </label>
          {enabled && (
            <DirectoryField
              value={cwd}
              onChange={setCwd}
              defaultPath={defaultPath}
              disabled={disabled}
            />
          )}
          <p className="directory-note">
            {enabled
              ? 'Baca file di folder pilihan. Pembuatan folder dan penulisan file meminta persetujuanmu.'
              : 'Model hanya mengobrol tanpa akses file.'}
          </p>
          <button
            className="button secondary small"
            type="submit"
            disabled={disabled || (enabled && !cwd.trim())}
          >
            Simpan mode sesi
          </button>
        </form>
      )}
    </div>
  );
}
