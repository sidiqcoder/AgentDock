import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUp, Folder, FolderOpen, LoaderCircle } from 'lucide-react';
import type { DirectoryListing } from '../shared/types';
import { api } from './api';

export default function DirectoryField({
  value,
  onChange,
  defaultPath,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  defaultPath: string;
  disabled?: boolean;
}) {
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [location, setLocation] = useState('');
  const [listing, setListing] = useState<DirectoryListing>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);
  useEffect(
    () => () => {
      requestId.current++;
    },
    [],
  );

  async function browse(directory: string) {
    const id = ++requestId.current;
    setLocation(directory);
    setLoading(true);
    setError('');
    try {
      const result = await api<DirectoryListing>(
        `/directories?path=${encodeURIComponent(directory || defaultPath)}`,
      );
      if (id !== requestId.current) return;
      setListing(result);
      setLocation(result.path);
    } catch (err) {
      if (id === requestId.current) setError((err as Error).message);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }

  return (
    <div className="directory-field">
      <label htmlFor={inputId}>Workspace (direktori kerja)</label>
      <div className="directory-input-row">
        <input
          id={inputId}
          className="mono"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={defaultPath}
          required
          maxLength={4096}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          className="button secondary small"
          aria-expanded={open}
          aria-controls={`${inputId}-browser`}
          disabled={disabled}
          onClick={() => {
            if (open) {
              requestId.current++;
              setLoading(false);
            } else {
              void browse(value.trim() || defaultPath);
            }
            setOpen(!open);
          }}
        >
          <FolderOpen size={15} /> {open ? 'Tutup' : 'Telusuri'}
        </button>
      </div>
      {open && (
        <div
          id={`${inputId}-browser`}
          className="directory-browser"
          role="group"
          aria-label="Telusuri direktori"
        >
          <div className="directory-shortcuts">
            <button
              type="button"
              className="text-button"
              onClick={() => void browse(defaultPath)}
              disabled={disabled}
            >
              Folder default
            </button>
            {listing?.shortcuts.map((shortcut) => (
              <button
                key={shortcut.path}
                type="button"
                className="text-button"
                onClick={() => void browse(shortcut.path)}
                disabled={disabled}
              >
                {shortcut.name}
              </button>
            ))}
          </div>
          <div className="directory-input-row">
            <input
              aria-label="Alamat folder"
              className="mono"
              value={location}
              disabled={disabled}
              onChange={(event) => setLocation(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void browse(location);
                }
              }}
            />
            <button
              type="button"
              className="button secondary small"
              onClick={() => void browse(location)}
              disabled={loading || disabled}
            >
              Buka
            </button>
          </div>
          {loading ? (
            <p role="status" className="muted">
              <LoaderCircle size={14} className="spin" /> Memuat folder…
            </p>
          ) : error ? (
            <p role="alert" className="form-error">
              {error}
            </p>
          ) : (
            listing && (
              <>
                <p className="directory-current mono">{listing.path}</p>
                <div className="directory-list">
                  {listing.parent && (
                    <button
                      type="button"
                      onClick={() => void browse(listing.parent!)}
                      disabled={disabled}
                    >
                      <ArrowUp size={14} /> Folder induk
                    </button>
                  )}
                  {listing.directories.map((directory) => (
                    <button
                      key={directory.path}
                      type="button"
                      onClick={() => void browse(directory.path)}
                      disabled={disabled}
                    >
                      <Folder size={14} /> {directory.name}
                    </button>
                  ))}
                  {!listing.directories.length && <p className="muted">Tidak ada subfolder.</p>}
                </div>
                <button
                  type="button"
                  className="button secondary small"
                  disabled={disabled}
                  onClick={() => {
                    onChange(listing.path);
                    setOpen(false);
                  }}
                >
                  Pilih folder ini
                </button>
              </>
            )
          )}
        </div>
      )}
    </div>
  );
}
