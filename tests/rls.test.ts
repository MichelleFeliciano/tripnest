/**
 * Database-level security tests. Runs the REAL migrations in PGlite (in-process Postgres 16+)
 * with Supabase-compatible stubs for auth.uid()/auth.jwt() and roles. Every assertion here
 * exercises row-level security, column privileges, constraints and RPCs, not mocks.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const MIG = join(__dirname, '..', 'supabase', 'migrations');
const sql = (f: string) => readFileSync(join(MIG, f), 'utf8');

let db: PGlite;
interface U { id: string; email: string }
const U = (n: number, name: string): U => ({ id: `00000000-0000-4000-8000-00000000000${n}`, email: `${name}@example.com` });
const alice = U(1, 'alice'); // owner
const bob = U(2, 'bob'); // editor
const carol = U(3, 'carol'); // viewer
const dave = U(4, 'dave'); // outsider

async function as<T>(u: U | null, fn: () => Promise<T>): Promise<T> {
  if (u) {
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: u.id, email: u.email, role: 'authenticated' })]);
    await db.exec('set role authenticated');
  } else {
    await db.query(`select set_config('request.jwt.claims', '', false)`);
    await db.exec('set role anon');
  }
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
}
const q = async <R = Record<string, unknown>>(u: U | null, text: string, params: unknown[] = []) =>
  (await as(u, () => db.query<R>(text, params))).rows;

let trip: string;
let otherTrip: string;
let item: string;

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
  for (const f of ['0001_schema.sql', '0002_security.sql', '0003_storage.sql']) await db.exec(sql(f));
  for (const u of [alice, bob, carol, dave]) {
    await db.query(`insert into auth.users (id, email) values ($1, $2)`, [u.id, u.email]);
  }
  // alice creates a trip; bob (editor) and carol (viewer) join through the real invitation flow
  trip = (await q<{ id: string }>(alice, `insert into trips (owner_id, name, start_date, end_date) values ($1, 'Puerto Rico', '2026-06-12', '2026-06-19') returning id`, [alice.id]))[0].id;
  for (const [u, role] of [[bob, 'editor'], [carol, 'viewer']] as const) {
    const token = (await q<{ create_invitation: string }>(alice, `select create_invitation($1, $2, $3)`, [trip, u.email, role]))[0].create_invitation;
    await q(u, `select accept_invitation($1)`, [token]);
  }
  otherTrip = (await q<{ id: string }>(dave, `insert into trips (owner_id, name, start_date, end_date) values ($1, 'Dave private', '2026-07-01', '2026-07-02') returning id`, [dave.id]))[0].id;
  item = (await q<{ id: string }>(alice, `insert into itinerary_items (trip_id, local_date, title) values ($1, '2026-06-12', 'Dinner') returning id`, [trip]))[0].id;
});
afterAll(async () => { await db.close(); });

describe('trip isolation', () => {
  it('creator becomes the owner member', async () => {
    const r = await q<{ role: string }>(alice, `select role from trip_members where trip_id = $1 and user_id = $2`, [trip, alice.id]);
    expect(r[0].role).toBe('owner');
  });
  it('non-members cannot see another trip or any of its data', async () => {
    expect(await q(dave, `select id from trips where id = $1`, [trip])).toHaveLength(0);
    expect(await q(dave, `select id from itinerary_items where trip_id = $1`, [trip])).toHaveLength(0);
    expect(await q(dave, `select * from trip_members where trip_id = $1`, [trip])).toHaveLength(0);
    expect(await q(dave, `select * from profiles where id = $1`, [alice.id])).toHaveLength(0);
  });
  it('members see only their own trips', async () => {
    const rows = await q<{ id: string }>(bob, `select id from trips`);
    expect(rows.map((r) => r.id)).toEqual([trip]);
  });
  it('members can see co-travelers profiles', async () => {
    expect(await q(bob, `select id from profiles where id = $1`, [alice.id])).toHaveLength(1);
  });
  it('anonymous users get nothing (privilege revoked)', async () => {
    await expect(q(null, `select * from trips`)).rejects.toThrow(/permission denied/i);
    await expect(q(null, `select create_invitation($1, 'x@y.com', 'viewer')`, [trip])).rejects.toThrow(/permission denied/i);
  });
  it('outsider cannot write into someone elses trip', async () => {
    await expect(q(dave, `insert into itinerary_items (trip_id, local_date, title) values ($1, '2026-06-12', 'x')`, [trip])).rejects.toThrow(/row-level security/i);
    await expect(q(dave, `insert into destinations (trip_id, name) values ($1, 'x')`, [trip])).rejects.toThrow(/row-level security/i);
  });
  it('cannot create a trip owned by someone else', async () => {
    await expect(q(dave, `insert into trips (owner_id, name, start_date, end_date) values ($1, 'x', '2026-01-01', '2026-01-02')`, [alice.id])).rejects.toThrow(/row-level security/i);
  });
  it('rejects end date before start date at the database too', async () => {
    await expect(q(alice, `insert into trips (owner_id, name, start_date, end_date) values ($1, 'bad', '2026-02-02', '2026-02-01')`, [alice.id])).rejects.toThrow(/trips_dates_ordered/);
  });
});

describe('roles', () => {
  it('editor can add itinerary items and destinations', async () => {
    expect(await q(bob, `insert into itinerary_items (trip_id, local_date, title) values ($1, '2026-06-13', 'Beach') returning id`, [trip])).toHaveLength(1);
    expect(await q(bob, `insert into destinations (trip_id, name) values ($1, 'San Juan') returning id`, [trip])).toHaveLength(1);
  });
  it('viewer can read but not write', async () => {
    expect((await q(carol, `select id from itinerary_items where trip_id = $1`, [trip])).length).toBeGreaterThan(0);
    await expect(q(carol, `insert into itinerary_items (trip_id, local_date, title) values ($1, '2026-06-13', 'x')`, [trip])).rejects.toThrow(/row-level security/i);
    expect(await q(carol, `update itinerary_items set title = 'hacked' where id = $1 returning id`, [item])).toHaveLength(0);
    expect(await q(carol, `delete from itinerary_items where id = $1 returning id`, [item])).toHaveLength(0);
    await expect(q(carol, `insert into budgets (trip_id, amount_cents, currency) values ($1, 100, 'USD')`, [trip])).rejects.toThrow(/row-level security/i);
    await expect(q(carol, `insert into notes (trip_id, scope, body) values ($1, 'trip', 'hi')`, [trip])).rejects.toThrow(/row-level security/i);
  });
  it('editor cannot update, archive, or delete the trip', async () => {
    expect(await q(bob, `update trips set status = 'archived' where id = $1 returning id`, [trip])).toHaveLength(0);
    expect(await q(bob, `delete from trips where id = $1 returning id`, [trip])).toHaveLength(0);
    expect(await q(carol, `delete from trips where id = $1 returning id`, [trip])).toHaveLength(0);
  });
  it('nobody can reassign trip ownership', async () => {
    await expect(q(alice, `update trips set owner_id = $2 where id = $1`, [trip, bob.id])).rejects.toThrow(/permission denied/i);
  });
  it('members cannot change roles or add members directly', async () => {
    expect(await q(bob, `update trip_members set role = 'owner' where trip_id = $1 and user_id = $2 returning user_id`, [trip, bob.id])).toHaveLength(0);
    expect(await q(bob, `update trip_members set role = 'owner' where trip_id = $1 returning user_id`, [trip])).toHaveLength(0);
    await expect(q(dave, `insert into trip_members (trip_id, user_id, role) values ($1, $2, 'owner')`, [trip, dave.id])).rejects.toThrow(/permission denied/i);
  });
  it('only the owner can change a member role, and never to owner', async () => {
    await expect(q(alice, `update trip_members set role = 'owner' where trip_id = $1 and user_id = $2`, [trip, carol.id])).rejects.toThrow(/row-level security/i);
    expect(await q(alice, `update trip_members set role = 'editor' where trip_id = $1 and user_id = $2 returning role`, [trip, carol.id])).toHaveLength(1);
    expect(await q(alice, `update trip_members set role = 'viewer' where trip_id = $1 and user_id = $2 returning role`, [trip, carol.id])).toHaveLength(1);
  });
  it('the owner membership cannot be removed', async () => {
    expect(await q(alice, `delete from trip_members where trip_id = $1 and user_id = $2 returning user_id`, [trip, alice.id])).toHaveLength(0);
    expect(await q(bob, `delete from trip_members where trip_id = $1 and user_id = $2 returning user_id`, [trip, alice.id])).toHaveLength(0);
  });
  it('members can leave, but not remove others (unless owner)', async () => {
    expect(await q(carol, `delete from trip_members where trip_id = $1 and user_id = $2 returning user_id`, [trip, bob.id])).toHaveLength(0);
  });
  it('profiles: cannot forge email or edit other profiles', async () => {
    await expect(q(bob, `update profiles set email = 'alice@example.com' where id = $1`, [bob.id])).rejects.toThrow(/permission denied/i);
    expect(await q(bob, `update profiles set display_name = 'Pwned' where id = $1 returning id`, [alice.id])).toHaveLength(0);
    expect(await q(bob, `update profiles set display_name = 'Bobby' where id = $1 returning id`, [bob.id])).toHaveLength(1);
  });
  it('cross-trip references are rejected by composite foreign keys', async () => {
    const foreignItem = (await q<{ id: string }>(dave, `insert into itinerary_items (trip_id, local_date, title) values ($1, '2026-07-01', 'x') returning id`, [otherTrip]))[0].id;
    await expect(q(bob, `insert into reservations (trip_id, itinerary_item_id, kind, title) values ($1, $2, 'hotel', 'x')`, [trip, foreignItem])).rejects.toThrow(/foreign key/i);
    await expect(q(bob, `insert into notes (trip_id, scope, target_id, body) values ($1, 'itinerary', $2, 'x')`, [trip, foreignItem])).rejects.toThrow(/does not belong/i);
  });
});

describe('invitations', () => {
  it('stores only a hash and hides it from clients', async () => {
    const token = (await q<{ create_invitation: string }>(alice, `select create_invitation($1, 'erin@example.com', 'viewer')`, [trip]))[0].create_invitation;
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    await expect(q(alice, `select token_hash from trip_invitations`)).rejects.toThrow(/permission denied/i);
    await expect(q(alice, `select * from trip_invitations`)).rejects.toThrow(/permission denied/i);
    const raw = await db.query<{ token_hash: string }>(`select token_hash from trip_invitations where email = 'erin@example.com'`);
    expect(raw.rows[0].token_hash).not.toBe(token);
    expect(raw.rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it('viewers and outsiders cannot invite or list invitations', async () => {
    await expect(q(carol, `select create_invitation($1, 'x@example.com', 'viewer')`, [trip])).rejects.toThrow(/not allowed/i);
    await expect(q(dave, `select create_invitation($1, 'x@example.com', 'viewer')`, [trip])).rejects.toThrow(/not allowed/i);
    expect(await q(carol, `select id from trip_invitations`)).toHaveLength(0);
    expect(await q(dave, `select id from trip_invitations`)).toHaveLength(0);
  });
  it('invitations can never grant ownership', async () => {
    await expect(q(alice, `select create_invitation($1, 'x@example.com', 'owner')`, [trip])).rejects.toThrow(/invalid role/i);
  });
  it('rejects bad emails and inviting existing members', async () => {
    await expect(q(alice, `select create_invitation($1, 'not-an-email', 'viewer')`, [trip])).rejects.toThrow(/invalid email/i);
    await expect(q(alice, `select create_invitation($1, 'bob@example.com', 'viewer')`, [trip])).rejects.toThrow(/already/i);
  });
  it('only the invited email can preview/accept; errors do not reveal existence', async () => {
    const token = (await q<{ create_invitation: string }>(alice, `select create_invitation($1, 'frank@example.com', 'editor')`, [trip]))[0].create_invitation;
    await expect(q(dave, `select accept_invitation($1)`, [token])).rejects.toThrow(/Invitation not found/);
    await expect(q(dave, `select accept_invitation('deadbeef')`)).rejects.toThrow(/Invitation not found/);
    await expect(q(dave, `select invitation_preview($1)`, [token])).rejects.toThrow(/Invitation not found/);
    expect(await q(dave, `select 1 from trip_members where trip_id = $1 and user_id = $2`, [trip, dave.id])).toHaveLength(0);
  });
  it('accepting grants the invited role exactly once', async () => {
    const frank = U(5, 'frank');
    await db.query(`insert into auth.users (id, email) values ($1, $2)`, [frank.id, frank.email]);
    const token = (await q<{ create_invitation: string }>(alice, `select create_invitation($1, 'frank2@example.com', 'viewer')`, [trip]))[0].create_invitation;
    const frank2 = U(6, 'frank2');
    await db.query(`insert into auth.users (id, email) values ($1, $2)`, [frank2.id, frank2.email]);
    const preview = (await q<{ invitation_preview: { trip_name: string; role: string } }>(frank2, `select invitation_preview($1)`, [token]))[0].invitation_preview;
    expect(preview).toMatchObject({ trip_name: 'Puerto Rico', role: 'viewer' });
    const r1 = (await q<{ accept_invitation: { status: string } }>(frank2, `select accept_invitation($1)`, [token]))[0].accept_invitation;
    expect(r1.status).toBe('accepted');
    const role = await q<{ role: string }>(frank2, `select role from trip_members where trip_id = $1 and user_id = $2`, [trip, frank2.id]);
    expect(role[0].role).toBe('viewer');
    const r2 = (await q<{ accept_invitation: { status: string } }>(frank2, `select accept_invitation($1)`, [token]))[0].accept_invitation;
    expect(r2.status).toBe('accepted'); // idempotent, no duplicate membership
    expect((await db.query(`select 1 from trip_members where user_id = $1`, [frank2.id])).rows).toHaveLength(1);
  });
  it('expired invitations cannot be accepted', async () => {
    const gina = U(7, 'gina');
    await db.query(`insert into auth.users (id, email) values ($1, $2)`, [gina.id, gina.email]);
    const token = (await q<{ create_invitation: string }>(alice, `select create_invitation($1, $2, 'viewer')`, [trip, gina.email]))[0].create_invitation;
    await db.query(`update trip_invitations set expires_at = now() - interval '1 minute' where email = $1`, [gina.email]);
    const r = (await q<{ accept_invitation: { status: string } }>(gina, `select accept_invitation($1)`, [token]))[0].accept_invitation;
    expect(r.status).toBe('expired');
    expect(await q(gina, `select 1 from trip_members where user_id = $1`, [gina.id])).toHaveLength(0);
    expect((await db.query<{ status: string }>(`select status from trip_invitations where email = $1`, [gina.email])).rows[0].status).toBe('expired');
  });
  it('declined invitations cannot later be accepted', async () => {
    const hal = U(8, 'hal');
    await db.query(`insert into auth.users (id, email) values ($1, $2)`, [hal.id, hal.email]);
    const token = (await q<{ create_invitation: string }>(alice, `select create_invitation($1, $2, 'editor')`, [trip, hal.email]))[0].create_invitation;
    expect((await q<{ decline_invitation: { status: string } }>(hal, `select decline_invitation($1)`, [token]))[0].decline_invitation.status).toBe('declined');
    expect((await q<{ accept_invitation: { status: string } }>(hal, `select accept_invitation($1)`, [token]))[0].accept_invitation.status).toBe('declined');
    expect(await q(hal, `select 1 from trip_members where user_id = $1`, [hal.id])).toHaveLength(0);
  });
});

describe('expenses (database integrity)', () => {
  const data = (over: Record<string, unknown> = {}) => JSON.stringify({ paid_by: alice.id, description: 'Hotel', amount_cents: 10000, currency: 'USD', expense_date: '2026-06-12', category: 'Lodging', split_method: 'equal', ...over });
  const splits = (...pairs: [U, number][]) => JSON.stringify(pairs.map(([u, a]) => ({ user_id: u.id, amount_cents: a })));
  const save = (u: U, id: string | null, d: string, s: string) => q<{ save_expense: string }>(u, `select save_expense($1, $2, $3::jsonb, $4::jsonb)`, [trip, id, d, s]);

  it('editor can save a balanced expense; splits are stored', async () => {
    const id = (await save(bob, null, data(), splits([alice, 3333], [bob, 3333], [carol, 3334])))[0].save_expense;
    const rows = await q<{ amount_cents: string }>(alice, `select amount_cents from expense_splits where expense_id = $1 order by amount_cents`, [id]);
    expect(rows.map((r) => Number(r.amount_cents))).toEqual([3333, 3333, 3334]);
  });
  it('rejects splits that do not equal the total', async () => {
    await expect(save(bob, null, data(), splits([alice, 3333], [bob, 3333], [carol, 3333]))).rejects.toThrow(/must add up/i);
    await expect(save(bob, null, data(), splits([alice, 10001]))).rejects.toThrow(/must add up/i);
  });
  it('rejects zero/negative amounts and negative splits', async () => {
    await expect(save(bob, null, data({ amount_cents: 0 }), splits([alice, 0]))).rejects.toThrow(/greater than zero/i);
    await expect(save(bob, null, data({ amount_cents: -500 }), splits([alice, -500]))).rejects.toThrow();
    await expect(save(bob, null, data(), splits([alice, 10100], [bob, -100]))).rejects.toThrow(/negative/i);
  });
  it('viewers and outsiders cannot add expenses', async () => {
    await expect(save(carol, null, data(), splits([alice, 10000]))).rejects.toThrow(/not allowed/i);
    await expect(save(dave, null, data(), splits([alice, 10000]))).rejects.toThrow(/not allowed/i);
  });
  it('payer and split people must be trip members', async () => {
    await expect(save(bob, null, data({ paid_by: dave.id }), splits([alice, 10000]))).rejects.toThrow(/payer must be/i);
    await expect(save(bob, null, data(), splits([alice, 5000], [dave, 5000]))).rejects.toThrow(/must be a trip member/i);
  });
  it('clients cannot write expenses or splits directly (bypassing validation)', async () => {
    await expect(q(bob, `insert into expenses (trip_id, paid_by, description, amount_cents, expense_date, split_method) values ($1, $2, 'x', 100, '2026-06-12', 'equal')`, [trip, bob.id])).rejects.toThrow(/permission denied/i);
    await expect(q(bob, `insert into expense_splits (expense_id, user_id, amount_cents) values (gen_random_uuid(), $1, 1)`, [bob.id])).rejects.toThrow(/permission denied/i);
    await expect(q(bob, `update expenses set amount_cents = 1 where trip_id = $1`, [trip])).rejects.toThrow(/permission denied/i);
  });
  it('even a privileged direct insert cannot commit unbalanced splits (deferred constraint)', async () => {
    await expect(db.transaction(async (tx) => {
      const e = await tx.query<{ id: string }>(`insert into expenses (trip_id, created_by, paid_by, description, amount_cents, expense_date, split_method) values ($1, $2, $2, 'x', 1000, '2026-06-12', 'custom') returning id`, [trip, alice.id]);
      await tx.query(`insert into expense_splits (expense_id, user_id, amount_cents) values ($1, $2, 999)`, [e.rows[0].id, alice.id]);
    })).rejects.toThrow(/must equal the expense total/i);
    await expect(db.query(`insert into expenses (trip_id, created_by, paid_by, description, amount_cents, expense_date, split_method) values ($1, $2, $2, 'x', 1000, '2026-06-12', 'custom')`, [trip, alice.id])).rejects.toThrow(/must equal/i);
  });
  it('editors may edit/delete only their own expenses; owner may edit any; viewers none', async () => {
    const aliceExp = (await save(alice, null, data({ description: 'Alice paid' }), splits([alice, 10000])))[0].save_expense;
    const bobExp = (await save(bob, null, data({ description: 'Bob paid' }), splits([bob, 10000])))[0].save_expense;
    await expect(save(bob, aliceExp, data(), splits([alice, 10000]))).rejects.toThrow(/not allowed/i);
    expect(await q(bob, `delete from expenses where id = $1 returning id`, [aliceExp])).toHaveLength(0);
    await expect(save(carol, bobExp, data(), splits([alice, 10000]))).rejects.toThrow(/not allowed/i);
    expect(await q(carol, `delete from expenses where id = $1 returning id`, [bobExp])).toHaveLength(0);
    // owner edits Bob's expense and changes the split
    await save(alice, bobExp, data({ description: 'Bob paid (fixed)', amount_cents: 6000 }), splits([alice, 2000], [bob, 4000]));
    const rows = await q<{ amount_cents: string }>(alice, `select amount_cents from expense_splits where expense_id = $1 order by amount_cents`, [bobExp]);
    expect(rows.map((r) => Number(r.amount_cents))).toEqual([2000, 4000]);
    expect(await q(bob, `delete from expenses where id = $1 returning id`, [bobExp])).toHaveLength(1);
    expect(await q(alice, `select 1 from expense_splits where expense_id = $1`, [bobExp])).toHaveLength(0); // cascade
  });
  it('cannot edit an expense via another trip', async () => {
    const e = (await save(alice, null, data(), splits([alice, 10000])))[0].save_expense;
    await expect(q(dave, `select save_expense($1, $2, $3::jsonb, $4::jsonb)`, [otherTrip, e, data({ paid_by: dave.id }), JSON.stringify([{ user_id: dave.id, amount_cents: 10000 }])])).rejects.toThrow(/not found/i);
  });
  it('outsiders cannot read expenses', async () => {
    expect(await q(dave, `select * from expenses`)).toHaveLength(0);
    expect(await q(dave, `select * from expense_splits`)).toHaveLength(0);
  });
  it('rejects malformed currency codes', async () => {
    await expect(save(bob, null, data({ currency: 'usd' }), splits([alice, 10000]))).rejects.toThrow(/currency/i);
  });
});

describe('settlements (append-only ledger)', () => {
  const rec = (u: U, from: U, to: U, amt: number) => q(u, `select record_settlement($1, $2, $3, $4, 'USD', '2026-06-19', 'cash')`, [trip, from.id, to.id, amt]);
  it('editor can record; history cannot be altered or deleted', async () => {
    await rec(bob, bob, alice, 2500);
    const rows = await q<{ id: string }>(alice, `select id from settlements`);
    expect(rows.length).toBeGreaterThan(0);
    await expect(q(alice, `update settlements set amount_cents = 1 where id = $1`, [rows[0].id])).rejects.toThrow(/permission denied/i);
    await expect(q(alice, `delete from settlements where id = $1`, [rows[0].id])).rejects.toThrow(/permission denied/i);
    await expect(q(alice, `insert into settlements (trip_id, from_user, to_user, amount_cents, currency) values ($1, $2, $3, 1, 'USD')`, [trip, bob.id, alice.id])).rejects.toThrow(/permission denied/i);
  });
  it('deleting an expense does not touch settlement history', async () => {
    const before = (await db.query(`select count(*)::int as n from settlements`)).rows[0] as { n: number };
    const e = (await q<{ save_expense: string }>(bob, `select save_expense($1, null, $2::jsonb, $3::jsonb)`, [trip, JSON.stringify({ paid_by: bob.id, description: 'x', amount_cents: 500, expense_date: '2026-06-12', split_method: 'equal' }), JSON.stringify([{ user_id: bob.id, amount_cents: 500 }])]))[0].save_expense;
    await q(bob, `delete from expenses where id = $1`, [e]);
    expect(((await db.query(`select count(*)::int as n from settlements`)).rows[0] as { n: number }).n).toBe(before.n);
  });
  it('viewers/outsiders cannot record; people must be members; amounts positive; no self-payment', async () => {
    await expect(rec(carol, bob, alice, 100)).rejects.toThrow(/not allowed/i);
    await expect(rec(dave, bob, alice, 100)).rejects.toThrow(/not allowed/i);
    await expect(rec(bob, bob, dave, 100)).rejects.toThrow(/trip members/i);
    await expect(rec(bob, bob, alice, 0)).rejects.toThrow(/amount_cents/i);
    await expect(rec(bob, bob, alice, -5)).rejects.toThrow(/amount_cents/i);
    await expect(rec(bob, bob, bob, 5)).rejects.toThrow(/settlements_distinct_people/i);
  });
  it('outsiders cannot read settlements', async () => {
    expect(await q(dave, `select * from settlements`)).toHaveLength(0);
  });
});

describe('packing visibility', () => {
  it('personal lists are private; shared lists are visible to all members', async () => {
    const shared = (await q<{ id: string }>(bob, `insert into packing_categories (trip_id, name) values ($1, 'Shared') returning id`, [trip]))[0].id;
    await q(bob, `insert into packing_items (trip_id, category_id, name) values ($1, $2, 'Sunscreen')`, [trip, shared]);
    const mine = (await q<{ id: string }>(carol, `insert into packing_categories (trip_id, name, is_shared, owner_id) values ($1, 'Mine', false, $2) returning id`, [trip, carol.id]))[0].id;
    await q(carol, `insert into packing_items (trip_id, category_id, name, is_shared, owner_id) values ($1, $2, 'Secret', false, $3)`, [trip, mine, carol.id]);
    expect((await q<{ name: string }>(carol, `select name from packing_items order by name`)).map((r) => r.name)).toEqual(['Secret', 'Sunscreen']);
    expect((await q<{ name: string }>(bob, `select name from packing_items`)).map((r) => r.name)).toEqual(['Sunscreen']);
    expect(await q(alice, `select 1 from packing_categories where name = 'Mine'`)).toHaveLength(0);
    expect(await q(bob, `update packing_items set packed = true where name = 'Secret' returning id`)).toHaveLength(0);
  });
  it('viewers cannot modify the shared list but can manage their own', async () => {
    const shared = (await q<{ id: string }>(alice, `select id from packing_categories where name = 'Shared'`))[0].id;
    await expect(q(carol, `insert into packing_items (trip_id, category_id, name) values ($1, $2, 'x')`, [trip, shared])).rejects.toThrow(/row-level security/i);
    expect(await q(carol, `update packing_items set packed = true where name = 'Sunscreen' returning id`)).toHaveLength(0);
  });
  it('items can only be assigned to trip members', async () => {
    const shared = (await q<{ id: string }>(alice, `select id from packing_categories where name = 'Shared'`))[0].id;
    await expect(q(bob, `insert into packing_items (trip_id, category_id, name, assigned_to) values ($1, $2, 'x', $3)`, [trip, shared, dave.id])).rejects.toThrow(/not a member/i);
    expect(await q(bob, `insert into packing_items (trip_id, category_id, name, assigned_to) values ($1, $2, 'ok', $3) returning id`, [trip, shared, carol.id])).toHaveLength(1);
  });
});

describe('budgets & notes', () => {
  it('one total budget per trip and one per category', async () => {
    await q(bob, `insert into budgets (trip_id, amount_cents, currency) values ($1, 200000, 'USD')`, [trip]);
    await expect(q(bob, `insert into budgets (trip_id, amount_cents, currency) values ($1, 1, 'USD')`, [trip])).rejects.toThrow(/unique|duplicate/i);
    await q(bob, `insert into budgets (trip_id, category, amount_cents, currency) values ($1, 'Food', 50000, 'USD')`, [trip]);
  });
  it('notes: trip-level must not have a target; editors only edit own; viewers read', async () => {
    await expect(q(bob, `insert into notes (trip_id, scope, target_id, body) values ($1, 'trip', gen_random_uuid(), 'x')`, [trip])).rejects.toThrow(/notes_scope_target/);
    const n = (await q<{ id: string }>(bob, `insert into notes (trip_id, scope, body, created_by) values ($1, 'trip', 'bring cash', $2) returning id`, [trip, bob.id]))[0];
    expect(n).toBeDefined();
    expect(await q(bob, `insert into notes (trip_id, scope, target_id, body, created_by) values ($1, 'itinerary', $2, 'ask for a window', $3) returning id`, [trip, item, bob.id])).toHaveLength(1);
    expect(await q(carol, `update notes set body = 'x' where id = $1 returning id`, [n.id])).toHaveLength(0);
    expect(await q(carol, `select id from notes`)).toHaveLength(2);
  });
});

describe('documents & private storage', () => {
  const path = () => `${trip}/${crypto.randomUUID()}-hotel.pdf`;
  const meta = (p: string, by: U) => q(by, `insert into documents (trip_id, storage_path, file_name, mime_type, size_bytes, uploaded_by) values ($1, $2, 'hotel.pdf', 'application/pdf', 1234, $3) returning id`, [trip, p, by.id]);

  it('bucket is private', async () => {
    expect((await db.query<{ public: boolean }>(`select public from storage.buckets where id = 'trip-documents'`)).rows[0].public).toBe(false);
  });
  it('editors can add document records and upload objects; viewers cannot', async () => {
    const p = path();
    expect(await meta(p, bob)).toHaveLength(1);
    expect(await q(bob, `insert into storage.objects (bucket_id, name) values ('trip-documents', $1) returning id`, [p])).toHaveLength(1);
    await expect(meta(path(), carol)).rejects.toThrow(/row-level security/i);
    await expect(q(carol, `insert into storage.objects (bucket_id, name) values ('trip-documents', $1)`, [path()])).rejects.toThrow(/row-level security/i);
  });
  it('only trip members can read objects/records (this is what gates signed URLs)', async () => {
    expect((await q(carol, `select 1 from storage.objects where bucket_id = 'trip-documents'`)).length).toBeGreaterThan(0);
    expect(await q(dave, `select 1 from storage.objects where bucket_id = 'trip-documents'`)).toHaveLength(0);
    expect(await q(dave, `select 1 from documents`)).toHaveLength(0);
  });
  it('outsiders cannot upload into another trips folder or use malformed paths', async () => {
    await expect(q(dave, `insert into storage.objects (bucket_id, name) values ('trip-documents', $1)`, [path()])).rejects.toThrow(/row-level security/i);
    await expect(q(bob, `insert into storage.objects (bucket_id, name) values ('trip-documents', '../etc/passwd')`)).rejects.toThrow(/row-level security/i);
    await expect(q(bob, `insert into storage.objects (bucket_id, name) values ('trip-documents', $1)`, [`${otherTrip}/x.pdf`])).rejects.toThrow(/row-level security/i);
  });
  it('document records must point inside their own trip folder; size/type limits enforced', async () => {
    await expect(q(bob, `insert into documents (trip_id, storage_path, file_name, mime_type, size_bytes, uploaded_by) values ($1, $2, 'x.pdf', 'application/pdf', 1, $3)`, [trip, `${otherTrip}/x.pdf`, bob.id])).rejects.toThrow(/documents_path_in_trip/);
    await expect(q(bob, `insert into documents (trip_id, storage_path, file_name, mime_type, size_bytes, uploaded_by) values ($1, $2, 'x.exe', 'application/x-msdownload', 1, $3)`, [trip, path(), bob.id])).rejects.toThrow(/mime_type/);
    await expect(q(bob, `insert into documents (trip_id, storage_path, file_name, mime_type, size_bytes, uploaded_by) values ($1, $2, 'big.pdf', 'application/pdf', 99999999, $3)`, [trip, path(), bob.id])).rejects.toThrow(/size_bytes/);
  });
});

describe('time zones & itinerary constraints', () => {
  it('requires a zone with any timestamp and rejects end before start', async () => {
    await expect(q(bob, `insert into itinerary_items (trip_id, local_date, title, start_at) values ($1, '2026-06-12', 'x', now())`, [trip])).rejects.toThrow(/itinerary_start_has_tz/);
    await expect(q(bob, `insert into itinerary_items (trip_id, local_date, title, start_at, start_tz, end_at, end_tz) values ($1, '2026-06-12', 'x', '2026-06-12T13:00Z', 'America/Chicago', '2026-06-12T12:00Z', 'America/Puerto_Rico')`, [trip])).rejects.toThrow(/itinerary_times_ordered/);
  });
  it('stores the instant and the place zone', async () => {
    const r = await q<{ start_at: string; start_tz: string }>(bob, `insert into itinerary_items (trip_id, local_date, title, item_type, start_at, start_tz, end_at, end_tz) values ($1, '2026-06-12', 'Flight', 'flight', '2026-06-12T13:00:00Z', 'America/Chicago', '2026-06-12T17:30:00Z', 'America/Puerto_Rico') returning start_tz, end_tz`, [trip]);
    expect(r[0]).toMatchObject({ start_tz: 'America/Chicago', end_tz: 'America/Puerto_Rico' });
  });
});
