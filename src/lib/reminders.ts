/** Rules for the "back up your trips" reminder and the iPhone Home Screen tip. Pure, so they can be tested. */

export const BACKUP_OVERDUE_DAYS = 30;
export const FIRST_BACKUP_GRACE_DAYS = 7;
export const SNOOZE_DAYS = 7;
const DAY = 86_400_000;

export type ReminderReason = 'never' | 'stale';

/**
 * Show the reminder when there is something worth protecting and no recent backup.
 *  - never backed up: wait a week after the oldest trip was made, so brand-new users are not nagged
 *  - backed up before: remind once the last backup is a month old
 * A snooze hides it until its end. Unreadable dates count as "no information" and never trigger it.
 */
export function backupReminder(i: { lastBackupAt: string | null; oldestTripAt: string | null; snoozedUntil: string | null; now: number }): { show: boolean; reason?: ReminderReason } {
  const ms = (s: string | null) => { const n = s ? Date.parse(s) : NaN; return Number.isFinite(n) ? n : null; };
  if (i.oldestTripAt === null) return { show: false }; // no trips, nothing to protect
  const snooze = ms(i.snoozedUntil);
  if (snooze !== null && snooze > i.now) return { show: false };
  const last = ms(i.lastBackupAt);
  if (last !== null) return i.now - last >= BACKUP_OVERDUE_DAYS * DAY ? { show: true, reason: 'stale' } : { show: false };
  const oldest = ms(i.oldestTripAt);
  if (oldest === null) return { show: false };
  return i.now - oldest >= FIRST_BACKUP_GRACE_DAYS * DAY ? { show: true, reason: 'never' } : { show: false };
}

export const snoozeUntil = (now: number): string => new Date(now + SNOOZE_DAYS * DAY).toISOString();

/** iPhone/iPad Safari in a normal tab (not installed to the Home Screen), where stored data is most at risk. */
export function needsHomeScreenTip(i: { userAgent: string; maxTouchPoints: number; platform: string; standalone: boolean }): boolean {
  if (i.standalone) return false;
  const iPad13 = i.platform === 'MacIntel' && i.maxTouchPoints > 1; // iPadOS reports itself as a Mac
  const ios = /iPhone|iPad|iPod/.test(i.userAgent) || iPad13;
  if (!ios) return false;
  // Other iOS browsers (Chrome, Firefox, Edge, Opera) cannot add to the Home Screen the same way; the tip is for Safari.
  return !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(i.userAgent);
}
