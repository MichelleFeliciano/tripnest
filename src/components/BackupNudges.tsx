import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { backupFileName, exportData } from '../api/backup';
import { dismissHomeScreenTip, dismissInstallTip, getDevice, markBackedUp, snoozeBackupReminder } from '../api/device';
import type { Trip } from '../api/types';
import { useAction } from '../hooks/hooks';
import { canInstall, onInstallChange, promptInstall } from '../lib/installPrompt';
import { backupReminder, needsHomeScreenTip } from '../lib/reminders';
import { shareOrDownload } from './share';
import { useToast } from './Toast';
import { Alert, ErrorBanner } from './ui';

/** Backs up everything (documents included) through the share sheet if there is one, else as a download. */
export async function backUpEverything(): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = await exportData({ includeFiles: true });
  const result = await shareOrDownload(backupFileName(), JSON.stringify(file), 'application/json', 'TripNest backup');
  if (result !== 'cancelled') markBackedUp();
  return result;
}

const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

/** Two gentle prompts on the Trips page: add to Home Screen (iPhone Safari) and "it has been a while since your last backup". */
export default function BackupNudges({ trips }: { trips: Trip[] }) {
  const [, rerender] = useState(0);
  const act = useAction();
  const toast = useToast();
  const device = getDevice();
  useEffect(() => onInstallChange(() => rerender((n) => n + 1)), []);
  const showInstall = canInstall() && !device.install_tip_dismissed && !standalone();

  const oldest = trips.reduce<string | null>((a, t) => (a === null || t.created_at < a ? t.created_at : a), null);
  const reminder = backupReminder({ lastBackupAt: device.last_backup_at, oldestTripAt: oldest, snoozedUntil: device.backup_snoozed_until, now: Date.now() });
  const showTip = !device.home_screen_tip_dismissed && needsHomeScreenTip({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints, platform: navigator.platform, standalone: standalone() });

  const backup = async () => {
    const r = await act.run(backUpEverything);
    if (r && r !== 'cancelled') { toast.say(r === 'shared' ? 'Backup shared. Keep it somewhere safe.' : 'Backup downloaded. Keep it somewhere safe.'); rerender((n) => n + 1); }
  };

  return (
    <>
      {showInstall && (
        <Alert kind="info">
          <strong>Install TripNest.</strong> Add it to your home screen to open it like an app, even without a connection.
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn btn-sm btn-primary" onClick={() => void promptInstall()}>Install</button>
            <button className="btn btn-sm" onClick={() => { dismissInstallTip(); rerender((n) => n + 1); }}>Not now</button>
          </div>
        </Alert>
      )}
      {showTip && (
        <Alert kind="info">
          <strong>Keep your trips safe on iPhone.</strong> Safari can clear the data of websites you have not opened for about a week. Tap the Share button, then <strong>Add to Home Screen</strong>: trips opened from the Home Screen icon are not cleared that way.
          <div style={{ marginTop: 8 }}><button className="btn btn-sm" onClick={() => { dismissHomeScreenTip(); rerender((n) => n + 1); }}>Got it</button></div>
        </Alert>
      )}
      {reminder.show && (
        <Alert kind="warn">
          <strong>{reminder.reason === 'never' ? 'You have not backed up your trips yet.' : 'It has been a while since your last backup.'}</strong>{' '}
          Trips live only on this device, so a backup file is your safety net. <Link to="/profile">More options</Link>
          <ErrorBanner message={act.error} />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn btn-sm btn-primary" onClick={backup} disabled={act.busy}>{act.busy ? 'Preparing…' : 'Back up now'}</button>
            <button className="btn btn-sm" onClick={() => { snoozeBackupReminder(); rerender((n) => n + 1); }}>Remind me in a week</button>
          </div>
        </Alert>
      )}
    </>
  );
}
