import { useState } from 'react';
import type { BackupFile } from '../api/backup';
import type { PlannedTrip } from '../api/merge';
import { Dialog, ErrorBanner } from './ui';

const describe = (m: NonNullable<PlannedTrip['merge']>): string => {
  const bits = [m.added && `${m.added} new`, m.updated && `${m.updated} changed`, m.removed && `${m.removed} removed`].filter(Boolean);
  return bits.length ? bits.join(', ') : 'already up to date';
};

/** Shown when a trip file contains a trip this device already has: update it, or keep both. */
export default function ImportDialog({ pending, busy, error, onChoose, onCancel }: {
  pending: { file: BackupFile; plan: PlannedTrip[] } | null; busy: boolean; error: string | null;
  onChoose: (mode: 'merge' | 'copy') => void; onCancel: () => void;
}) {
  const [mode, setMode] = useState<'merge' | 'copy'>('merge');
  const existing = pending?.plan.filter((p) => p.existing) ?? [];
  const fresh = pending?.plan.filter((p) => !p.existing) ?? [];
  return (
    <Dialog open={pending !== null} onClose={onCancel} title={existing.length === 1 ? 'You already have this trip' : 'You already have some of these trips'}>
      {pending && (
        <>
          <ul className="list">
            {existing.map((p) => <li key={p.id}><strong>{p.name}</strong><div className="muted">If you update it: {describe(p.merge!)}</div></li>)}
            {fresh.map((p) => <li key={p.id}><strong>{p.name}</strong><div className="muted">New to this device: it will be added</div></li>)}
          </ul>
          <fieldset>
            <legend>For the trips you already have</legend>
            <label className="check"><input type="radio" name="import-mode" checked={mode === 'merge'} onChange={() => setMode('merge')} /> Update my copy with the changes in this file (recommended)</label>
            <label className="check"><input type="radio" name="import-mode" checked={mode === 'copy'} onChange={() => setMode('copy')} /> Add it as a separate copy</label>
          </fieldset>
          {mode === 'merge' && <p className="muted">Where you both changed the same thing, the newer change is kept. Anything this removes goes to Recently deleted, so you can bring it back.</p>}
          <ErrorBanner message={error} />
          <div className="row">
            <button className="btn btn-primary" onClick={() => onChoose(mode)} disabled={busy}>{busy ? 'Working…' : mode === 'merge' ? 'Update my copy' : 'Add a copy'}</button>
            <button className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
          </div>
        </>
      )}
    </Dialog>
  );
}
