import { useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { expenses as api } from '../../api/api';
import { expenseLike, nameOf, settlementLike } from '../../api/adapters';
import type { Expense } from '../../api/types';
import { useTrip } from '../../hooks/contexts';
import { useAction } from '../../hooks/hooks';
import { canModifyExpense } from '../../lib/permissions';
import { computeNetBalances, hasMixedCurrencies, NO_CONVERSION_NOTICE, suggestSettlements, totalsByCurrency, type Transfer } from '../../lib/balances';
import { EXPENSE_CATEGORIES } from '../../lib/budget';
import { COMMON_CURRENCIES, MoneyError, formatMoney, minorToInput, parseMoney } from '../../lib/money';
import { computeSplits, parsePercentToBp, SplitError, type SplitMethod, type SplitResult } from '../../lib/splits';
import { formatDateShort } from '../../lib/time';
import { Alert, Dialog, Empty, ErrorBanner, Field } from '../../components/ui';

const METHODS: [SplitMethod, string][] = [['equal', 'Equally'], ['custom', 'Custom amounts'], ['percent', 'Percentages'], ['shares', 'Shares']];
const bpToInput = (bp: number) => `${Math.floor(bp / 100)}.${String(bp % 100).padStart(2, '0')}`;
const today = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; };

interface Part { on: boolean; value: string }
interface Form {
  description: string; amount: string; currency: string; date: string; paid_by: string; category: string; notes: string; item: string;
  method: SplitMethod; parts: Record<string, Part>;
}

export default function Expenses() {
  const { data, me, reload, can } = useTrip();
  const [sp, setSp] = useSearchParams();
  const memberIds = data.members.map((m) => m.user_id);
  const blank = (): Form => ({
    description: '', amount: '', currency: data.trip.default_currency, date: today(), paid_by: me, category: 'Food', notes: '', item: '', method: 'equal',
    parts: Object.fromEntries(memberIds.map((id) => [id, { on: true, value: '' }])),
  });
  const [editing, setEditing] = useState<Expense | 'new' | null>(sp.get('new') === '1' ? 'new' : null);
  const [f, setF] = useState<Form>(blank);
  const [settle, setSettle] = useState<{ t: Transfer; amount: string; date: string; note: string } | null>(null);
  const { busy, error, run, setError } = useAction();
  const settleAct = useAction();

  const exps = data.expenses;
  const net = useMemo(() => computeNetBalances(exps.map(expenseLike), data.settlements.map(settlementLike)), [exps, data.settlements]);
  const transfers = useMemo(() => suggestSettlements(net), [net]);
  const totals = totalsByCurrency(exps.map((e) => ({ currency: e.currency, amountCents: e.amount_cents })));
  const mixed = hasMixedCurrencies(exps) || Object.keys(net).length > 1;
  const canAdd = can('expenses.add');

  // live validation + preview of the split
  const calc = useMemo((): { splits?: SplitResult[]; total?: number; error?: string; values?: Record<string, number | null> } => {
    if (!f.amount.trim()) return {};
    try {
      const total = parseMoney(f.amount, f.currency);
      if (total <= 0) return { error: 'Amount must be greater than zero' };
      const chosen = memberIds.filter((id) => f.parts[id]?.on);
      if (chosen.length === 0) return { error: 'Choose at least one person to split with' };
      const values: Record<string, number | null> = {};
      const input = chosen.map((userId) => {
        const raw = f.parts[userId].value;
        let value: number | undefined;
        if (f.method === 'custom') value = raw.trim() ? parseMoney(raw, f.currency) : 0;
        else if (f.method === 'percent') value = raw.trim() ? parsePercentToBp(raw) : 0;
        else if (f.method === 'shares') { const n = Number(raw || '1'); if (!Number.isInteger(n)) throw new SplitError('Shares must be whole numbers'); value = n; }
        values[userId] = value ?? null;
        return { userId, value };
      });
      return { splits: computeSplits(total, f.method, input), total, values };
    } catch (e) {
      return { error: e instanceof SplitError || e instanceof MoneyError ? e.message : 'Check the amounts' };
    }
  }, [f, memberIds]);

  const open = (e: Expense | 'new') => {
    setError(null);
    setEditing(e);
    if (e === 'new') return setF(blank());
    const parts = Object.fromEntries(memberIds.map((id) => {
      const s = e.expense_splits.find((x) => x.user_id === id);
      let value = '';
      if (s?.share_value !== null && s?.share_value !== undefined) {
        value = e.split_method === 'custom' ? minorToInput(s.share_value, e.currency) : e.split_method === 'percent' ? bpToInput(s.share_value) : String(s.share_value);
      }
      return [id, { on: !!s, value }];
    }));
    setF({ description: e.description, amount: minorToInput(e.amount_cents, e.currency), currency: e.currency, date: e.expense_date, paid_by: e.paid_by, category: e.category, notes: e.notes ?? '', item: e.itinerary_item_id ?? '', method: e.split_method, parts });
  };
  const close = () => { setEditing(null); setSp((p) => { const n = new URLSearchParams(p); n.delete('new'); return n; }, { replace: true }); };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!calc.splits || calc.total === undefined) return setError(calc.error ?? 'Enter an amount');
    const ok = await run(async () => {
      await api.save(data.trip.id, editing && editing !== 'new' ? editing.id : null, {
        paid_by: f.paid_by, description: f.description.trim(), amount_cents: calc.total!, currency: f.currency, expense_date: f.date,
        category: f.category, notes: f.notes.trim(), itinerary_item_id: f.item, split_method: f.method,
      }, calc.splits!.map((s) => ({ user_id: s.userId, amount_cents: s.amountCents, share_value: f.method === 'equal' ? null : (calc.values?.[s.userId] ?? null) })));
      return true;
    });
    if (ok) { await reload(); close(); }
  };

  const remove = async (e: Expense) => {
    if (!window.confirm(`Delete "${e.description}"? Balances will update. Recorded settlements are kept.`)) return;
    const ok = await run(async () => { await api.remove(e.id); return true; });
    if (ok) await reload();
  };

  const submitSettle = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!settle) return;
    const ok = await settleAct.run(async () => {
      const cents = parseMoney(settle.amount, settle.t.currency);
      if (cents <= 0) throw new Error('Amount must be greater than zero');
      await api.settle(data.trip.id, settle.t.from, settle.t.to, cents, settle.t.currency, settle.date, settle.note);
      return true;
    });
    if (ok) { await reload(); setSettle(null); }
  };

  const nets = Object.entries(net).flatMap(([cur, m]) => Object.entries(m).filter(([, v]) => v !== 0).map(([uid, v]) => ({ cur, uid, v })));

  return (
    <div>
      <div className="row-between"><h2>Expenses</h2>{canAdd && <button className="btn btn-primary" onClick={() => open('new')}>+ Add expense</button>}</div>
      <ErrorBanner message={editing ? null : error} />

      <section className="card" aria-labelledby="bal-h">
        <h3 id="bal-h">Who owes whom</h3>
        {mixed && <Alert kind="info">{NO_CONVERSION_NOTICE} Amounts in different currencies are settled separately.</Alert>}
        {transfers.length === 0 ? <p>{exps.length === 0 ? 'No expenses yet.' : '🎉 Everyone is settled up.'}</p> : (
          <ul className="list">
            {transfers.map((t, i) => (
              <li key={i} className="row-between">
                <span><strong>{nameOf(data, t.from)}</strong> owes <strong>{nameOf(data, t.to)}</strong> <strong>{formatMoney(t.amountCents, t.currency)}</strong>{t.from === me && ' (you)'}</span>
                {can('settlements.record') && <button className="btn btn-sm" onClick={() => setSettle({ t, amount: minorToInput(t.amountCents, t.currency), date: today(), note: '' })}>Mark as paid</button>}
              </li>
            ))}
          </ul>
        )}
        {nets.length > 0 && (
          <details>
            <summary>Balance by person</summary>
            <div className="table-wrap">
              <table>
                <caption className="sr-only">Net balance for each traveler</caption>
                <thead><tr><th scope="col">Traveler</th><th scope="col">Status</th><th scope="col" className="num">Amount</th></tr></thead>
                <tbody>{nets.map((n) => <tr key={n.cur + n.uid}><th scope="row">{nameOf(data, n.uid)}</th><td>{n.v > 0 ? 'Is owed' : 'Owes'}</td><td className="num">{formatMoney(Math.abs(n.v), n.cur)}</td></tr>)}</tbody>
              </table>
            </div>
          </details>
        )}
        <p className="muted" style={{ marginTop: 8 }}>Total spent: {Object.entries(totals).map(([c, v]) => formatMoney(v, c)).join(' · ') || '—'}</p>
      </section>

      <section className="card" aria-labelledby="list-h">
        <h3 id="list-h">All expenses</h3>
        {exps.length === 0 ? <Empty title="No expenses yet">Add the first shared cost and choose how to split it.</Empty> : (
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Shared expenses</caption>
              <thead><tr><th scope="col">Date</th><th scope="col">Description</th><th scope="col">Paid by</th><th scope="col" className="num">Amount</th><th scope="col" className="hide-mobile">Split</th></tr></thead>
              <tbody>
                {exps.map((e) => (
                  <tr key={e.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDateShort(e.expense_date)}</td>
                    <td>
                      <strong>{e.description}</strong>
                      <div className="muted">{e.category}{e.notes ? ` · ${e.notes}` : ''}</div>
                      {canModifyExpense(data.role, e.created_by, me) && <div className="row" style={{ marginTop: 6 }}><button className="btn btn-sm" onClick={() => open(e)} aria-label={`Edit ${e.description}`}>Edit</button><button className="btn btn-sm btn-danger" onClick={() => remove(e)} aria-label={`Delete ${e.description}`}>Delete</button></div>}
                    </td>
                    <td>{nameOf(data, e.paid_by)}</td>
                    <td className="num">{formatMoney(e.amount_cents, e.currency)}</td>
                    <td className="muted hide-mobile">{e.expense_splits.map((s) => `${nameOf(data, s.user_id)} ${formatMoney(s.amount_cents, e.currency)}`).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {data.settlements.length > 0 && (
        <section className="card" aria-labelledby="hist-h">
          <h3 id="hist-h">Settlement history</h3>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Recorded payments between travelers</caption>
              <thead><tr><th scope="col">Date</th><th scope="col">Paid by</th><th scope="col">Received by</th><th scope="col" className="num">Amount</th><th scope="col" className="hide-mobile">Note</th></tr></thead>
              <tbody>{data.settlements.map((s) => <tr key={s.id}><td style={{ whiteSpace: 'nowrap' }}>{formatDateShort(s.settled_on)}</td><td>{nameOf(data, s.from_user)}</td><td>{nameOf(data, s.to_user)}</td><td className="num" style={{ whiteSpace: 'nowrap' }}>{formatMoney(s.amount_cents, s.currency)}{s.note && <div className="muted" style={{ fontSize: '.8rem' }}>{s.note}</div>}</td><td className="hide-mobile">{s.note}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="muted">This is a record only. TripNest never moves money. Entries can't be edited; record a correction instead.</p>
        </section>
      )}

      <Dialog open={editing !== null} onClose={close} title={editing === 'new' ? 'Add expense' : 'Edit expense'}>
        <form onSubmit={submit}>
          <ErrorBanner message={error} />
          <div className="form-grid">
            <Field label="Description *" className="span-2">{(id) => <input id={id} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} required maxLength={200} />}</Field>
            <Field label="Amount *">{(id) => <input id={id} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="0.00" required />}</Field>
            <Field label="Currency" hint={f.currency !== data.trip.default_currency ? NO_CONVERSION_NOTICE : undefined}>{(id, d) => <select id={id} aria-describedby={d} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>{[...new Set([f.currency, ...COMMON_CURRENCIES])].map((c) => <option key={c}>{c}</option>)}</select>}</Field>
            <Field label="Date">{(id) => <input id={id} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required />}</Field>
            <Field label="Paid by">{(id) => <select id={id} value={f.paid_by} onChange={(e) => setF({ ...f, paid_by: e.target.value })}>{memberIds.map((m) => <option key={m} value={m}>{nameOf(data, m)}</option>)}</select>}</Field>
            <Field label="Category">{(id) => <select id={id} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>}</Field>
            <Field label="Related itinerary item">{(id) => <select id={id} value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })}><option value="">None</option>{data.items.map((i) => <option key={i.id} value={i.id}>{formatDateShort(i.local_date)} · {i.title}</option>)}</select>}</Field>
            <Field label="Notes" className="span-2">{(id) => <input id={id} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={2000} />}</Field>
          </div>

          <fieldset>
            <legend>Split</legend>
            <div className="seg" role="group" aria-label="Split method" style={{ marginBottom: 8 }}>
              {METHODS.map(([m, label]) => <button type="button" key={m} aria-pressed={f.method === m} onClick={() => setF({ ...f, method: m })}>{label}</button>)}
            </div>
            <ul className="list">
              {memberIds.map((id) => {
                const p = f.parts[id] ?? { on: false, value: '' };
                const share = calc.splits?.find((s) => s.userId === id);
                return (
                  <li key={id} className="row-between" style={{ padding: '6px 0' }}>
                    <label className="check"><input type="checkbox" checked={p.on} onChange={(e) => setF({ ...f, parts: { ...f.parts, [id]: { ...p, on: e.target.checked } } })} />{nameOf(data, id)}</label>
                    <div className="row">
                      {f.method !== 'equal' && p.on && (
                        <>
                          <label className="sr-only" htmlFor={`v-${id}`}>{nameOf(data, id)} {f.method === 'custom' ? 'amount' : f.method === 'percent' ? 'percent' : 'shares'}</label>
                          <input id={`v-${id}`} style={{ width: 100 }} inputMode="decimal" value={p.value} placeholder={f.method === 'shares' ? '1' : f.method === 'percent' ? '%' : '0.00'} onChange={(e) => setF({ ...f, parts: { ...f.parts, [id]: { ...p, value: e.target.value } } })} />
                        </>
                      )}
                      <strong style={{ minWidth: 80, textAlign: 'right' }}>{share ? formatMoney(share.amountCents, f.currency) : ''}</strong>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div role="status" aria-live="polite">
              {calc.error && f.amount && <span className="field-error">{calc.error}</span>}
              {calc.splits && <span className="muted">Splits total {formatMoney(calc.splits.reduce((a, s) => a + s.amountCents, 0), f.currency)}, exactly the amount.</span>}
            </div>
          </fieldset>

          <div className="row"><button className="btn btn-primary" disabled={busy || !calc.splits}>{busy ? 'Saving…' : 'Save expense'}</button><button type="button" className="btn" onClick={close}>Cancel</button></div>
        </form>
      </Dialog>

      <Dialog open={settle !== null} onClose={() => setSettle(null)} title="Record a payment">
        {settle && (
          <form onSubmit={submitSettle}>
            <ErrorBanner message={settleAct.error} />
            <p><strong>{nameOf(data, settle.t.from)}</strong> paid <strong>{nameOf(data, settle.t.to)}</strong> ({settle.t.currency}). This records the payment; no money moves through TripNest.</p>
            <div className="form-grid">
              <Field label="Amount paid" hint="Enter less than the full amount for a partial payment">{(id, d) => <input id={id} aria-describedby={d} inputMode="decimal" value={settle.amount} onChange={(e) => setSettle({ ...settle, amount: e.target.value })} required />}</Field>
              <Field label="Date">{(id) => <input id={id} type="date" value={settle.date} onChange={(e) => setSettle({ ...settle, date: e.target.value })} required />}</Field>
              <Field label="Note (optional)" className="span-2">{(id) => <input id={id} value={settle.note} onChange={(e) => setSettle({ ...settle, note: e.target.value })} maxLength={500} placeholder="Venmo, cash…" />}</Field>
            </div>
            <div className="row"><button className="btn btn-primary" disabled={settleAct.busy}>Record payment</button><button type="button" className="btn" onClick={() => setSettle(null)}>Cancel</button></div>
          </form>
        )}
      </Dialog>
    </div>
  );
}
