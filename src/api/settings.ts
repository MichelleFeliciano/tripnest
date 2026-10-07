import { browserTimeZone, isValidTimeZone } from '../lib/time';

/** Per-device preferences. Stored in this browser only. */
export interface Settings {
  display_name: string;
  home_timezone: string;
}
const KEY = 'tripnest:settings';

export function getSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<Settings>;
      return {
        display_name: typeof s.display_name === 'string' ? s.display_name.slice(0, 80) : '',
        home_timezone: typeof s.home_timezone === 'string' && isValidTimeZone(s.home_timezone) ? s.home_timezone : browserTimeZone(),
      };
    }
  } catch { /* storage unavailable or corrupt: fall through to defaults */ }
  return { display_name: '', home_timezone: browserTimeZone() };
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify({ display_name: s.display_name.trim().slice(0, 80), home_timezone: s.home_timezone })); } catch { /* ignore */ }
}
