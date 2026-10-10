/** "Starts in 12 days", "Day 3 of 8", "Ended yesterday". Dates are plain YYYY-MM-DD strings. */
const dayNum = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86_400_000; };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export type Phase = 'before' | 'during' | 'after';

export function countdown(start: string, end: string, today: string): { phase: Phase; text: string } {
  const toStart = dayNum(start) - dayNum(today);
  if (toStart > 0) return { phase: 'before', text: toStart === 1 ? 'Starts tomorrow' : `Starts in ${plural(toStart, 'day')}` };
  const sinceEnd = dayNum(today) - dayNum(end);
  if (sinceEnd > 0) return { phase: 'after', text: sinceEnd === 1 ? 'Ended yesterday' : `Ended ${plural(sinceEnd, 'day')} ago` };
  const total = dayNum(end) - dayNum(start) + 1;
  const day = dayNum(today) - dayNum(start) + 1;
  return { phase: 'during', text: total === 1 ? 'Today is the day' : day === total ? `Last day (day ${day} of ${total})` : `Day ${day} of ${total}` };
}
