/**
 * A tiny fake of the Supabase endpoints TripNest uses, enough to render every screen with realistic data.
 * It ignores filters and permissions; it exists for UI/layout/accessibility checks only (security is
 * covered by the database tests).
 */
import type { Page, Route } from '@playwright/test';
import { zonedToUtc } from '../../src/lib/time';

export const ORIGIN = 'http://localhost:54321';
const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const TRIP = '33333333-3333-4333-8333-333333333333';
export const IDS = { ME, OTHER, TRIP };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const now = new Date();
const START = iso(addDays(now, -1)); // trip is "in progress" so Today/Next-up render
const END = iso(addDays(now, 6));
const D = (n: number) => iso(addDays(now, n - 1)); // trip day n (1-based)
const at = (day: number, time: string, tz: string) => zonedToUtc(D(day), time, tz).toISOString();
let seq = 0;
const id = () => `aaaaaaaa-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

function item(day: number, title: string, type: string, o: Record<string, unknown> = {}) {
  return {
    id: id(), trip_id: TRIP, destination_id: null, local_date: D(day), start_at: null, start_tz: null, end_at: null, end_tz: null, title,
    description: null, item_type: type, location_name: null, address: null, latitude: null, longitude: null, notes: null, cost_cents: null,
    currency: null, confirmation_number: null, website: null, contact: null, sort_order: 0, ...o,
  };
}
const PR = 'America/Puerto_Rico';
const items = [
  item(1, 'Flight to San Juan', 'flight', { start_at: at(1, '08:00', 'America/Chicago'), start_tz: 'America/Chicago', end_at: at(1, '13:30', PR), end_tz: PR, confirmation_number: 'XK92LM', location_name: 'Austin-Bergstrom (AUS)', description: 'Seat 14A, terminal B, gate 7. Arrive two hours early.' }),
  item(1, 'Hotel check-in', 'hotel', { start_at: at(1, '15:00', PR), start_tz: PR, location_name: 'Hotel El Convento, Old San Juan', address: '100 Calle del Cristo, San Juan', confirmation_number: 'HC-5521', website: 'https://example.com/hotel', latitude: 18.4663, longitude: -66.1167 }),
  item(1, 'Dinner at La Factoria', 'restaurant', { start_at: at(1, '19:30', PR), start_tz: PR, end_at: at(1, '21:00', PR), end_tz: PR, location_name: 'La Factoria', cost_cents: 14500, currency: 'USD', latitude: 18.4655, longitude: -66.1057 }),
  item(2, 'Beach day at Condado', 'activity', { latitude: 18.4573, longitude: -66.0759, location_name: 'Condado Beach' }),
  item(2, 'Museo de Arte de Puerto Rico', 'activity', { start_at: at(2, '10:00', PR), start_tz: PR, end_at: at(2, '12:00', PR), end_tz: PR }),
  item(2, 'Lunch at the market', 'restaurant', { start_at: at(2, '11:30', PR), start_tz: PR, end_at: at(2, '13:00', PR), end_tz: PR }), // overlaps the museum
  item(3, 'Drive to Ponce', 'transportation', { start_at: at(3, '09:00', PR), start_tz: PR, end_at: at(3, '11:00', PR), end_tz: PR }),
  item(3, 'Free time on the plaza', 'free_time', { start_at: at(3, '14:00', PR), start_tz: PR }),
  item(5, 'Snorkeling tour with a very long name that should wrap nicely on a narrow phone screen', 'activity', { start_at: at(5, '09:00', PR), start_tz: PR, contact: '+1 787 555 0100', website: 'https://example.com/tour' }),
];

const reservations = [
  { id: id(), trip_id: TRIP, itinerary_item_id: null, kind: 'flight', title: 'AUS to SJU', provider: 'Southwest', confirmation_number: 'XK92LM', starts_at: at(1, '08:00', 'America/Chicago'), starts_tz: 'America/Chicago', ends_at: at(1, '13:30', PR), ends_tz: PR, website: null, phone: '+1 800 555 0111', address: null, details: { airline: 'Southwest', flight_number: 'WN 1234', seat: '14A', terminal: 'B', gate: '7' }, notes: null },
  { id: id(), trip_id: TRIP, itinerary_item_id: null, kind: 'hotel', title: 'Hotel El Convento', provider: null, confirmation_number: 'HC-5521', starts_at: at(1, '15:00', PR), starts_tz: PR, ends_at: at(8, '11:00', PR), ends_tz: PR, website: 'https://example.com/hotel', phone: '+1 787 555 0199', address: '100 Calle del Cristo, San Juan', details: { room: 'Courtyard king', check_in_instructions: 'Ask at the front desk for the rooftop key.' }, notes: 'Late check-in approved.' },
  { id: id(), trip_id: TRIP, itinerary_item_id: null, kind: 'other', title: 'Emergency contact: Mom', provider: null, confirmation_number: null, starts_at: null, starts_tz: null, ends_at: null, ends_tz: null, website: null, phone: '+1 512 555 0123', address: null, details: {}, notes: null },
];

const catShared = id(), catClothes = id(), catMine = id();
const packingCategories = [
  { id: catShared, trip_id: TRIP, name: 'Beach Gear', is_shared: true, owner_id: null, sort_order: 0 },
  { id: catClothes, trip_id: TRIP, name: 'Clothing', is_shared: true, owner_id: null, sort_order: 1 },
  { id: catMine, trip_id: TRIP, name: 'My toiletries', is_shared: false, owner_id: ME, sort_order: 0 },
];
const pk = (cat: string, name: string, packed: boolean, shared = true, extra: Record<string, unknown> = {}) => ({ id: id(), trip_id: TRIP, category_id: cat, name, quantity: 1, packed, assigned_to: null, notes: null, is_shared: shared, owner_id: shared ? null : ME, ...extra });
const packingItems = [
  pk(catShared, 'Sunscreen', true), pk(catShared, 'Beach towels', false, true, { quantity: 4, assigned_to: OTHER }), pk(catShared, 'Cooler', false),
  pk(catClothes, 'Swimsuits', true, true, { quantity: 2 }), pk(catClothes, 'Sandals', false),
  pk(catMine, 'Toothbrush', false, false), pk(catMine, 'Medications', true, false),
];

const split = (e: string, a: number, b: number) => [{ user_id: ME, amount_cents: a, share_value: null }, { user_id: OTHER, amount_cents: b, share_value: null }].map((s) => ({ ...s, expense_id: e }));
const expense = (desc: string, paid: string, cents: number, cur: string, cat: string, a: number, b: number) => {
  const eid = id();
  return { id: eid, trip_id: TRIP, created_by: paid, paid_by: paid, description: desc, amount_cents: cents, currency: cur, expense_date: D(1), category: cat, notes: null, itinerary_item_id: null, split_method: 'equal', expense_splits: split(eid, a, b) };
};
const expenses = [
  expense('Welcome dinner', ME, 14500, 'USD', 'Food', 7250, 7250),
  expense('Rental car for the whole week including insurance', OTHER, 32001, 'USD', 'Transportation', 16000, 16001),
  expense('Gelato in the old town', OTHER, 1800, 'EUR', 'Food', 900, 900),
];

const state = {
  trips: [{ id: TRIP, owner_id: ME, name: 'Puerto Rico Vacation', description: 'A week of beaches, food and history.', start_date: START, end_date: END, cover_image_url: null, primary_destination: 'San Juan', status: 'in_progress', notes: 'Bring cash for tips.', default_currency: 'USD', budget_near_pct: 80 }],
  profiles: [
    { id: ME, email: 'me@example.com', display_name: 'Michelle', avatar_url: null, home_timezone: 'America/Chicago' },
    { id: OTHER, email: 'jon@example.com', display_name: 'Jon', avatar_url: null, home_timezone: 'America/Chicago' },
  ],
  trip_members: [{ trip_id: TRIP, user_id: ME, role: 'owner' }, { trip_id: TRIP, user_id: OTHER, role: 'editor' }],
  trip_invitations: [{ id: id(), trip_id: TRIP, email: 'friend@example.com', role: 'viewer', status: 'pending', expires_at: new Date(Date.now() + 5 * 86_400_000).toISOString(), created_at: new Date().toISOString() }],
  destinations: [
    { id: id(), trip_id: TRIP, name: 'San Juan', country: 'Puerto Rico', region: null, latitude: 18.4655, longitude: -66.1057, notes: 'Old town for the first days', arrival_date: D(1), departure_date: D(3), sort_order: 0 },
    { id: id(), trip_id: TRIP, name: 'Ponce', country: 'Puerto Rico', region: null, latitude: null, longitude: null, notes: null, arrival_date: D(3), departure_date: D(8), sort_order: 1 },
  ],
  itinerary_items: items,
  reservations,
  packing_categories: packingCategories,
  packing_items: packingItems,
  expenses,
  settlements: [{ id: id(), trip_id: TRIP, from_user: OTHER, to_user: ME, amount_cents: 2000, currency: 'USD', settled_on: D(2), note: 'Venmo', created_at: new Date().toISOString() }],
  budgets: [
    { id: id(), trip_id: TRIP, category: null, amount_cents: 200000, currency: 'USD' },
    { id: id(), trip_id: TRIP, category: 'Food', amount_cents: 15000, currency: 'USD' },
    { id: id(), trip_id: TRIP, category: 'Transportation', amount_cents: 30000, currency: 'USD' },
  ],
  notes: [
    { id: id(), trip_id: TRIP, scope: 'trip', target_id: null, body: 'Book the snorkeling tour at least a day ahead.', created_by: ME, created_at: new Date().toISOString() },
    { id: id(), trip_id: TRIP, scope: 'itinerary', target_id: items[0].id, body: 'Ask for a window seat.', created_by: OTHER, created_at: new Date().toISOString() },
  ],
  documents: [{ id: id(), trip_id: TRIP, itinerary_item_id: null, reservation_id: null, storage_path: `${TRIP}/x-hotel.pdf`, file_name: 'hotel-confirmation.pdf', mime_type: 'application/pdf', size_bytes: 83_000, uploaded_by: ME, created_at: new Date().toISOString() }],
} as Record<string, Record<string, unknown>[]>;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, accept, prefer, x-client-info, accept-profile, content-profile, x-supabase-api-version',
  'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
};
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
export function fakeSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600 * 24;
  const user = { id: ME, aud: 'authenticated', role: 'authenticated', email: 'me@example.com', app_metadata: {}, user_metadata: { display_name: 'Michelle' }, created_at: new Date().toISOString() };
  const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: ME, exp, role: 'authenticated', email: 'me@example.com' })}.sig`;
  return { access_token: token, refresh_token: 'fake-refresh', token_type: 'bearer', expires_in: 86400, expires_at: exp, user };
}

/** Installs the fake backend and a signed-in session. Calls to a real *.supabase.co host are recorded as violations. */
export async function installMock(page: Page, opts: { signedIn?: boolean } = {}): Promise<{ realHostCalls: string[]; apiErrors: string[] }> {
  const realHostCalls: string[] = [];
  const apiErrors: string[] = [];
  await page.route(/https?:\/\/[^/]*supabase\.(co|in)\//, (r) => { realHostCalls.push(r.request().url()); return r.abort(); });
  if (opts.signedIn !== false) {
    await page.addInitScript((s) => localStorage.setItem('sb-localhost-auth-token', JSON.stringify(s)), fakeSession());
  }
  await page.route(`${ORIGIN}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const p = url.pathname;
    if (p === '/auth/v1/user') return json(route, fakeSession().user);
    if (p.startsWith('/auth/v1/')) return json(route, fakeSession());
    if (p.startsWith('/rest/v1/rpc/')) {
      if (p.endsWith('account_deletion_preview')) return json(route, { owned_with_others: [], owned_solo: [{ id: TRIP, name: 'Puerto Rico Vacation' }], shared_trips: 1, shared_expenses: 3 });
      return json(route, {});
    }
    if (p.startsWith('/rest/v1/')) {
      const table = p.replace('/rest/v1/', '');
      const rows = state[table];
      if (!rows) { apiErrors.push(`unknown table ${table}`); return json(route, [], 200); }
      if (req.method() !== 'GET') return json(route, rows[0] ?? {}, req.method() === 'POST' ? 201 : 200);
      let out = rows;
      const idEq = url.searchParams.get('id')?.replace('eq.', '');
      if (idEq && !idEq.startsWith('in.') && (table === 'profiles' || table === 'trips')) out = rows.filter((r) => r.id === idEq);
      if ((req.headers()['accept'] ?? '').includes('pgrst.object')) return json(route, out[0] ?? {});
      return json(route, out);
    }
    if (p.startsWith('/storage/v1/')) return json(route, { signedURL: '/object/sign/x?token=t' });
    apiErrors.push(`unhandled ${req.method()} ${p}`);
    return json(route, {}, 404);
  });
  return { realHostCalls, apiErrors };
}
