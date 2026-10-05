# TripNest Architecture

## Goals
A collaborative trip planner that is mobile-first, cheap to run, and correct with money, time zones and permissions. Optional services (maps, AI, weather) must never block core use.

## Stack and why
| Layer | Choice | Reason |
|---|---|---|
| UI | React 18 + TypeScript + Vite, plain CSS | Small, fast, no CSS framework to maintain |
| Backend | Supabase (Postgres, Auth, Storage) | One managed service, free tier, RLS gives database-level authorization |
| Server logic | Postgres functions (RPC) | Cross-row invariants (expenses + splits, invitations) stay atomic. No extra server to host |
| Optional AI | Supabase Edge Function | The AI key never reaches the browser; called only on explicit click |
| Maps | Leaflet + OpenStreetMap tiles | No API key, free; lazy-loaded with a list fallback |
| Hosting | Any static host (Vercel/Netlify/Cloudflare Pages) + Supabase | |

There is deliberately **no custom Node server**: the browser talks to Supabase directly, and every table is protected by RLS. Pure business logic lives in `src/lib` (framework-free, unit tested).

## Layout
```
src/lib/        pure, deterministic logic: money, splits, balances, budget, time, itinerary, packing, ics, search, permissions
src/api/        thin Supabase data layer (typed), offline read cache
src/pages/      route components;  src/components/  shared UI;  src/hooks/  drafts, async helpers
supabase/migrations/   0001 schema · 0002 RLS + RPCs · 0003 private storage
supabase/functions/ai-assist/   optional AI endpoint
tests/          vitest: logic + real-Postgres (PGlite) security tests
```

## Collaboration & permissions model
Roles live in `trip_members(trip_id, user_id, role)`: `owner | editor | viewer`.
- Helper functions (`is_trip_member`, `can_edit_trip`, `is_trip_owner`) are `SECURITY DEFINER` and used by every RLS policy.
- Owner: everything, including trip edit/archive/delete and member management. Editor: itinerary, reservations, destinations, shared packing, expenses, settlements, budgets, notes, documents, invitations (viewer/editor only). Viewer: read-only, plus a private personal packing list.
- Ownership is never granted by invitation or role change; the owner row cannot be removed.
- The client mirrors the matrix in `src/lib/permissions.ts` to hide controls only. The database is authoritative.

### Invitations
Owner/editor calls `create_invitation(trip, email, role)` which returns a random 244-bit token **once**; only its SHA-256 is stored and the column is not readable by clients. The owner shares the link `/invite/<token>`. `accept_invitation` requires the signed-in account's verified email to equal the invited email, checks expiry (7 days) and status, and adds the membership. Unknown token and wrong-account produce the same error. Email confirmation must be enabled in Supabase Auth.

## Expense model
Integer minor units everywhere (`amount_cents`, exponent per currency). `save_expense` validates the role, payer and split people are members, and that splits sum exactly to the total, inside one transaction. A deferred constraint trigger re-checks this at commit, and direct writes to `expenses`/`expense_splits`/`settlements` are revoked. Settlements are an append-only ledger. Balances and the settlement plan are **derived** (never stored). Details: [EXPENSE_LOGIC.md](EXPENSE_LOGIC.md).

## Time-zone strategy
Each timed itinerary value is `(timestamptz instant, IANA zone of the place)`, plus `local_date` (calendar day at the place, used for grouping). Users type wall-clock time at the place; `zonedToUtc` converts using that zone (DST-aware); rendering always uses the stored zone, never the viewer's. A flight can therefore depart in `America/Chicago` and arrive in `America/Puerto_Rico`, and conflict detection compares instants. ICS export writes UTC instants plus local text in the description.

## Offline / poor connection (MVP)
Last-loaded trip data is cached in `localStorage` and shown with a "showing saved copy" banner if the network fails; forms keep drafts in `sessionStorage` so failed submissions are not lost; errors are friendly. A service worker / mutation queue is intentionally deferred: IDs are client-safe UUIDs and `updated_at` exists, so it can be added later.

## Optional integrations (not in the MVP critical path)
- **AI** (`ai-assist`): itinerary ideas, packing suggestions, summary. Explicit click only, JWT + membership verified, cheapest model, cached in `ai_cache`; suggestions require user confirmation. Conflict detection is deterministic and needs no AI.
- **Weather**: designed as a read-through, non-persistent fetch keyed by destination coordinates (e.g. Open-Meteo); never stored as current data. Not built.
- **Notifications**: future reminders would use a `reminders` table + scheduled function with opt-in. Not built.
- **Read-only share links**: `secure_share_tokens` (hash-only) is reserved.
- Future integrations (budget app, calendar, flights...) attach through stable UUIDs and the RPC surface.

## Security risks considered
Broken access control (RLS + tests), token leakage (hashed, hidden), IDOR via cross-trip foreign keys (composite FKs), financial tampering (RPC + constraints), file exposure (private bucket + signed URLs), XSS (React escaping, no `dangerouslySetInnerHTML`, URL scheme checks), abuse (invite limits, auth rate limits). See [SECURITY.md](SECURITY.md).

## Implementation plan
Milestones 1 to 12 as specified: foundation, trips/members, itinerary, reservations, packing, expenses, budgets, documents, maps, export, AI, final QA. Each ends with tests, a commit and a QA checkpoint.
