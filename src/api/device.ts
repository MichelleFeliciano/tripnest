import { snoozeUntil } from '../lib/reminders';
import type { TempUnit } from '../lib/weather';

/**
 * Small per-device notes (last backup, snooze, dismissed tips). Kept apart from Settings on purpose: restoring
 * a backup replaces Settings, but "when did I last back up on THIS device" must not travel with a backup file.
 */
export interface DeviceState {
  last_backup_at: string | null;
  backup_snoozed_until: string | null;
  home_screen_tip_dismissed: boolean;
  /** Weather sends a destination's coordinates to Open-Meteo, so it is off until the person turns it on. */
  weather_on: boolean;
  temp_unit: TempUnit | null;
}
const KEY = 'tripnest:device';
const EMPTY: DeviceState = { last_backup_at: null, backup_snoozed_until: null, home_screen_tip_dismissed: false, weather_on: false, temp_unit: null };

export function getDevice(): DeviceState {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<DeviceState>;
    const date = (v: unknown) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null);
    return { last_backup_at: date(s.last_backup_at), backup_snoozed_until: date(s.backup_snoozed_until), home_screen_tip_dismissed: s.home_screen_tip_dismissed === true, weather_on: s.weather_on === true, temp_unit: s.temp_unit === 'F' || s.temp_unit === 'C' ? s.temp_unit : null };
  } catch { return { ...EMPTY }; }
}
function save(patch: Partial<DeviceState>) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...getDevice(), ...patch })); } catch { /* storage unavailable: the reminder just shows again */ }
}
export const markBackedUp = () => save({ last_backup_at: new Date().toISOString(), backup_snoozed_until: null });
export const snoozeBackupReminder = () => save({ backup_snoozed_until: snoozeUntil(Date.now()) });
export const setWeatherOn = (on: boolean) => save({ weather_on: on });
export const setTempUnit = (u: TempUnit) => save({ temp_unit: u });
export const dismissHomeScreenTip = () => save({ home_screen_tip_dismissed: true });
