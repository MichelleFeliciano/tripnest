import { describe, expect, it } from 'vitest';
import { addDays, dueState, openTaskCounts, suggestionsFor, taskProgress, SUGGESTED_TASKS } from '../src/lib/tasks';

describe('to-do helpers', () => {
  it('adds and subtracts days across month, year and leap boundaries', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
  });

  it('classifies due dates', () => {
    const today = '2026-06-10';
    expect(dueState({ done: false, due_date: null }, today)).toBe('none');
    expect(dueState({ done: false, due_date: '2026-06-09' }, today)).toBe('overdue');
    expect(dueState({ done: false, due_date: '2026-06-10' }, today)).toBe('today');
    expect(dueState({ done: false, due_date: '2026-06-17' }, today)).toBe('soon');
    expect(dueState({ done: false, due_date: '2026-06-18' }, today)).toBe('later');
    expect(dueState({ done: true, due_date: '2026-01-01' }, today)).toBe('done');
  });

  it('counts progress and overdue (done items never count)', () => {
    expect(taskProgress([])).toEqual({ done: 0, total: 0, percent: 0 });
    expect(taskProgress([{ done: true }, { done: false }, { done: false }])).toEqual({ done: 1, total: 3, percent: 33 });
    const list = [{ done: false, due_date: '2026-01-01' }, { done: true, due_date: '2026-01-01' }, { done: false, due_date: null }];
    expect(openTaskCounts(list, '2026-06-10')).toEqual({ open: 2, overdue: 1 });
  });

  it('suggests only what is missing, dated back from the start', () => {
    const all = suggestionsFor('2026-09-01', []);
    expect(all).toHaveLength(SUGGESTED_TASKS.length);
    expect(all.find((s) => s.title === 'Book flights')!.due_date).toBe('2026-07-03');
    const some = suggestionsFor('2026-09-01', ['  book FLIGHTS ']);
    expect(some.some((s) => s.title === 'Book flights')).toBe(false);
    expect(some).toHaveLength(SUGGESTED_TASKS.length - 1);
  });
});
