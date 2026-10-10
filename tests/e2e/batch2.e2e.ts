/** Calendar reminders, password-protected backups, merge updates, Android install prompt, trip countdown and key info card. */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { seedSampleTrip } from './fixtures';

test('the calendar file has reminders only for timed items, and none when switched off', async ({ page }, info) => {
  const tripId = await seedSampleTrip(page);
  await page.goto(`/trips/${tripId}/export`);
  const save = async (name: string) => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download calendar (.ics)' }).click()]);
    const file = info.outputPath(name);
    await dl.saveAs(file);
    return readFileSync(file, 'utf8');
  };
  const withAlarms = await save('with.ics');
  const events = withAlarms.match(/BEGIN:VEVENT/g)!.length;
  const alarms = withAlarms.match(/BEGIN:VALARM/g)?.length ?? 0;
  expect(alarms).toBeGreaterThan(0);
  expect(alarms).toBeLessThan(events); // all-day items and the hotel get none
  expect(withAlarms).toContain('TRIGGER:-PT1H');
  const block = (title: string) => withAlarms.split('BEGIN:VEVENT').find((b) => b.includes('SUMMARY:' + title))!;
  expect(block('Flight to San Juan')).toContain('BEGIN:VALARM');
  expect(block('Hotel check-in')).not.toContain('VALARM');
  expect(block('Beach day at Condado')).not.toContain('VALARM'); // all-day

  await page.getByLabel('Reminders').selectOption({ label: '1 day before' });
  expect(await save('day.ics')).toContain('TRIGGER:-P1D');
  await page.getByLabel('Reminders').selectOption({ label: 'No reminders' });
  expect(await save('none.ics')).not.toContain('VALARM');
});
