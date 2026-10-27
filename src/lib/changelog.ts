import raw from '../../CHANGELOG.md?raw';

export interface ChangelogEntry { version: string; date: string; notes: string[] }

/** Reads CHANGELOG.md: "## 1.1.0 - 2026-10-26" headings, each followed by "- note" lines. Newest first. */
export function parseChangelog(text: string): ChangelogEntry[] {
  const out: ChangelogEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const h = /^##\s+(\d+\.\d+\.\d+)\s*[-–]\s*(\d{4}-\d{2}-\d{2})\s*$/.exec(line);
    if (h) { out.push({ version: h[1], date: h[2], notes: [] }); continue; }
    const n = /^-\s+(.+?)\s*$/.exec(line);
    if (n && out.length) out[out.length - 1].notes.push(n[1]);
  }
  return out;
}

/** -1, 0 or 1. Missing or malformed parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const p = (v: string) => v.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const x = p(a); const y = p(b);
  for (let i = 0; i < 3; i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d !== 0) return d < 0 ? -1 : 1; }
  return 0;
}

/** Entries newer than `seen` and no newer than `current`. With no `seen`, only the current version's entry. */
export function entriesSince(entries: ChangelogEntry[], seen: string | null, current: string): ChangelogEntry[] {
  return entries.filter((e) => compareVersions(e.version, current) <= 0 && (seen === null ? e.version === current : compareVersions(e.version, seen) > 0));
}

export const CHANGELOG = parseChangelog(raw);
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
export const BUILD_DATE: string = typeof __BUILD_DATE__ === 'string' ? __BUILD_DATE__ : '';
