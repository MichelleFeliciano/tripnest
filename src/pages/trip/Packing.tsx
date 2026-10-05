import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { packing, rows } from '../../api/api';
import { nameOf, packingLike } from '../../api/adapters';
import type { PackingItem } from '../../api/types';
import { useTrip } from '../../hooks/contexts';
import { useAction } from '../../hooks/hooks';
import { PACKING_TEMPLATES, packingProgress, visibleItems } from '../../lib/packing';
import { Dialog, Empty, ErrorBanner, Field, ProgressBar } from '../../components/ui';

export default function Packing() {
  const { data, me, reload, can } = useTrip();
  const [sp, setSp] = useSearchParams();
  const [shared, setShared] = useState(true);
  const [override, setOverride] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState(sp.get('new') === '1');
  const [tplOpen, setTplOpen] = useState(false);
  const [f, setF] = useState({ name: '', category: '', newCategory: '', quantity: '1', assigned: '', notes: '' });
  const { busy, error, run } = useAction();
  const toggleAction = useAction();

  const canManage = shared ? can('packing.editShared') : true; // personal lists belong to their owner
  const cats = data.packingCategories.filter((c) => (shared ? c.is_shared : !c.is_shared && c.owner_id === me));
  const items: PackingItem[] = visibleItems(data.packingItems.map(packingLike), me)
    .filter((i) => i.isShared === shared)
    .map((i) => data.packingItems.find((p) => p.id === i.id)!)
    .map((i) => (i.id in override ? { ...i, packed: override[i.id] } : i));
  const prog = packingProgress(items);

  const toggle = async (i: PackingItem) => {
    const next = !i.packed;
    setOverride((o) => ({ ...o, [i.id]: next }));
    const ok = await toggleAction.run(async () => { await packing.toggle(i.id, next); return true; });
    if (ok) await reload();
    setOverride((o) => { const n = { ...o }; delete n[i.id]; return n; });
  };

  const addItem = async (e: FormEvent) => {
    e.preventDefault();
    const qty = Number(f.quantity);
    if (!f.name.trim() || !Number.isInteger(qty) || qty < 1 || qty > 999) return;
    const ok = await run(async () => {
      let categoryId = f.category;
      if (!categoryId || categoryId === '__new') {
        const name = f.newCategory.trim() || 'General';
        const existing = cats.find((c) => c.name.toLowerCase() === name.toLowerCase());
        categoryId = existing?.id ?? (await rows.insert<{ id: string }>('packing_categories', { trip_id: data.trip.id, name, is_shared: shared, owner_id: shared ? null : me, sort_order: cats.length })).id;
      }
      await rows.insert('packing_items', { trip_id: data.trip.id, category_id: categoryId, name: f.name, quantity: qty, assigned_to: f.assigned || null, notes: f.notes, is_shared: shared, owner_id: shared ? null : me });
      return true;
    });
    if (ok) { setF({ ...f, name: '', quantity: '1', notes: '' }); await reload(); }
  };

  const applyTemplate = async (id: string) => {
    const t = PACKING_TEMPLATES.find((x) => x.id === id)!;
    const ok = await run(async () => { await packing.applyTemplate(data.trip.id, t, shared, me); return true; });
    if (ok) { await reload(); setTplOpen(false); }
  };
  const removeItem = async (i: PackingItem) => {
    const ok = await run(async () => { await rows.remove('packing_items', i.id); return true; });
    if (ok) await reload();
  };
  const removeCat = async (id: string, name: string) => {
    if (!window.confirm(`Delete the "${name}" category and all items in it?`)) return;
    const ok = await run(async () => { await rows.remove('packing_categories', id); return true; });
    if (ok) await reload();
  };
  const closeAdd = () => { setAdding(false); setSp((p) => { const n = new URLSearchParams(p); n.delete('new'); return n; }, { replace: true }); };

  return (
    <div>
      <div className="row-between">
        <div className="seg" role="group" aria-label="Packing list">
          <button aria-pressed={shared} onClick={() => { setShared(true); setF((x) => ({ ...x, category: '' })); }}>Shared</button>
          <button aria-pressed={!shared} onClick={() => { setShared(false); setF((x) => ({ ...x, category: '' })); }}>My list</button>
        </div>
        {canManage && (
          <div className="row">
            <button className="btn" onClick={() => setTplOpen(true)}>Templates</button>
            <button className="btn btn-primary" onClick={() => setAdding(true)}>+ Add item</button>
          </div>
        )}
      </div>
      <p className="muted">{shared ? 'Visible to everyone on the trip.' : 'Only you can see this list.'}</p>

      <div className="card" aria-live="polite">
        <div className="big-num">{prog.packed} / {prog.total} packed <span className="muted" style={{ fontSize: '1rem' }}>({prog.percent}%)</span></div>
        <ProgressBar value={prog.percent} label={`${shared ? 'Shared' : 'Personal'} packing progress`} />
      </div>
      <ErrorBanner message={error ?? toggleAction.error} />

      {cats.length === 0 && items.length === 0 && <Empty title="Nothing to pack yet">{canManage ? 'Add items, or start from a template like Beach Vacation or Road Trip.' : 'No items have been added yet.'}</Empty>}
      {cats.map((c) => {
        const list = items.filter((i) => i.category_id === c.id);
        const p = packingProgress(list);
        return (
          <section key={c.id} className="card" aria-labelledby={`cat-${c.id}`}>
            <div className="row-between">
              <h3 id={`cat-${c.id}`} style={{ margin: 0 }}>{c.name} <span className="muted">({p.packed}/{p.total})</span></h3>
              {canManage && <button className="btn btn-ghost btn-sm" onClick={() => removeCat(c.id, c.name)} aria-label={`Delete category ${c.name}`}>Delete category</button>}
            </div>
            <ul className="list">
              {list.map((i) => (
                <li key={i.id} className="pack-item">
                  <input id={`p-${i.id}`} type="checkbox" checked={i.packed} disabled={!canManage} onChange={() => toggle(i)} />
                  <label htmlFor={`p-${i.id}`}>
                    <span>{i.name}{i.quantity > 1 && ` ×${i.quantity}`}</span>
                    {i.assigned_to && <span className="muted"> · {nameOf(data, i.assigned_to)}</span>}
                    {i.notes && <span className="muted"> · {i.notes}</span>}
                    <span className="sr-only">{i.packed ? ' (packed)' : ' (not packed)'}</span>
                  </label>
                  {canManage && <button className="btn btn-ghost btn-sm" onClick={() => removeItem(i)} aria-label={`Remove ${i.name}`}>✕</button>}
                </li>
              ))}
              {list.length === 0 && <li className="muted">No items in this category.</li>}
            </ul>
          </section>
        );
      })}

      <Dialog open={adding} onClose={closeAdd} title={shared ? 'Add shared item' : 'Add personal item'}>
        <form onSubmit={addItem}>
          <ErrorBanner message={error} />
          <div className="form-grid">
            <Field label="Item *" className="span-2">{(id) => <input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={200} autoFocus />}</Field>
            <Field label="Category">{(id) => <select id={id} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">General</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}<option value="__new">+ New category…</option></select>}</Field>
            {f.category === '__new' ? <Field label="New category name">{(id) => <input id={id} value={f.newCategory} onChange={(e) => setF({ ...f, newCategory: e.target.value })} maxLength={100} required />}</Field> : <Field label="Quantity">{(id) => <input id={id} type="number" min={1} max={999} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} />}</Field>}
            {shared && <Field label="Assigned to">{(id) => <select id={id} value={f.assigned} onChange={(e) => setF({ ...f, assigned: e.target.value })}><option value="">Anyone</option>{data.members.map((m) => <option key={m.user_id} value={m.user_id}>{nameOf(data, m.user_id)}</option>)}</select>}</Field>}
            <Field label="Notes">{(id) => <input id={id} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={1000} />}</Field>
          </div>
          <div className="row"><button className="btn btn-primary" disabled={busy}>Add item</button><button type="button" className="btn" onClick={closeAdd}>Done</button></div>
        </form>
      </Dialog>

      <Dialog open={tplOpen} onClose={() => setTplOpen(false)} title="Start from a template">
        <p className="muted">Adds editable categories and items to your {shared ? 'shared' : 'personal'} list. You can change everything afterwards.</p>
        <ErrorBanner message={error} />
        <ul className="list">
          {PACKING_TEMPLATES.map((t) => (
            <li key={t.id} className="row-between">
              <div><strong>{t.name}</strong><div className="muted">{t.categories.map((c) => c.name).join(', ')}</div></div>
              <button className="btn btn-sm" disabled={busy} onClick={() => applyTemplate(t.id)}>Add</button>
            </li>
          ))}
        </ul>
      </Dialog>
    </div>
  );
}
