import { snoozeUntil } from '../lib/reminders';

/**
 * Small per-device notes (last backup, snooze, dismissed tips). Kept apart from Settings on purpose: restoring
 * a backup replaces Settings, but "when did I last back up on THIS device" must not travel with a backup file.
 */
export interface DeviceState {
  last_backup_at: string | null;
  backup_snoozed_until: string | null;
  home_screen_tip_dismissed: boolean;
}
const KEY = 'tripnest:device';
const EMPTY: DeviceState = { last_backup_at: null, backup_snoozed_until: null, home_screen_tip_dismissed: false };

export function getDevice(): DeviceState {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<DeviceState>;
    const date = (v: unknown) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null);
    return { last_backup_at: date(s.last_backup_at), backup_snoozed_until: date(s.backup_snoozed_until), home_screen_tip_dismissed: s.home_screen_tip_dismissed === true };
  } catch { return { ...EMPTY }; }
}
function save(patch: Partial<DeviceState>) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...getDevice(), ...patch })); } catch { /* storage unavailable: the reminder just shows again */ }
}
export const markBackedUp = () => save({ last_backup_at: new Date().toISOString(), backup_snoozed_until: null });
export const snoozeBackupReminder = () => save({ backup_snoozed_until: snoozeUntil(Date.now()) });
export const dismissHomeScreenTip = () => save({ home_screen_tip_dismissed: true });
