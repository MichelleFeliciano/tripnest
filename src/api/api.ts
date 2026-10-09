/**
 * TripNest data layer. Everything is stored on this device (see db.ts); nothing is sent anywhere.
 * The rules the old database used to enforce (valid money, balanced splits, cascades, same-trip references)
 * are enforced here, inside single transactions, and are covered by tests/store.test.ts.
 */
import { transaction, TABLES, StorageUnavailableError, type Row, type Table, type Tx } from './db';
import type {
  BudgetRowDb, Destination, DocumentRow, Expense, ItineraryRow, Note, PackingCategory, PackingItem, Reservation, Settlement,
  Traveler, Trip, TripData,
} from './types';
import type { SplitMethod } from '../lib/splits';
import { expandTemplate, type PackingTemplate } from '../lib/packing';
import { BUDGET_CATEGORIES, EXPENSE_CATEGORIES } from '../lib/budget';
import { ITEM_TYPES } from '../lib/itinerary';
import { MAX_MINOR_UNITS } from '../lib/money';
import { TRIP_STATUSES, isValidIsoDate, validateTrip } from '../lib/trip';
import { uuid } from '../lib/uuid';

export class ApiError extends Error {}

/** Turn low-level errors into messages a traveler can act on. */
export function friendly(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (e instanceof StorageUnavailableError) return new ApiError(e.message);
  const err = (e ?? {}) as { name?: string; message?: string };
  if (err.name === 'QuotaExceededError') return new ApiError('This device is out of storage space for TripNest. Free up space or remove large documents, then try again.');
  return new ApiError(err.message || 'Something went wrong. Please try again.');
}

/** Sorting helpers that tolerate missing fields (records from hand-edited files). */
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const ord = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Empty strings become null so optional fields stay clean. */
export function clean<T extends Record<string, unknown>>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) out[k] = typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v;
  return out as T;
}

const nowIso = () => new Date().toISOString();
function need(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new ApiError(msg);
}
const isCode = (c: unknown) => typeof c === 'string' && /^[A-Z]{3}$/.test(c);
const isMinor = (n: unknown, min = 0) => typeof n === 'number' && Number.isSafeInteger(n) && n >= min && n <= MAX_MINOR_UNITS;
const httpUrl = (u: unknown) => u === null || u === undefined || (typeof u === 'string' && /^https?:\/\//i.test(u));
const textLen = (s: unknown, min: number, max: number) => typeof s === 'string' && s.trim().length >= min && s.length <= max;
function coords(r: Row) {
  const lat = r.latitude ?? null;
  const lng = r.longitude ?? null;
  need((lat === null) === (lng === null), 'Enter both latitude and longitude, or neither');
  need(lat === null || (typeof lat === 'number' && Math.abs(lat) <= 90), 'Latitude must be between -90 and 90');
  need(lng === null || (typeof lng === 'number' && Math.abs(lng) <= 180), 'Longitude must be between -180 and 180');
}

const ALL: Table[] = [...TABLES];

// ───────── settings-free helpers used by several areas ─────────
async function requireTrip(x: Tx, tripId: unknown): Promise<Row> {
  const t = typeof tripId === 'string' ? await x.get('trips', tripId) : undefined;
  need(t, 'That trip no longer exists.');
  return t;
}
async function travelerIds(x: Tx, tripId: string): Promise<Set<string>> {
  return new Set((await x.byTrip('travelers', tripId)).map((t) => t.id));
}

// ───────── trips ─────────
export interface NewTrip {
  name: string; description?: string; start_date: string; end_date: string; cover_image_url?: string;
  primary_destination?: string; status?: string; notes?: string; default_currency?: string;
}

function checkTrip(t: Row) {
  const problems = validateTrip({ name: t.name ?? '', startDate: t.start_date ?? '', endDate: t.end_date ?? '' });
  need(problems.length === 0, problems[0]);
  need(TRIP_STATUSES.includes(t.status), 'Choose a valid trip status');
  need(isCode(t.default_currency), 'Choose a valid currency');
  need(Number.isInteger(t.budget_near_pct) && t.budget_near_pct >= 1 && t.budget_near_pct <= 100, 'Budget warning threshold must be 1 to 100');
  need(t.cover_image_url === null || /^https:\/\//i.test(t.cover_image_url), 'Cover image must be an https:// link');
}

export const trips = {
  list: async (): Promise<Trip[]> => {
    const rows = (await transaction(['trips'], 'readonly', (x) => x.all('trips'))) as unknown as Trip[];
    return rows.sort((a, b) => str(b.start_date).localeCompare(str(a.start_date)) || str(b.created_at).localeCompare(str(a.created_at)));
  },
  /** names[0] is "you"; the rest are the other travelers. extraDestinations become destinations after the primary one. */
  create: async (t: NewTrip, names: string[], extraDestinations: string[]): Promise<Trip> => {
    try {
      const row: Row = {
        id: uuid(), description: null, cover_image_url: null, primary_destination: null, status: 'planning', notes: null,
        default_currency: 'USD', budget_near_pct: 80, ...clean(t as unknown as Record<string, unknown>), created_at: nowIso(),
      };
      checkTrip(row);
      const seen = new Set<string>();
      const people = names.map((n) => n.trim()).filter((n) => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()) && n.length <= 80);
      need(people.length > 0, 'Add your name so the trip has at least one traveler.');
      const dests = [row.primary_destination, ...extraDestinations].map((s) => String(s ?? '').trim()).filter(Boolean);
      await transaction(ALL, 'readwrite', async (x) => {
        await x.put('trips', row);
        for (const [i, name] of people.entries()) await x.put('travelers', { id: uuid(), trip_id: row.id, name, is_me: i === 0, sort_order: i });
        for (const [i, name] of dests.entries()) await x.put('destinations', { id: uuid(), trip_id: row.id, name: name.slice(0, 200), country: null, region: null, latitude: null, longitude: null, notes: null, arrival_date: null, departure_date: null, sort_order: i });
      });
      return row as unknown as Trip;
    } catch (e) { throw friendly(e); }
  },
  update: async (id: string, patch: Partial<Trip>) => {
    try {
      await transaction(['trips'], 'readwrite', async (x) => {
        const cur = await requireTrip(x, id);
        const next = { ...cur, ...clean(patch as Record<string, unknown>), id };
        checkTrip(next);
        await x.put('trips', next);
      });
    } catch (e) { throw friendly(e); }
  },
  /** Deletes the trip and everything in it, including uploaded documents. */
  remove: async (id: string) => {
    try {
      await transaction([...ALL, 'blobs'], 'readwrite', async (x) => {
        for (const d of await x.byTrip('documents', id)) await x.blobDel(d.id);
        for (const t of ALL) {
          if (t === 'trips') continue;
          for (const r of await x.byTrip(t, id)) await x.del(t, r.id);
        }
        await x.del('trips', id);
      });
    } catch (e) { throw friendly(e); }
  },
};

export async function loadTrip(id: string): Promise<TripData> {
  try {
    return await transaction(ALL, 'readonly', async (x) => {
      const trip = await requireTrip(x, id);
      const by = async <T,>(t: Table) => (await x.byTrip(t, id)) as unknown as T[];
      const travelers = (await by<Traveler>('travelers')).sort((a, b) => ord(a.sort_order) - ord(b.sort_order));
      const exps = await by<Expense>('expenses');
      return {
        trip: trip as unknown as Trip,
        me: (travelers.find((t) => t.is_me) ?? travelers[0])?.id ?? '',
        travelers,
        destinations: (await by<Destination>('destinations')).sort((a, b) => ord(a.sort_order) - ord(b.sort_order) || str(a.arrival_date).localeCompare(str(b.arrival_date))),
        items: await by<ItineraryRow>('itinerary_items'),
        reservations: await by<Reservation>('reservations'),
        packingCategories: (await by<PackingCategory>('packing_categories')).sort((a, b) => ord(a.sort_order) - ord(b.sort_order) || str(a.name).localeCompare(str(b.name))),
        packingItems: (await by<PackingItem>('packing_items')).sort((a, b) => str(a.created_at).localeCompare(str(b.created_at))),
        expenses: exps.sort((a, b) => str(b.expense_date).localeCompare(str(a.expense_date)) || str(b.created_at).localeCompare(str(a.created_at))),
        settlements: (await by<Settlement>('settlements')).sort((a, b) => str(b.created_at).localeCompare(str(a.created_at))),
        budgets: await by<BudgetRowDb>('budgets'),
        notes: (await by<Note>('notes')).sort((a, b) => str(b.created_at).localeCompare(str(a.created_at))),
        documents: (await by<DocumentRow>('documents')).sort((a, b) => str(b.created_at).localeCompare(str(a.created_at))),
      };
    });
  } catch (e) { throw friendly(e); }
}

// ───────── travelers (the people on a trip: names, not accounts) ─────────
export const travelers = {
  add: async (tripId: string, name: string) => {
    try {
      const n = name.trim();
      need(n.length > 0 && n.length <= 80, 'Enter a name (up to 80 characters).');
      await transaction(['trips', 'travelers'], 'readwrite', async (x) => {
        await requireTrip(x, tripId);
        const existing = await x.byTrip('travelers', tripId);
        need(!existing.some((t) => t.name.toLowerCase() === n.toLowerCase()), `${n} is already on this trip.`);
        await x.put('travelers', { id: uuid(), trip_id: tripId, name: n, is_me: existing.length === 0, sort_order: existing.length });
      });
    } catch (e) { throw friendly(e); }
  },
  rename: async (id: string, name: string) => {
    try {
      const n = name.trim();
      need(n.length > 0 && n.length <= 80, 'Enter a name (up to 80 characters).');
      await transaction(['travelers'], 'readwrite', async (x) => {
        const t = await x.get('travelers', id);
        need(t, 'That traveler no longer exists.');
        const others = await x.byTrip('travelers', t.trip_id);
        need(!others.some((o) => o.id !== id && o.name.toLowerCase() === n.toLowerCase()), `${n} is already on this trip.`);
        await x.put('travelers', { ...t, name: n });
      });
    } catch (e) { throw friendly(e); }
  },
  setMe: async (tripId: string, id: string) => {
    try {
      await transaction(['travelers'], 'readwrite', async (x) => {
        for (const t of await x.byTrip('travelers', tripId)) await x.put('travelers', { ...t, is_me: t.id === id });
      });
    } catch (e) { throw friendly(e); }
  },
  /** Blocked while the traveler appears in any expense or payment, so balances can never silently change. */
  remove: async (id: string) => {
    try {
      await transaction(ALL, 'readwrite', async (x) => {
        const t = await x.get('travelers', id);
        need(t, 'That traveler no longer exists.');
        const all = await x.byTrip('travelers', t.trip_id);
        need(all.length > 1, 'A trip needs at least one traveler.');
        const exps = await x.byTrip('expenses', t.trip_id);
        const inExpenses = exps.some((e) => e.paid_by === id || e.expense_splits.some((s: { user_id: string }) => s.user_id === id));
        const inPayments = (await x.byTrip('settlements', t.trip_id)).some((s) => s.from_user === id || s.to_user === id);
        need(!inExpenses && !inPayments, `${t.name} appears in expenses or payments. Delete those first, so nobody's balance changes by accident.`);
        for (const c of await x.byTrip('packing_categories', t.trip_id)) if (c.owner_id === id) await x.del('packing_categories', c.id);
        for (const p of await x.byTrip('packing_items', t.trip_id)) {
          if (p.owner_id === id) await x.del('packing_items', p.id);
          else if (p.assigned_to === id) await x.put('packing_items', { ...p, assigned_to: null });
        }
        await x.del('travelers', id);
        if (t.is_me) {
          const next = all.find((o) => o.id !== id)!;
          await x.put('travelers', { ...next, is_me: true });
        }
      });
    } catch (e) { throw friendly(e); }
  },
};

// ───────── generic trip-scoped rows ─────────
type RowTable = 'destinations' | 'itinerary_items' | 'reservations' | 'budgets' | 'notes' | 'packing_categories' | 'packing_items';
const DEFAULTS: Record<RowTable, Record<string, unknown>> = {
  destinations: { country: null, region: null, latitude: null, longitude: null, notes: null, arrival_date: null, departure_date: null, sort_order: 0 },
  itinerary_items: {
    destination_id: null, start_at: null, start_tz: null, end_at: null, end_tz: null, description: null, item_type: 'activity', location_name: null,
    address: null, latitude: null, longitude: null, notes: null, cost_cents: null, currency: null, confirmation_number: null, website: null, contact: null, sort_order: 0,
  },
  reservations: {
    itinerary_item_id: null, provider: null, confirmation_number: null, starts_at: null, starts_tz: null, ends_at: null, ends_tz: null,
    website: null, phone: null, address: null, details: {}, notes: null,
  },
  budgets: { category: null },
  notes: { target_id: null },
  packing_categories: { is_shared: true, owner_id: null, sort_order: 0 },
  packing_items: { quantity: 1, packed: false, assigned_to: null, notes: null, is_shared: true, owner_id: null },
};

async function validateRow(x: Tx, table: RowTable, r: Row): Promise<void> {
  const tid = r.trip_id as string;
  switch (table) {
    case 'destinations':
      need(textLen(r.name, 1, 200), 'Name is required');
      coords(r);
      need(!r.arrival_date || isValidIsoDate(r.arrival_date), 'Arrival date is not valid');
      need(!r.departure_date || isValidIsoDate(r.departure_date), 'Departure date is not valid');
      need(!r.arrival_date || !r.departure_date || r.departure_date >= r.arrival_date, 'Departure cannot be before arrival');
      break;
    case 'itinerary_items':
      need(textLen(r.title, 1, 200), 'Title is required');
      need(isValidIsoDate(r.local_date), 'Date is required');
      need(ITEM_TYPES.includes(r.item_type), 'Choose a valid type');
      need(!r.start_at || r.start_tz, 'A start time needs a time zone');
      need(!r.end_at || r.end_tz, 'An end time needs a time zone');
      need(!r.start_at || !r.end_at || Date.parse(r.end_at) >= Date.parse(r.start_at), 'The end must be after the start');
      need(r.cost_cents === null || isMinor(r.cost_cents), 'Cost must be zero or more');
      need(r.cost_cents === null || isCode(r.currency), 'Choose a currency for the cost');
      need(httpUrl(r.website), 'Website must start with http:// or https://');
      coords(r);
      if (r.destination_id) need((await x.get('destinations', r.destination_id))?.trip_id === tid, 'That destination is not on this trip');
      break;
    case 'reservations':
      need(['flight', 'hotel', 'restaurant', 'activity', 'car_rental', 'other'].includes(r.kind), 'Choose a valid type');
      need(textLen(r.title, 1, 200), 'Name is required');
      need(httpUrl(r.website), 'Website must start with http:// or https://');
      need(r.details && typeof r.details === 'object' && !Array.isArray(r.details), 'Invalid details');
      need(!r.starts_at || r.starts_tz, 'A start time needs a time zone');
      need(!r.ends_at || r.ends_tz, 'An end time needs a time zone');
      need(!r.starts_at || !r.ends_at || Date.parse(r.ends_at) >= Date.parse(r.starts_at), 'The end cannot be before the start');
      if (r.itinerary_item_id) need((await x.get('itinerary_items', r.itinerary_item_id))?.trip_id === tid, 'That itinerary item is not on this trip');
      break;
    case 'budgets':
      need(r.category === null || BUDGET_CATEGORIES.includes(r.category), 'Choose a valid budget category');
      need(isMinor(r.amount_cents), 'Budget must be zero or more');
      need(isCode(r.currency), 'Choose a valid currency');
      need(!(await x.byTrip('budgets', tid)).some((b) => b.id !== r.id && b.category === r.category), 'That budget already exists');
      break;
    case 'notes':
      need(['trip', 'destination', 'itinerary', 'reservation'].includes(r.scope), 'Choose what the note is about');
      need(textLen(r.body, 1, 10000), 'Write something in the note');
      need((r.scope === 'trip') === (r.target_id === null), 'Choose which item the note is about');
      if (r.target_id) {
        const store: Table = r.scope === 'destination' ? 'destinations' : r.scope === 'itinerary' ? 'itinerary_items' : 'reservations';
        need((await x.get(store, r.target_id))?.trip_id === tid, 'That item is not on this trip');
      }
      break;
    case 'packing_categories':
      need(textLen(r.name, 1, 100), 'Category name is required');
      need(r.is_shared ? r.owner_id === null : typeof r.owner_id === 'string', 'Invalid list');
      if (r.owner_id) need((await travelerIds(x, tid)).has(r.owner_id), 'That traveler is not on this trip');
      break;
    case 'packing_items': {
      need(textLen(r.name, 1, 200), 'Item name is required');
      need(Number.isInteger(r.quantity) && r.quantity >= 1 && r.quantity <= 999, 'Quantity must be 1 to 999');
      const cat = await x.get('packing_categories', r.category_id);
      need(cat && cat.trip_id === tid && cat.is_shared === r.is_shared && (cat.owner_id ?? null) === (r.owner_id ?? null), 'The item must be in a category of the same list');
      if (r.assigned_to) need((await travelerIds(x, tid)).has(r.assigned_to), 'That traveler is not on this trip');
      break;
    }
  }
}

export const rows = {
  insert: async <T = unknown>(table: RowTable, row: Record<string, unknown>): Promise<T> => {
    try {
      return await transaction(ALL, 'readwrite', async (x) => {
        await requireTrip(x, row.trip_id);
        const r: Row = { ...DEFAULTS[table], ...clean(row), id: uuid(), created_at: nowIso() } as Row;
        await validateRow(x, table, r);
        await x.put(table, r);
        return r as unknown as T;
      });
    } catch (e) { throw friendly(e); }
  },
  update: async (table: RowTable, id: string, patch: Record<string, unknown>) => {
    try {
      await transaction(ALL, 'readwrite', async (x) => {
        const cur = await x.get(table, id);
        need(cur, 'That item no longer exists.');
        const { trip_id: _ignored, id: _id, ...safe } = patch; // rows can never move to another trip
        void _ignored; void _id;
        const next = { ...cur, ...clean(safe), updated_at: nowIso() } as Row;
        await validateRow(x, table, next);
        await x.put(table, next);
      });
    } catch (e) { throw friendly(e); }
  },
  remove: async (table: RowTable, id: string) => {
    try {
      await transaction([...ALL, 'blobs'], 'readwrite', async (x) => {
        const cur = await x.get(table, id);
        if (!cur) return;
        const tid = cur.trip_id as string;
        const unlink = async (t: Table, field: string) => {
          for (const r of await x.byTrip(t, tid)) if (r[field] === id) await x.put(t, { ...r, [field]: null });
        };
        if (table === 'destinations') await unlink('itinerary_items', 'destination_id');
        if (table === 'itinerary_items') {
          await unlink('reservations', 'itinerary_item_id');
          await unlink('expenses', 'itinerary_item_id');
          await unlink('documents', 'itinerary_item_id');
        }
        if (table === 'reservations') await unlink('documents', 'reservation_id');
        if (table === 'packing_categories') for (const p of await x.byTrip('packing_items', tid)) if (p.category_id === id) await x.del('packing_items', p.id);
        await x.del(table, id);
      });
    } catch (e) { throw friendly(e); }
  },
};

// ───────── packing ─────────
export const packing = {
  /** Create categories and items from a template, on the shared list or on one traveler's personal list. */
  applyTemplate: async (tripId: string, tpl: PackingTemplate, shared: boolean, ownerId: string) => {
    try {
      await transaction(ALL, 'readwrite', async (x) => {
        await requireTrip(x, tripId);
        need(shared || (await travelerIds(x, tripId)).has(ownerId), 'Choose whose list this is.');
        const base = (await x.byTrip('packing_categories', tripId)).length;
        for (const [ci, cat] of expandTemplate(tpl).entries()) {
          const cid = uuid();
          const owner = shared ? null : ownerId;
          await x.put('packing_categories', { id: cid, trip_id: tripId, name: cat.name, is_shared: shared, owner_id: owner, sort_order: base + ci });
          for (const i of cat.items) {
            await x.put('packing_items', { id: uuid(), trip_id: tripId, category_id: cid, name: i.name, quantity: i.quantity, packed: false, assigned_to: null, notes: null, is_shared: shared, owner_id: owner, created_at: nowIso() });
          }
        }
      });
    } catch (e) { throw friendly(e); }
  },
  toggle: (id: string, packed: boolean) => rows.update('packing_items', id, { packed }),
};

// ───────── expenses & payments ─────────
export interface ExpenseInput {
  paid_by: string;
  description: string;
  amount_cents: number;
  currency: string;
  expense_date: string;
  category: string;
  notes: string;
  itinerary_item_id: string;
  split_method: SplitMethod;
}
const SPLIT_METHODS = ['equal', 'custom', 'percent', 'shares'];

export const expenses = {
  /** Create (expenseId = null) or replace an expense and its splits atomically. Splits must add up to the total. */
  save: async (tripId: string, expenseId: string | null, e: ExpenseInput, splits: { user_id: string; amount_cents: number; share_value: number | null }[]) => {
    try {
      return await transaction(ALL, 'readwrite', async (x) => {
        await requireTrip(x, tripId);
        const people = await travelerIds(x, tripId);
        need(textLen(e.description, 1, 200), 'Description is required');
        need(isMinor(e.amount_cents, 1), 'Amount must be greater than zero');
        need(isCode(e.currency), 'Choose a valid currency');
        need(isValidIsoDate(e.expense_date), 'Choose a valid date');
        need(EXPENSE_CATEGORIES.includes(e.category as never), 'Choose a valid category');
        need(SPLIT_METHODS.includes(e.split_method), 'Choose how to split this expense');
        need(people.has(e.paid_by), 'The payer must be a traveler on this trip');
        need(splits.length > 0, 'An expense needs at least one person to split with');
        need(new Set(splits.map((s) => s.user_id)).size === splits.length, 'A person appears twice in the split');
        for (const s of splits) {
          need(people.has(s.user_id), 'Everyone in the split must be a traveler on this trip');
          need(isMinor(s.amount_cents), 'Split amounts cannot be negative');
        }
        const sum = splits.reduce((a, s) => a + s.amount_cents, 0);
        need(sum === e.amount_cents, `Splits (${sum}) must add up to the expense total (${e.amount_cents})`);
        if (e.itinerary_item_id) need((await x.get('itinerary_items', e.itinerary_item_id))?.trip_id === tripId, 'That itinerary item is not on this trip');
        const prev = expenseId ? await x.get('expenses', expenseId) : undefined;
        need(!expenseId || (prev && prev.trip_id === tripId), 'That expense no longer exists.');
        const row: Row = {
          id: expenseId ?? uuid(), trip_id: tripId, paid_by: e.paid_by, description: e.description.trim(), amount_cents: e.amount_cents,
          currency: e.currency, expense_date: e.expense_date, category: e.category, notes: e.notes.trim() || null,
          itinerary_item_id: e.itinerary_item_id || null, split_method: e.split_method, created_at: prev?.created_at ?? nowIso(),
          expense_splits: splits.map((s) => ({ user_id: s.user_id, amount_cents: s.amount_cents, share_value: s.share_value })),
        };
        await x.put('expenses', row);
        return row.id as string;
      });
    } catch (err) { throw friendly(err); }
  },
  remove: async (id: string) => {
    try { await transaction(['expenses'], 'readwrite', (x) => x.del('expenses', id)); } catch (e) { throw friendly(e); }
  },
  /** Record that a debt was paid. This is a ledger entry only; no money moves. */
  settle: async (tripId: string, from: string, to: string, amountCents: number, currency: string, date: string, note: string) => {
    try {
      return await transaction(ALL, 'readwrite', async (x) => {
        await requireTrip(x, tripId);
        const people = await travelerIds(x, tripId);
        need(people.has(from) && people.has(to), 'Both people must be travelers on this trip');
        need(from !== to, 'Choose two different people');
        need(isMinor(amountCents, 1), 'Amount must be greater than zero');
        need(isCode(currency), 'Choose a valid currency');
        need(isValidIsoDate(date), 'Choose a valid date');
        const row: Row = { id: uuid(), trip_id: tripId, from_user: from, to_user: to, amount_cents: amountCents, currency, settled_on: date, note: note.trim() || null, created_at: nowIso() };
        await x.put('settlements', row);
        return row.id as string;
      });
    } catch (e) { throw friendly(e); }
  },
  removeSettlement: async (id: string) => {
    try { await transaction(['settlements'], 'readwrite', (x) => x.del('settlements', id)); } catch (e) { throw friendly(e); }
  },
};

// ───────── documents (files are stored on this device) ─────────
export const ALLOWED_DOC_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'text/plain'];
export const MAX_DOC_BYTES = 10 * 1024 * 1024;

export const documents = {
  upload: async (tripId: string, file: File, link: { itinerary_item_id?: string; reservation_id?: string }): Promise<DocumentRow> => {
    try {
      need(ALLOWED_DOC_TYPES.includes(file.type), 'Use a PDF, image (PNG, JPG, WebP, HEIC) or text file.');
      need(file.size > 0 && file.size <= MAX_DOC_BYTES, 'Files must be 10 MB or smaller.');
      const safe = file.name.replace(/[^\w.\- ()]+/g, '_').slice(0, 120) || 'document';
      return await transaction([...ALL, 'blobs'], 'readwrite', async (x) => {
        await requireTrip(x, tripId);
        if (link.itinerary_item_id) need((await x.get('itinerary_items', link.itinerary_item_id))?.trip_id === tripId, 'That itinerary item is not on this trip');
        if (link.reservation_id) need((await x.get('reservations', link.reservation_id))?.trip_id === tripId, 'That reservation is not on this trip');
        const row: DocumentRow = { id: uuid(), trip_id: tripId, itinerary_item_id: link.itinerary_item_id ?? null, reservation_id: link.reservation_id ?? null, file_name: safe, mime_type: file.type, size_bytes: file.size, created_at: nowIso() };
        await x.blobPut(row.id, file);
        await x.put('documents', row as unknown as Row);
        return row;
      });
    } catch (e) { throw friendly(e); }
  },
  /** A temporary link to the stored file (valid until the page closes). */
  openUrl: async (id: string): Promise<string> => {
    try {
      const blob = await transaction(['blobs'], 'readonly', (x) => x.blobGet(id));
      need(blob, 'That file is missing from this device.');
      return URL.createObjectURL(blob);
    } catch (e) { throw friendly(e); }
  },
  remove: async (doc: DocumentRow) => {
    try {
      await transaction(['documents', 'blobs'], 'readwrite', async (x) => { await x.blobDel(doc.id); await x.del('documents', doc.id); });
    } catch (e) { throw friendly(e); }
  },
};
