import type { ProjectAction } from '../shared/types';
import { ShieldCheck } from 'lucide-react';

export default function ProjectApproval({
  action,
  disabled,
  decide,
}: {
  action: ProjectAction;
  disabled: boolean;
  decide: (approved: boolean) => void;
}) {
  return (
    <section className="project-approval" aria-label="Persetujuan perubahan proyek">
      <h3>
        <ShieldCheck size={16} /> Persetujuan perubahan
      </h3>
      <p>
        {action.tool === 'create_directory'
          ? 'Buat folder'
          : action.overwrite
            ? 'Ganti isi file'
            : 'Buat file'}
        :
      </p>
      <p className="directory-current mono">{action.path}</p>
      {action.content !== undefined && (
        <>
          <p>Isi file setelah disetujui:</p>
          <pre>{action.content || '(file kosong)'}</pre>
        </>
      )}
      <div className="approval-actions">
        <button
          className="button secondary small"
          disabled={disabled}
          onClick={() => decide(false)}
        >
          Tolak perubahan
        </button>
        <button className="button primary small" disabled={disabled} onClick={() => decide(true)}>
          Setujui perubahan
        </button>
      </div>
    </section>
  );
}
