import { test, expect } from '@playwright/test';
import { seedSampleTrip } from './fixtures';

test('backup with several documents works in a real browser (transactions close early if slow work happens inside)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  const tripId = await seedSampleTrip(page); // the sample trip already has one document
  const result = await page.evaluate(async (id) => {
    const apiPath = '/src/api/api.ts';
    const backupPath = '/src/api/backup.ts';
    const api = await import(/* @vite-ignore */ apiPath);
    const backup = await import(/* @vite-ignore */ backupPath);
    for (const n of ['b.pdf', 'c.pdf', 'd.pdf']) await api.documents.upload(id, new File([new Uint8Array(300_000)], n, { type: 'application/pdf' }), {});
    try {
      const f = await backup.exportData({ includeFiles: true });
      return { ok: true, files: Object.keys(f.files).length, docs: f.tables.documents.length };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }, tripId);
    expect(result).toMatchObject({ ok: true, files: 4, docs: 4 });
});
