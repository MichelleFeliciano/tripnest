/** Look-and-feel choices for THIS device (theme, text size). Never part of a backup. */
export type ThemeChoice = 'auto' | 'light' | 'dark';
export type TextSize = 'small' | 'normal' | 'large' | 'xlarge';
export interface Prefs { theme: ThemeChoice; textSize: TextSize }

export const TEXT_SIZES: { id: TextSize; label: string; percent: number }[] = [
  { id: 'small', label: 'Small', percent: 90 },
  { id: 'normal', label: 'Normal', percent: 100 },
  { id: 'large', label: 'Large', percent: 115 },
  { id: 'xlarge', label: 'Extra large', percent: 130 },
];
const KEY = 'tripnest:prefs';

export function getPrefs(): Prefs {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>;
    return {
      theme: s.theme === 'light' || s.theme === 'dark' ? s.theme : 'auto',
      textSize: TEXT_SIZES.some((t) => t.id === s.textSize) ? (s.textSize as TextSize) : 'normal',
    };
  } catch { return { theme: 'auto', textSize: 'normal' }; }
}

/** Put the choices on the page. "Automatic" removes the override so the device's own setting applies. */
export function applyPrefs(p: Prefs = getPrefs(), root: HTMLElement | undefined = typeof document === 'undefined' ? undefined : document.documentElement): void {
  if (!root) return;
  if (p.theme === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', p.theme);
  const pct = TEXT_SIZES.find((t) => t.id === p.textSize)?.percent ?? 100;
  root.style.fontSize = pct === 100 ? '' : `${pct}%`;
}

export function setPrefs(patch: Partial<Prefs>): Prefs {
  const next = { ...getPrefs(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable: applies until the page closes */ }
  applyPrefs(next);
  return next;
}
