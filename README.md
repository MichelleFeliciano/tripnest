# TripNest

A collaborative trip planner: itinerary, reservations, packing, shared expenses with fair splitting, budgets, notes, private documents, maps and calendar export, all in one place and built mobile-first.

**Workflow:** Create trip â†’ invite travelers â†’ build itinerary â†’ add reservations â†’ pack â†’ track shared expenses â†’ split costs â†’ complete the trip.

## Features
- **Accounts**: sign up, log in/out, password reset, profile. Self-service account deletion with a clear preview of what is removed and what is kept. People see only trips they own or were invited to.
- **Trips**: dates validated (days/nights calculated), status (Planning/Upcoming/In Progress/Completed/Archived), destinations, notes, dashboard with today's plan, next item, expenses, packing progress and quick actions.
- **Itinerary** with times in the **local time zone of each place** (a flight can leave Chicago and land in Puerto Rico). Timeline, month calendar, week and day views, schedule-conflict warnings.
- **Reservations & travel details**: flights, hotels, restaurants, activities, rental cars, contacts. Flexible fields and a quick-access page of confirmation numbers.
- **Packing**: shared and personal lists, categories, quantities, assignees, "12 / 20 packed (60%)", five editable templates.
- **Expenses**: equal / custom / percentage / shares splits that always add up exactly, who-owes-whom, simplified settlement plan, partial payments recorded in an append-only ledger, multi-currency (never silently converted).
- **Budgets**: total and per category, under/near/over with gentle wording.
- **Collaboration**: Owner / Editor / Viewer roles, expiring single-use invitation links.
- **Documents** in private storage via 60-second signed links.
- **Explore**: find sights, museums, food, beaches and activities near each destination (OpenStreetMap data, no API key; looked up only when you press Search, results cached on-device for 24 h) and add any place to a chosen day with one click.
- **Map** (OpenStreetMap, optional, with a list fallback), **search**, **printable booklet / PDF**, **.ics calendar export**.
- **Optional AI** (itinerary ideas, packing suggestions, summary) that only runs when you click, never edits anything without confirmation, and is never used for calculations.

## Stack
React 18 + TypeScript + Vite (plain CSS) Â· Supabase (Postgres, Auth, Storage, RLS, Edge Function) Â· Leaflet/OpenStreetMap Â· Vitest. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Local development
```bash
npm install
cp .env.example .env     # fill in your Supabase URL + anon key
npm run dev              # http://localhost:5173
```
You need a Supabase project (free) with the migrations applied. See *Database setup*.

## Environment variables
| Variable | Where | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | browser | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | browser | Public anon key (safe because of RLS) |
| `VITE_AI_ENABLED` | browser | `true` shows the AI assistant |
| `ANTHROPIC_API_KEY`, `AI_MODEL` | **edge function secrets only** | Optional AI |

Never commit `.env`; only `.env.example` is tracked.

## Database setup
Run `supabase/migrations/0001_schema.sql`, `0002_security.sql`, `0003_storage.sql`, `0004_delete_account.sql` in order (or paste `supabase/setup-all.sql`), enable email confirmation and set redirect URLs. Details: [docs/DATABASE.md](docs/DATABASE.md), [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Testing
```bash
npm test          # unit + database-security tests
npm run build     # typecheck + production build
```
Tests cover trips/date validation, roles, time zones, itinerary ordering/conflicts, packing, budgets, search, every split method and rounding, balances, settlements, ICS output, and ~50 row-level-security assertions against the real migrations in an in-process Postgres (PGlite). See [docs/QA_REPORT.md](docs/QA_REPORT.md) for what was and wasn't verified.

## Deployment
Live at https://michellefeliciano.github.io/tripnest/ (GitHub Pages, deployed by Actions on every push to main; the tests must pass first). Works on phones and can be added to the home screen. Any static host also works. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Docs
[Architecture](docs/ARCHITECTURE.md) Â· [Database](docs/DATABASE.md) Â· [Expense logic](docs/EXPENSE_LOGIC.md) Â· [Security](docs/SECURITY.md) Â· [API](docs/API.md) Â· [Deployment](docs/DEPLOYMENT.md) Â· [QA report](docs/QA_REPORT.md)
