import { supabase } from './supabase';
import type {
  BudgetRowDb, Destination, DocumentRow, Expense, Invitation, ItineraryRow, Member, Note, PackingCategory,
  PackingItem, Profile, Reservation, Settlement, Trip, TripData,
} from './types';
import type { Role } from '../lib/permissions';
import type { SplitMethod } from '../lib/splits';
import { expandTemplate, type PackingTemplate } from '../lib/packing';
import { appUrl } from '../lib/appUrl';

export class ApiError extends Error {
  constructor(message: string, readonly offline = false) {
    super(message);
  }
}

interface PgErr { message?: string; code?: string; details?: string }

/** Turn low-level errors into messages a traveler can act on. */
export function friendly(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  const err = (e ?? {}) as PgErr;
  const msg = err.message ?? String(e);
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
    return new ApiError("Can't reach the server. Check your connection. Your entries are kept so you can try again.", true);
  }
  if (err.code === '42501' || /row-level security|permission denied|not allowed/i.test(msg)) {
    return new ApiError("You don't have permission to do that.");
  }
  if (err.code === '23505' || /duplicate key|already/i.test(msg)) return new ApiError(/already/i.test(msg) ? msg : 'That already exists.');
  if (err.code === '23514') return new ApiError(msg.replace(/^new row for relation.*violates check constraint.*/i, 'One of the values is not allowed.'));
  if (/invitation not found/i.test(msg)) return new ApiError('This invitation was not found for your account. Sign in with the email address it was sent to.');
  return new ApiError(msg || 'Something went wrong. Please try again.');
}

async function run<T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  let res;
  try {
    res = await p;
  } catch (e) {
    throw friendly(e);
  }
  if (res.error) throw friendly(res.error);
  return res.data as T;
}

/** Empty strings become null so optional columns stay clean. */
export function clean<T extends Record<string, unknown>>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) out[k] = typeof v === 'string' && v.trim() === '' ? null : typeof v === 'string' ? v.trim() : v;
  return out as T;
}

// ───────── auth & profile ─────────
export const auth = {
  signUp: async (email: string, password: string, displayName: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { display_name: displayName }, emailRedirectTo: appUrl() } });
    if (error) throw friendly(error);
    return data;
  },
  signIn: async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw friendly(error);
  },
  signOut: async () => {
    clearCaches();
    await supabase.auth.signOut();
  },
  resetPassword: async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: appUrl('reset-password') });
    if (error) throw friendly(error);
  },
  updatePassword: async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw friendly(error);
  },
};

export const profiles = {
  get: (id: string) => run<Profile>(supabase.from('profiles').select('*').eq('id', id).single()),
  update: (id: string, patch: Partial<Pick<Profile, 'display_name' | 'avatar_url' | 'home_timezone'>>) =>
    run(supabase.from('profiles').update(clean(patch)).eq('id', id)),
};

// ───────── trips ─────────
export const trips = {
  list: () => run<Trip[]>(supabase.from('trips').select('*').order('start_date', { ascending: false })),
  create: async (t: Partial<Trip> & { name: string; start_date: string; end_date: string }, ownerId: string, extraDestinations: string[]) => {
    const row = await run<Trip>(supabase.from('trips').insert({ ...clean(t), owner_id: ownerId }).select().single());
    const names = [t.primary_destination, ...extraDestinations].map((s) => (s ?? '').trim()).filter(Boolean);
    if (names.length) {
      await run(supabase.from('destinations').insert(names.map((name, i) => ({ trip_id: row.id, name, sort_order: i }))));
    }
    return row;
  },
  update: (id: string, patch: Partial<Trip>) => run(supabase.from('trips').update(clean(patch)).eq('id', id)),
  /** Deletes the trip and its uploaded files (rows cascade in the database, but storage files do not). */
  remove: async (id: string) => {
    const docs = await run<{ storage_path: string }[]>(supabase.from('documents').select('storage_path').eq('trip_id', id));
    for (let i = 0; i < docs.length; i += 100) {
      const { error } = await supabase.storage.from('trip-documents').remove(docs.slice(i, i + 100).map((d) => d.storage_path));
      if (error) throw friendly(error); // stop before deleting the trip so nothing is orphaned
    }
    await run(supabase.from('trips').delete().eq('id', id));
  },
};

// ───────── trip bundle (single load; also cached for poor connections) ─────────
const cacheKey = (id: string) => `tripnest:trip:${id}`;
export function clearCaches() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith('tripnest:')).forEach((k) => localStorage.removeItem(k));
  } catch { /* storage unavailable */ }
}
function readCache(id: string): TripData | null {
  try {
    const raw = localStorage.getItem(cacheKey(id));
    return raw ? ({ ...(JSON.parse(raw) as TripData), fromCache: true }) : null;
  } catch {
    return null;
  }
}

export async function loadTrip(id: string, userId: string): Promise<TripData> {
  try {
    const [trip, members, invitations, destinations, items, reservations, packingCategories, packingItems, expenses, settlements, budgets, notes, documents] =
      await Promise.all([
        run<Trip>(supabase.from('trips').select('*').eq('id', id).single()),
        run<Member[]>(supabase.from('trip_members').select('*').eq('trip_id', id)),
        supabase.from('trip_invitations').select('id,trip_id,email,role,status,expires_at,created_at').eq('trip_id', id).order('created_at', { ascending: false }).then((r) => (r.data ?? []) as Invitation[]),
        run<Destination[]>(supabase.from('destinations').select('*').eq('trip_id', id).order('sort_order').order('arrival_date')),
        run<ItineraryRow[]>(supabase.from('itinerary_items').select('*').eq('trip_id', id)),
        run<Reservation[]>(supabase.from('reservations').select('*').eq('trip_id', id)),
        run<PackingCategory[]>(supabase.from('packing_categories').select('*').eq('trip_id', id).order('sort_order').order('name')),
        run<PackingItem[]>(supabase.from('packing_items').select('*').eq('trip_id', id).order('created_at')),
        run<Expense[]>(supabase.from('expenses').select('*, expense_splits(user_id, amount_cents, share_value)').eq('trip_id', id).order('expense_date', { ascending: false }).order('created_at', { ascending: false })),
        run<Settlement[]>(supabase.from('settlements').select('*').eq('trip_id', id).order('created_at', { ascending: false })),
        run<BudgetRowDb[]>(supabase.from('budgets').select('*').eq('trip_id', id)),
        run<Note[]>(supabase.from('notes').select('*').eq('trip_id', id).order('created_at', { ascending: false })),
        run<DocumentRow[]>(supabase.from('documents').select('*').eq('trip_id', id).order('created_at', { ascending: false })),
      ]);
    const profs = await run<Profile[]>(supabase.from('profiles').select('*').in('id', members.map((m) => m.user_id)));
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    const data: TripData = {
      trip,
      role: (members.find((m) => m.user_id === userId)?.role ?? 'viewer') as Role,
      members: members.map((m) => ({ ...m, profile: profs.find((p) => p.id === m.user_id) ?? null })),
      invitations,
      destinations: destinations.map((d) => ({ ...d, latitude: num(d.latitude), longitude: num(d.longitude) })),
      items: items.map((i) => ({ ...i, latitude: num(i.latitude), longitude: num(i.longitude), cost_cents: num(i.cost_cents) })),
      reservations,
      packingCategories,
      packingItems,
      expenses: expenses.map((e) => ({ ...e, amount_cents: Number(e.amount_cents), expense_splits: e.expense_splits.map((s) => ({ ...s, amount_cents: Number(s.amount_cents), share_value: num(s.share_value) })) })),
      settlements: settlements.map((s) => ({ ...s, amount_cents: Number(s.amount_cents) })),
      budgets: budgets.map((b) => ({ ...b, amount_cents: Number(b.amount_cents) })),
      notes,
      documents: documents.map((d) => ({ ...d, size_bytes: Number(d.size_bytes) })),
      loadedAt: Date.now(),
    };
    try { localStorage.setItem(cacheKey(id), JSON.stringify(data)); } catch { /* quota or private mode */ }
    return data;
  } catch (e) {
    const err = friendly(e);
    if (err.offline) {
      const cached = readCache(id);
      if (cached) return cached;
    }
    throw err;
  }
}

// ───────── generic trip-scoped CRUD ─────────
type Table = 'destinations' | 'itinerary_items' | 'reservations' | 'budgets' | 'notes' | 'packing_categories' | 'packing_items';
export const rows = {
  insert: <T = unknown>(table: Table, row: Record<string, unknown>) => run<T>(supabase.from(table).insert(clean(row)).select().single()),
  update: (table: Table, id: string, patch: Record<string, unknown>) => run(supabase.from(table).update(clean(patch)).eq('id', id)),
  remove: (table: Table, id: string) => run(supabase.from(table).delete().eq('id', id)),
};

export const packing = {
  /** Create a category and items from a template, shared or personal. */
  applyTemplate: async (tripId: string, tpl: PackingTemplate, shared: boolean, userId: string) => {
    const owner = shared ? null : userId;
    for (const cat of expandTemplate(tpl)) {
      const created = await run<PackingCategory>(
        supabase.from('packing_categories').insert({ trip_id: tripId, name: cat.name, is_shared: shared, owner_id: owner }).select().single(),
      );
      await run(supabase.from('packing_items').insert(cat.items.map((i) => ({ trip_id: tripId, category_id: created.id, name: i.name, quantity: i.quantity, is_shared: shared, owner_id: owner }))));
    }
  },
  toggle: (id: string, packed: boolean) => rows.update('packing_items', id, { packed }),
};

// ───────── members & invitations ─────────
export const members = {
  setRole: (tripId: string, userId: string, role: 'editor' | 'viewer') => run(supabase.from('trip_members').update({ role }).eq('trip_id', tripId).eq('user_id', userId)),
  remove: (tripId: string, userId: string) => run(supabase.from('trip_members').delete().eq('trip_id', tripId).eq('user_id', userId)),
  invite: (tripId: string, email: string, role: 'editor' | 'viewer') => run<string>(supabase.rpc('create_invitation', { p_trip: tripId, p_email: email, p_role: role })),
  revoke: (id: string) => run(supabase.from('trip_invitations').delete().eq('id', id)),
  preview: (token: string) => run<{ trip_name: string; role: string; status: string; expires_at: string }>(supabase.rpc('invitation_preview', { p_token: token })),
  accept: (token: string) => run<{ status: string; trip_id?: string }>(supabase.rpc('accept_invitation', { p_token: token })),
  decline: (token: string) => run<{ status: string }>(supabase.rpc('decline_invitation', { p_token: token })),
};

// ───────── expenses ─────────
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
export const expenses = {
  save: (tripId: string, expenseId: string | null, e: ExpenseInput, splits: { user_id: string; amount_cents: number; share_value: number | null }[]) =>
    run<string>(supabase.rpc('save_expense', { p_trip: tripId, p_expense_id: expenseId, p_data: e, p_splits: splits })),
  remove: (id: string) => run(supabase.from('expenses').delete().eq('id', id)),
  settle: (tripId: string, from: string, to: string, amountCents: number, currency: string, date: string, note: string) =>
    run<string>(supabase.rpc('record_settlement', { p_trip: tripId, p_from: from, p_to: to, p_amount: amountCents, p_currency: currency, p_date: date, p_note: note })),
};

// ───────── documents (private bucket + signed URLs) ─────────
export const ALLOWED_DOC_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'text/plain'];
export const MAX_DOC_BYTES = 10 * 1024 * 1024;

export const documents = {
  upload: async (tripId: string, file: File, link: { itinerary_item_id?: string; reservation_id?: string }, userId: string) => {
    if (!ALLOWED_DOC_TYPES.includes(file.type)) throw new ApiError('Use a PDF, image (PNG, JPG, WebP, HEIC) or text file.');
    if (file.size > MAX_DOC_BYTES) throw new ApiError('Files must be 10 MB or smaller.');
    const safe = file.name.replace(/[^\w.\- ]+/g, '_').slice(0, 120);
    const path = `${tripId}/${crypto.randomUUID()}-${safe}`;
    const up = await supabase.storage.from('trip-documents').upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) throw friendly(up.error);
    try {
      return await run<DocumentRow>(
        supabase.from('documents').insert({ trip_id: tripId, storage_path: path, file_name: safe, mime_type: file.type, size_bytes: file.size, uploaded_by: userId, ...clean(link) }).select().single(),
      );
    } catch (e) {
      await supabase.storage.from('trip-documents').remove([path]); // do not leave orphaned files
      throw e;
    }
  },
  /** Short-lived URL (60 s). Never persisted or shown as a permanent link. */
  signedUrl: async (path: string) => {
    const { data, error } = await supabase.storage.from('trip-documents').createSignedUrl(path, 60);
    if (error || !data) throw friendly(error ?? new Error('Could not open the file'));
    return data.signedUrl;
  },
  remove: async (doc: DocumentRow) => {
    await run(supabase.from('documents').delete().eq('id', doc.id));
    await supabase.storage.from('trip-documents').remove([doc.storage_path]);
  },
};

// ───────── account deletion ─────────
export interface AccountPreview {
  owned_with_others: { id: string; name: string; members: number }[];
  owned_solo: { id: string; name: string }[];
  shared_trips: number;
  shared_expenses: number;
}
export const account = {
  preview: () => run<AccountPreview>(supabase.rpc('account_deletion_preview')),
  /** Removes stored files of trips only you were on, then deletes the account. Irreversible. */
  remove: async (soloTripIds: string[]) => {
    if (soloTripIds.length) {
      const docs = await run<{ storage_path: string }[]>(supabase.from('documents').select('storage_path').in('trip_id', soloTripIds));
      for (let i = 0; i < docs.length; i += 100) {
        const { error } = await supabase.storage.from('trip-documents').remove(docs.slice(i, i + 100).map((d) => d.storage_path));
        if (error) throw friendly(error); // stop before deleting anything else
      }
    }
    await run(supabase.rpc('delete_my_account'));
    clearCaches();
    await supabase.auth.signOut({ scope: 'local' });
  },
};

// ───────── optional AI (explicit user action only) ─────────
export const ai = {
  ask: async (tripId: string, kind: 'itinerary' | 'packing' | 'summary', input: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke('ai-assist', { body: { tripId, kind, input } });
    if (error) throw friendly(error);
    return data as { result: unknown; cached: boolean };
  },
};
