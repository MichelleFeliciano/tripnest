# Database

PostgreSQL (Supabase). Migrations live in `supabase/migrations/` and are applied in order. They are exercised by `tests/rls.test.ts` against an in-process Postgres.

| Table | Purpose |
|---|---|
| `auth.users` (Supabase) | The "users" table: credentials and verified email |
| `profiles` | Display name, email copy, home time zone; auto-created by trigger. Visible to the owner and to people sharing a trip |
| `trips` | Name, dates (`end_date >= start_date`, max 366 days), status, default currency, `budget_near_pct` |
| `trip_members` | `(trip_id, user_id, role)` role in owner/editor/viewer; exactly one owner per trip (partial unique index) |
| `trip_invitations` | email, role, **`token_hash`** (SHA-256, hidden from clients), status, `expires_at` (7 days) |
| `destinations` | Name, country, region, coordinates (both or neither), arrival/departure dates, notes |
| `itinerary_items` | One row per plan item. `start_at/end_at timestamptz` + `start_tz/end_tz` IANA zones, `local_date` for grouping, type, location, cost (minor units), confirmation, website, contact |
| `reservations` | Typed bookings (`flight/hotel/restaurant/activity/car_rental/other`), optional link to an itinerary item, flexible `details jsonb` |
| `packing_categories`, `packing_items` | Shared lists (`is_shared`) or personal (`owner_id`), quantity, packed, assignee, notes |
| `expenses`, `expense_splits` | Expense header (integer `amount_cents`, `currency`, payer, category, method) and per-person amounts |
| `settlements` | Append-only ledger of recorded payments |
| `budgets` | One row per (trip, category); `category IS NULL` is the total |
| `notes` | `scope` in trip/destination/itinerary/reservation with `target_id`; target validated to belong to the same trip |
| `documents` | Metadata for files in the private `trip-documents` bucket |
| `secure_share_tokens` | Reserved for read-only share links (hash only, expiry, revocation) |
| `ai_cache` | Cached AI results per (trip, kind, input hash); written only by the edge function |

## Integrity features
- **Foreign keys everywhere**, with `ON DELETE CASCADE` from trip to children. Cross-row references use **composite foreign keys** `(child_id, trip_id)` so an item, reservation, expense or document can never point at a different trip's data.
- **Check constraints**: lengths, enums, currency format `^[A-Z]{3}$`, non-negative money, ordered dates and times, a time zone required with every timestamp, coordinate ranges, document size (10 MB) and MIME allow-list, https-only cover images.
- **Deferred constraint trigger** keeping `sum(expense_splits) = expenses.amount_cents`.
- **Indexes** on every foreign key / lookup path (`trip_id`, `(trip_id, local_date, start_at)`, `(trip_id, expense_date)`, etc.).
- `created_at/updated_at` timestamps with an `updated_at` trigger.
- **Row-level security** on every table (see SECURITY.md).

## Setup
1. Create a Supabase project. 2. In the SQL editor (or `supabase db push`), run `0001_schema.sql`, `0002_security.sql`, `0003_storage.sql` in order. 3. Auth settings: enable **email confirmations**, set the Site URL to your app URL, and add `<app-url>/reset-password` to redirect URLs.

## Migration 0004: account deletion
Adds the placeholder user `00000000-0000-0000-0000-00000000dead` ("Former traveler", banned, never a member) and the functions `account_deletion_preview()` and `delete_my_account()`. Run it after 0001-0003 (existing projects: paste just this file).
