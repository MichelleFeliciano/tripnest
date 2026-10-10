/** Pure helpers for the pre-trip to-do list. Dates are plain `YYYY-MM-DD` strings (no time zones involved). */

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export type DueState = 'done' | 'overdue' | 'today' | 'soon' | 'later' | 'none';

/** "soon" means due within the next 7 days. */
export function dueState(task: { done: boolean; due_date: string | null }, today: string): DueState {
  if (task.done) return 'done';
  if (!task.due_date) return 'none';
  if (task.due_date < today) return 'overdue';
  if (task.due_date === today) return 'today';
  return task.due_date <= addDays(today, 7) ? 'soon' : 'later';
}

export function taskProgress(tasks: { done: boolean }[]): { done: number; total: number; percent: number } {
  const done = tasks.filter((t) => t.done).length;
  return { done, total: tasks.length, percent: tasks.length ? Math.round((done / tasks.length) * 100) : 0 };
}

export function openTaskCounts(tasks: { done: boolean; due_date: string | null }[], today: string): { open: number; overdue: number } {
  const open = tasks.filter((t) => !t.done);
  return { open: open.length, overdue: open.filter((t) => dueState(t, today) === 'overdue').length };
}

/** Common things to sort out before a trip: [title, days before the trip starts]. */
export const SUGGESTED_TASKS: readonly [string, number][] = [
  ['Check passports are valid (many countries want 6 months left)', 90],
  ['Book flights', 60],
  ['Book lodging', 60],
  ['Check visa / entry requirements', 45],
  ['Arrange travel insurance', 30],
  ['Tell the bank and card companies you are travelling', 14],
  ['Arrange pet / plant / mail care', 7],
  ['Check in online for flights', 1],
  ['Charge devices and download offline maps', 1],
];

/** Suggestions that are not already on the list (case-insensitive), with a due date counted back from the start date. */
export function suggestionsFor(startDate: string, existingTitles: string[]): { title: string; due_date: string }[] {
  const have = new Set(existingTitles.map((t) => t.trim().toLowerCase()));
  return SUGGESTED_TASKS
    .filter(([title]) => !have.has(title.toLowerCase()))
    .map(([title, before]) => ({ title, due_date: addDays(startDate, -before) }));
}
