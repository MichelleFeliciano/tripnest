import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { STORAGE_FULL_EVENT, storageEstimate } from '../api/db';
import { updateNow, useUpdateState } from '../api/updates';
import { useOnline } from '../hooks/hooks';
import { percentUsed, storageLevel } from '../lib/storage';

/** A new version has been downloaded and is waiting. Never reloads on its own: the person may be in the middle of typing. */
export function UpdateBanner() {
  const { available } = useUpdateState();
  if (!available) return null;
  return (
    <div className="status-banner status-info no-print" role="status">
      <span><strong>A new version of TripNest is ready.</strong> Your trips are not affected.</span>
      <span className="row">
        <button className="btn btn-sm btn-primary" onClick={updateNow}>Update now</button>
        <Link className="btn btn-sm" to="/settings">What’s new</Link>
      </span>
    </div>
  );
}

/** Says so when there is no connection, and what still works. */
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="status-banner status-warn no-print" role="status">
      <span><strong>You’re offline.</strong> Everything you’ve saved still works and new changes are kept on this device. Maps, weather, Explore and place lookups need a connection.</span>
    </div>
  );
}

/** Warns when the device is nearly out of room for TripNest, or when a save was just refused for lack of space. */
export function StorageBanner() {
  const [level, setLevel] = useState<'ok' | 'low' | 'full' | 'unknown'>('ok');
  const [pct, setPct] = useState(0);
  const [refused, setRefused] = useState(false);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      const e = await storageEstimate();
      if (!alive || !e) return;
      setLevel(storageLevel(e.usedBytes, e.quotaBytes));
      setPct(percentUsed(e.usedBytes, e.quotaBytes));
    };
    void check();
    const timer = setInterval(() => { void check(); }, 5 * 60_000);
    const full = () => { setRefused(true); void check(); };
    window.addEventListener(STORAGE_FULL_EVENT, full);
    return () => { alive = false; clearInterval(timer); window.removeEventListener(STORAGE_FULL_EVENT, full); };
  }, []);

  if (refused) {
    return (
      <div className="status-banner status-danger no-print" role="alert">
        <span><strong>TripNest couldn’t save your last change.</strong> This device is out of room for it. Download a backup, then free up space or remove large documents.</span>
        <span className="row"><Link className="btn btn-sm" to="/profile">Back up now</Link><button className="btn btn-sm btn-ghost" onClick={() => setRefused(false)}>Dismiss</button></span>
      </div>
    );
  }
  if (level !== 'low' && level !== 'full') return null;
  return (
    <div className={`status-banner ${level === 'full' ? 'status-danger' : 'status-warn'} no-print`} role="status">
      <span><strong>{level === 'full' ? 'Storage is almost full' : 'Storage is getting full'} ({pct}% used).</strong> Download a backup, then remove large documents you no longer need.</span>
      <Link className="btn btn-sm" to="/profile">Back up now</Link>
    </div>
  );
}
