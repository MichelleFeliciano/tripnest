export type StorageLevel = 'ok' | 'low' | 'full' | 'unknown';

/** How full the browser's allowance for this site is. "low" from 80%, "full" from 95%. */
export function storageLevel(usedBytes: number, quotaBytes: number): StorageLevel {
  if (!(quotaBytes > 0) || !Number.isFinite(usedBytes) || usedBytes < 0) return 'unknown';
  const f = usedBytes / quotaBytes;
  return f >= 0.95 ? 'full' : f >= 0.8 ? 'low' : 'ok';
}
export const percentUsed = (used: number, quota: number) => (quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0);
