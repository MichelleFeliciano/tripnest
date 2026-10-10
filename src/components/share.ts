/** Hand a file to the phone's share sheet when it supports files; otherwise save it like a normal download. */
import { download } from './ui';

type ShareNav = { canShare?: (d: ShareData) => boolean; share?: (d: ShareData) => Promise<void> };

export function canShareFiles(nav: ShareNav = navigator, probe?: File): boolean {
  try {
    const f = probe ?? new File(['x'], 'probe.json', { type: 'application/json' });
    return typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [f] });
  } catch { return false; }
}

export type ShareResult = 'shared' | 'downloaded' | 'cancelled';

/**
 * Opens the share sheet (AirDrop, Messages, email, Files…). If sharing files is unavailable it downloads instead.
 * Closing the sheet without choosing is not an error. Any other failure falls back to a download so the data is never lost.
 */
export async function shareOrDownload(filename: string, content: string, mime: string, title: string, nav: ShareNav = navigator): Promise<ShareResult> {
  const file = new File([content], filename, { type: mime });
  if (canShareFiles(nav, file)) {
    try {
      await nav.share!({ files: [file], title });
      return 'shared';
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') return 'cancelled';
    }
  }
  download(filename, content, mime);
  return 'downloaded';
}
