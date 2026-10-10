import { useState, type FormEvent } from 'react';
import { tasks } from '../../api/api';
import type { Deleted } from '../../api/api';
import type { Task } from '../../api/types';
import { Empty, ErrorBanner, Field, ProgressBar } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useTrip } from '../../hooks/contexts';
import { useAction, useToday } from '../../hooks/hooks';
import { dueState, suggestionsFor, taskProgress } from '../../lib/tasks';
import { formatDateShort } from '../../lib/time';

const DUE_TEXT = { overdue: 'Overdue', today: 'Due today', soon: 'Due soon', later: '', none: '', done: '' } as const;

export default function Todo() {
  const { data, reload } = useTrip();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const { busy, error, run } = useAction();
  const today = useToday();
  const progress = taskProgress(data.tasks);
  const suggestions = suggestionsFor(data.trip.start_date, data.tasks.map((t) => t.title));

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const ok = await run(async () => { await tasks.add(data.trip.id, title.trim(), due); return true; });
    if (ok) { setTitle(''); setDue(''); await reload(); }
  };
  const addSuggested = async (list: { title: string; due_date: string }[]) => {
    const ok = await run(async () => { for (const s of list) await tasks.add(data.trip.id, s.title, s.due_date); return true; });
    if (ok) await reload();
  };
  const toggle = async (t: Task) => {
    const ok = await run(async () => { await tasks.toggle(t.id, !t.done); return true; });
    if (ok) await reload();
  };
  const remove = async (t: Task) => {
    let gone: Deleted | undefined;
    const ok = await run(async () => { gone = await tasks.remove(t.id); return true; });
    if (ok) { toast.deleted(gone); await reload(); }
  };

  return (
    <div>
      <h2>To-do before you go</h2>
      <form className="card" onSubmit={add}>
        <ErrorBanner message={error} />
        <div className="form-grid">
          <Field label="What needs doing?" className="span-2">{(id) => <input id={id} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />}</Field>
          <Field label="Due (optional)">{(id) => <input id={id} type="date" value={due} onChange={(e) => setDue(e.target.value)} />}</Field>
        </div>
        <button className="btn btn-primary" disabled={busy}>Add to-do</button>
      </form>

      {suggestions.length > 0 && (
        <section className="card" aria-labelledby="sug-h">
          <h3 id="sug-h">Ideas</h3>
          <p className="muted">Tap one to add it, with a due date counted back from your start date ({formatDateShort(data.trip.start_date)}).</p>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {suggestions.map((s) => <button key={s.title} type="button" className="btn btn-sm" disabled={busy} onClick={() => void addSuggested([s])}>+ {s.title}</button>)}
          </div>
          <button type="button" className="btn btn-sm btn-ghost" style={{ marginTop: 8 }} disabled={busy} onClick={() => void addSuggested(suggestions)}>Add all ideas</button>
        </section>
      )}

      {data.tasks.length === 0 ? <Empty title="Nothing on the list yet" /> : (
        <>
          <p><strong>{progress.done} / {progress.total}</strong> done</p>
          <ProgressBar value={progress.percent} label="To-do progress" />
          <ul className="list card">
            {data.tasks.map((t) => {
              const st = dueState(t, today);
              return (
                <li key={t.id} className="row-between">
                  <label className="check" style={{ flex: 1 }}>
                    <input type="checkbox" checked={t.done} onChange={() => void toggle(t)} disabled={busy} />
                    <span style={t.done ? { textDecoration: 'line-through', opacity: 0.7 } : undefined}>
                      {t.title}
                      {t.due_date && <span className="muted"> · {formatDateShort(t.due_date)}</span>}
                      {DUE_TEXT[st] && <strong className={st === 'overdue' ? 'overdue' : 'muted'}> · {DUE_TEXT[st]}</strong>}
                    </span>
                  </label>
                  <button className="btn btn-sm btn-ghost" onClick={() => void remove(t)} aria-label={`Delete to-do ${t.title}`}>Delete</button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
