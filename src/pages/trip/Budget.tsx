import { useState, type FormEvent } from 'react';
import { rows } from '../../api/api';
import { useTrip } from '../../hooks/contexts';
import { useAction } from '../../hooks/hooks';
import { BUDGET_CATEGORIES, summarizeBudget, type BudgetCategory, type BudgetLine, type BudgetRow } from '../../lib/budget';
import { COMMON_CURRENCIES, MoneyError, formatMoney, minorToInput, parseMoney } from '../../lib/money';
import { Alert, BudgetBadge, ErrorBanner, Field, ProgressBar } from '../../components/ui';

function Line({ l, currency }: { l: BudgetLine; currency: string }) {
  return (
    <div className="card">
      <div className="row-between"><h3 style={{ margin: 0 }}>{l.category === 'Total' ? 'Total trip budget' : l.category}</h3><BudgetBadge status={l.status} /></div>
      <p>{l.message}</p>
      <ProgressBar value={l.percentUsed} label={`${l.category} budget used`} />
      <dl className="kv" style={{ marginTop: 8 }}>
        <dt>Budget</dt><dd>{formatMoney(l.budgetCents, currency)}</dd>
        <dt>Actual</dt><dd>{formatMoney(l.actualCents, currency)}</dd>
        <dt>{l.remainingCents >= 0 ? 'Remaining' : 'Over by'}</dt><dd>{formatMoney(Math.abs(l.remainingCents), currency)}</dd>
      </dl>
    </div>
  );
}

export default function Budget() {
  const { data, reload } = useTrip();
  const [editing, setEditing] = useState(false);
  const existingCur = data.budgets[0]?.currency ?? data.trip.default_currency;
  const [currency, setCurrency] = useState(existingCur);
  const val = (cat: BudgetCategory | null) => {
    const b = data.budgets.find((x) => x.category === cat);
    return b ? minorToInput(b.amount_cents, b.currency) : '';
  };
  const [vals, setVals] = useState<Record<string, string>>({});
  const { busy, error, run } = useAction();

  const rowsForSummary: BudgetRow[] = data.budgets.map((b) => ({ category: b.category, amountCents: b.amount_cents, currency: b.currency }));
  const summary = summarizeBudget(rowsForSummary, data.expenses.map((e) => ({ category: e.category, amountCents: e.amount_cents, currency: e.currency })), data.trip.budget_near_pct);

  const start = () => {
    setCurrency(existingCur);
    setVals({ total: val(null), ...Object.fromEntries(BUDGET_CATEGORIES.map((c) => [c, val(c)])) });
    setEditing(true);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await run(async () => {
      const entries: [BudgetCategory | null, string][] = [[null, vals.total ?? ''], ...BUDGET_CATEGORIES.map((c): [BudgetCategory, string] => [c, vals[c] ?? ''])];
      const parsed = entries.map(([cat, raw]) => {
        if (!raw.trim()) return { cat, cents: null as number | null };
        try { return { cat, cents: parseMoney(raw, currency) }; } catch (x) { throw new Error(`${cat ?? 'Total'}: ${(x as MoneyError).message}`); }
      }); // validate everything first so a typo never leaves a half-saved budget
      for (const { cat, cents } of parsed) {
        const existing = data.budgets.find((b) => b.category === cat);
        if (cents === null) { if (existing) await rows.remove('budgets', existing.id); continue; }
        if (existing) await rows.update('budgets', existing.id, { amount_cents: cents, currency });
        else await rows.insert('budgets', { trip_id: data.trip.id, category: cat, amount_cents: cents, currency });
      }
      // keep a single currency across the budget
      for (const b of data.budgets) if (b.currency !== currency && vals[b.category ?? 'total']?.trim()) await rows.update('budgets', b.id, { currency });
      return true;
    });
    if (ok) { await reload(); setEditing(false); }
  };

  const nearPct = data.trip.budget_near_pct;
  return (
    <div>
      <div className="row-between"><h2>Budget</h2>{!editing && <button className="btn btn-primary" onClick={start}>{data.budgets.length ? 'Edit budget' : 'Set budget'}</button>}</div>
      {editing ? (
        <form className="card" onSubmit={save}>
          <ErrorBanner message={error} />
          <p className="muted">Leave a field blank for no budget. You'll see a gentle heads-up once you've used {nearPct}% of a budget (change this in Settings).</p>
          <div className="form-grid">
            <Field label="Currency">{(id) => <select id={id} value={currency} onChange={(e) => setCurrency(e.target.value)}>{[...new Set([currency, ...COMMON_CURRENCIES])].map((c) => <option key={c}>{c}</option>)}</select>}</Field>
            <Field label="Total budget">{(id) => <input id={id} inputMode="decimal" value={vals.total ?? ''} onChange={(e) => setVals({ ...vals, total: e.target.value })} />}</Field>
            {BUDGET_CATEGORIES.map((c) => <Field key={c} label={`${c} budget`}>{(id) => <input id={id} inputMode="decimal" value={vals[c] ?? ''} onChange={(e) => setVals({ ...vals, [c]: e.target.value })} />}</Field>)}
          </div>
          <div className="row"><button className="btn btn-primary" disabled={busy}>Save budget</button><button type="button" className="btn" onClick={() => setEditing(false)}>Cancel</button></div>
        </form>
      ) : data.budgets.length === 0 ? (
        <Alert kind="info">No budget set yet. Add a total and optional category budgets to see how spending compares.</Alert>
      ) : (
        <>
          {summary.excludedForeignCurrency > 0 && <Alert kind="info">{summary.excludedForeignCurrency} expense(s) in other currencies are not counted. Currency conversion not included.</Alert>}
          {summary.total && <Line l={summary.total} currency={summary.currency!} />}
          <div className="grid grid-2">{summary.categories.map((l) => <Line key={l.category} l={l} currency={summary.currency!} />)}</div>
        </>
      )}
    </div>
  );
}
