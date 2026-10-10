/** Backup reminder rules, the iPhone Home Screen tip, and sharing a file through the phone's share sheet. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const downloaded: string[] = [];
vi.mock('../src/components/ui', () => ({ download: (name: string) => { downloaded.push(name); } }));

import { BACKUP_OVERDUE_DAYS, FIRST_BACKUP_GRACE_DAYS, SNOOZE_DAYS, backupReminder, needsHomeScreenTip, snoozeUntil } from '../src/lib/reminders';
import { canShareFiles, shareOrDownload } from '../src/components/share';

const DAY = 86_400_000;
const NOW = Date.parse('2027-03-01T12:00:00Z');
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();
const base = { lastBackupAt: null, oldestTripAt: ago(100), snoozedUntil: null, now: NOW };

describe('backupReminder', () => {
  it('stays quiet with no trips', () => {
    expect(backupReminder({ ...base, oldestTripAt: null })).toEqual({ show: false });
  });
  it('waits a week before nagging someone who has never backed up', () => {
    expect(backupReminder({ ...base, oldestTripAt: ago(FIRST_BACKUP_GRACE_DAYS - 1) }).show).toBe(false);
    expect(backupReminder({ ...base, oldestTripAt: ago(FIRST_BACKUP_GRACE_DAYS) })).toEqual({ show: true, reason: 'never' });
  });
  it('reminds a month after the last backup, not before', () => {
    expect(backupReminder({ ...base, lastBackupAt: ago(BACKUP_OVERDUE_DAYS - 1) }).show).toBe(false);
    expect(backupReminder({ ...base, lastBackupAt: ago(BACKUP_OVERDUE_DAYS) })).toEqual({ show: true, reason: 'stale' });
  });
  it('a recent backup beats an old trip', () => {
    expect(backupReminder({ ...base, lastBackupAt: ago(1) }).show).toBe(false);
  });
  it('a snooze hides it until it ends', () => {
    const until = snoozeUntil(NOW);
    expect(Date.parse(until) - NOW).toBe(SNOOZE_DAYS * DAY);
    expect(backupReminder({ ...base, snoozedUntil: until }).show).toBe(false);
    expect(backupReminder({ ...base, snoozedUntil: until, now: NOW + SNOOZE_DAYS * DAY + 1 }).show).toBe(true);
  });
  it('ignores dates it cannot read', () => {
    expect(backupReminder({ ...base, oldestTripAt: 'garbage' }).show).toBe(false);
    expect(backupReminder({ ...base, snoozedUntil: 'garbage' }).show).toBe(true);
    expect(backupReminder({ ...base, lastBackupAt: 'garbage' }).show).toBe(true); // an unreadable backup date means "never"
  });
});

describe('needsHomeScreenTip', () => {
  const iphoneSafari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
  const input = (o = {}) => ({ userAgent: iphoneSafari, maxTouchPoints: 5, platform: 'iPhone', standalone: false, ...o });
  it('shows in iPhone Safari tabs', () => expect(needsHomeScreenTip(input())).toBe(true));
  it('hides once installed to the Home Screen', () => expect(needsHomeScreenTip(input({ standalone: true }))).toBe(false));
  it('recognises an iPad that calls itself a Mac', () => {
    expect(needsHomeScreenTip(input({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 }))).toBe(true);
  });
  it('is not shown on a real Mac, Android or other iOS browsers', () => {
    expect(needsHomeScreenTip(input({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 0 }))).toBe(false);
    expect(needsHomeScreenTip(input({ userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36', platform: 'Linux armv8l' }))).toBe(false);
    expect(needsHomeScreenTip(input({ userAgent: iphoneSafari.replace('Version/17.4', 'CriOS/120') }))).toBe(false);
  });
});

describe('shareOrDownload', () => {
  beforeEach(() => { downloaded.length = 0; });
  const sheet = (impl: (d: ShareData) => Promise<void>) => ({ canShare: () => true, share: vi.fn(impl) });

  it('uses the share sheet when it can take files', async () => {
    const nav = sheet(async () => undefined);
    expect(canShareFiles(nav)).toBe(true);
    expect(await shareOrDownload('t.json', '{}', 'application/json', 'Trip', nav)).toBe('shared');
    const arg = nav.share.mock.calls[0][0];
    expect(arg.files![0].name).toBe('t.json');
    expect(downloaded).toEqual([]);
  });
  it('treats closing the sheet as cancelling, not failing, and saves nothing', async () => {
    const nav = sheet(async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); });
    expect(await shareOrDownload('t.json', '{}', 'application/json', 'Trip', nav)).toBe('cancelled');
    expect(downloaded).toEqual([]);
  });
  it('falls back to a download when sharing fails for any other reason', async () => {
    const nav = sheet(async () => { throw Object.assign(new Error('x'), { name: 'NotAllowedError' }); });
    expect(await shareOrDownload('t.json', '{}', 'application/json', 'Trip', nav)).toBe('downloaded');
    expect(downloaded).toEqual(['t.json']);
  });
  it('downloads when the browser cannot share files at all', async () => {
    for (const nav of [{}, { share: async () => undefined }, { canShare: () => false, share: async () => undefined }]) {
      downloaded.length = 0;
      expect(canShareFiles(nav)).toBe(false);
      expect(await shareOrDownload('t.json', '{}', 'application/json', 'Trip', nav)).toBe('downloaded');
      expect(downloaded).toEqual(['t.json']);
    }
  });
});
