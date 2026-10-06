/**
 * Account deletion, tested against the real migrations (0001-0004) in PGlite.
 * Invariant: deleting an account never changes anyone else's balances, never breaks an expense's split total,
 * and is blocked while other travelers still depend on a trip the user owns.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const sql = (f: string) => readFileSync(join(__dirname, '..', 'supabase', 'migrations', f), 'utf8');
const TOMB = '00000000-0000-0000-0000-00000000dead';
interface U { id: string; email: string }
let db: PGlite;
let n = 10;

async function as<T>(u: U | null, fn: () => Promise<T>): Promise<T> {
  if (u) {
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: u.id, email: u.email, role: 'authenticated' })]);
    await db.exec('set role authenticated');
  } else {
    await db.query(`select set_config('request.jwt.claims', '', false)`);
    await db.exec('set role anon');
  }
  try { return await fn(); } finally { await db.exec('reset role'); }
}
const q = async <R = Record<string, unknown>>(u: U | null, text: string, params: unknown[] = []) => (await as(u, () => db.query<R>(text, params))).rows;

const mk = async (name: string): Promise<U> => {
  const u: U = { id: `00000000-0000-4000-8000-0000000000${n++}`, email: `${name}@example.com` };
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [u.id, u.email]);
  return u;
};
const newTrip = async (owner: U, name: string) =>
  (await q<{ id: string }>(owner, `insert into trips (owner_id, name, start_date, end_date) values ($1, $2, '2026-08-01', '2026-08-05') returning id`, [owner.id, name]))[0].id;
const invite = async (owner: U, tripId: string, u: U) => {
  const tok = (await q<{ create_invitation: string }>(owner, `select create_invitation($1, $2, 'editor')`, [tripId, u.email]))[0].create_invitation;
  await q(u, `select accept_invitation($1)`, [tok]);
};
const expense = (by: U, tripId: string, paidBy: U, cents: number, split: [U, number][]) =>
  q(by, `select save_expense($1, null, $2::jsonb, $3::jsonb)`, [
    tripId,
    JSON.stringify({ paid_by: paidBy.id, description: 'x', amount_cents: cents, expense_date: '2026-08-02', split_method: 'custom' }),
    JSON.stringify(split.map(([p, a]) => ({ user_id: p.id, amount_cents: a }))),
  ]);
const exists = async (u: U) => (await db.query(`select 1 from auth.users where id = $1`, [u.id])).rows.length === 1;

/** net = paid - owed + payments made - payments received, for the given people */
async function nets(tripId: string, ids: string[]) {
  const r = await db.query<{ u: string; net: string }>(
    `select x.u::text as u, (
        coalesce((select sum(amount_cents) from expenses where trip_id = $1 and paid_by = x.u), 0)
      - coalesce((select sum(s.amount_cents) from expense_splits s join expenses e on e.id = s.expense_id where e.trip_id = $1 and s.user_id = x.u), 0)
      + coalesce((select sum(amount_cents) from settlements where trip_id = $1 and from_user = x.u), 0)
      - coalesce((select sum(amount_cents) from settlements where trip_id = $1 and to_user = x.u), 0))::text as net
     from unnest($2::uuid[]) as x(u) order by 1`,
    [tripId, ids],
  );
  return Object.fromEntries(r.rows.map((x) => [x.u, Number(x.net)]));
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth; create schema storage;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant usage on schema auth, storage, public to anon, authenticated;
    grant execute on all functions in schema auth to anon, authenticated;
    grant select, insert, update, delete on storage.objects to authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
  `);
  for (const f of ['0001_schema.sql', '0002_security.sql', '0003_storage.sql', '0004_delete_account.sql']) await db.exec(sql(f));
});
afterAll(async () => { await db.close(); });

describe('account deletion', () => {
  it('has a placeholder "Former traveler" that is never a member', async () => {
    expect((await db.query<{ display_name: string }>(`select display_name from profiles where id = $1`, [TOMB])).rows[0].display_name).toBe('Former traveler');
    expect((await db.query(`select 1 from trip_members where user_id = $1`, [TOMB])).rows).toHaveLength(0);
  });

  it('is blocked while you own a trip other people have joined; nothing is deleted', async () => {
    const owner = await mk('own1');
    const guest = await mk('guest1');
    const t = await newTrip(owner, 'Shared trip');
    await invite(owner, t, guest);
    const pv = (await q<{ account_deletion_preview: { owned_with_others: { name: string; members: number }[] } }>(owner, `select account_deletion_preview()`))[0].account_deletion_preview;
    expect(pv.owned_with_others).toEqual([expect.objectContaining({ name: 'Shared trip', members: 1 })]);
    await expect(q(owner, `select delete_my_account()`)).rejects.toThrow(/still own trips/i);
    expect(await exists(owner)).toBe(true);
    expect(await q(guest, `select id from trips where id = $1`, [t])).toHaveLength(1);
  });

  it('preview reports solo trips and shared history', async () => {
    const owner = await mk('own4');
    const member = await mk('mem4');
    const shared = await newTrip(owner, 'Theirs');
    await invite(owner, shared, member);
    await expense(member, shared, member, 500, [[member, 500]]);
    await newTrip(member, 'Mine alone');
    const pv = (await q<{ account_deletion_preview: { owned_solo: { name: string }[]; shared_trips: number; shared_expenses: number } }>(member, `select account_deletion_preview()`))[0].account_deletion_preview;
    expect(pv.owned_solo.map((t) => t.name)).toEqual(['Mine alone']);
    expect(pv.shared_trips).toBe(1);
    expect(pv.shared_expenses).toBe(1);
  });

  it('deletes the account together with trips only that person was on', async () => {
    const solo = await mk('solo1');
    const t = await newTrip(solo, 'Only me');
    await q(solo, `insert into itinerary_items (trip_id, local_date, title) values ($1, '2026-08-01', 'x')`, [t]);
    await expense(solo, t, solo, 1000, [[solo, 1000]]);
    await q(solo, `select delete_my_account()`);
    expect(await exists(solo)).toBe(false);
    for (const table of ['trips', 'itinerary_items', 'expenses']) {
      expect((await db.query(`select 1 from ${table} where ${table === 'trips' ? 'id' : 'trip_id'} = $1`, [t])).rows).toHaveLength(0);
    }
    expect((await db.query(`select 1 from profiles where id = $1`, [solo.id])).rows).toHaveLength(0);
  });

  it("never changes other people's balances when a member deletes their account", async () => {
    const owner = await mk('own2');
    const leaver = await mk('leaver');
    const stay = await mk('stay');
    const t = await newTrip(owner, 'Balances');
    await invite(owner, t, leaver);
    await invite(owner, t, stay);
    await expense(leaver, t, leaver, 9000, [[leaver, 3000], [owner, 3000], [stay, 3000]]);
    await expense(owner, t, owner, 3000, [[leaver, 1000], [owner, 1000], [stay, 1000]]);
    await q(owner, `select record_settlement($1, $2, $3, 500, 'USD', null, null)`, [t, stay.id, leaver.id]);

    const before = await nets(t, [owner.id, stay.id, leaver.id, TOMB]);
    await q(leaver, `select delete_my_account()`);
    expect(await exists(leaver)).toBe(false);
    const after = await nets(t, [owner.id, stay.id, leaver.id, TOMB]);

    expect(after[owner.id]).toBe(before[owner.id]);
    expect(after[stay.id]).toBe(before[stay.id]);
    expect(after[TOMB]).toBe(before[leaver.id]); // the leaver's position now sits on the placeholder
    const unbalanced = await db.query(`select e.id from expenses e where e.trip_id = $1 and e.amount_cents <> (select sum(amount_cents) from expense_splits where expense_id = e.id)`, [t]);
    expect(unbalanced.rows).toHaveLength(0);
    expect((await db.query(`select 1 from expenses where trip_id = $1 and paid_by = $2`, [t, TOMB])).rows).toHaveLength(1);
    expect((await db.query(`select 1 from trip_members where trip_id = $1 and user_id = $2`, [t, leaver.id])).rows).toHaveLength(0);
    expect(await q(owner, `select id from trips where id = $1`, [t])).toHaveLength(1);
  });

  it('two people deleting on the same trip merge cleanly (no self-payment, splits merged)', async () => {
    const owner = await mk('own3');
    const a = await mk('a1');
    const b = await mk('b1');
    const t = await newTrip(owner, 'Two leavers');
    await invite(owner, t, a);
    await invite(owner, t, b);
    await expense(owner, t, owner, 3000, [[a, 1000], [b, 1000], [owner, 1000]]);
    await q(a, `select record_settlement($1, $2, $3, 1000, 'USD', null, null)`, [t, a.id, b.id]);
    const ownerBefore = (await nets(t, [owner.id]))[owner.id];
    await q(a, `select delete_my_account()`);
    await q(b, `select delete_my_account()`);
    expect((await db.query(`select 1 from settlements where trip_id = $1`, [t])).rows).toHaveLength(0);
    const splits = await db.query<{ user_id: string; amount_cents: string }>(
      `select s.user_id, s.amount_cents from expense_splits s join expenses e on e.id = s.expense_id where e.trip_id = $1 order by s.amount_cents`, [t]);
    expect(splits.rows.map((r) => [r.user_id, Number(r.amount_cents)])).toEqual([[owner.id, 1000], [TOMB, 2000]]);
    expect((await nets(t, [owner.id]))[owner.id]).toBe(ownerBefore);
  });

  it('works only for the caller; anonymous callers are refused', async () => {
    await expect(q(null, `select delete_my_account()`)).rejects.toThrow(/permission denied/i);
    await expect(q(null, `select account_deletion_preview()`)).rejects.toThrow(/permission denied/i);
    const keep = await mk('safe1');
    const go = await mk('safe2');
    await q(go, `select delete_my_account()`);
    expect(await exists(keep)).toBe(true);
  });
});
