# API

TripNest has no bespoke REST server. Clients use Supabase's auto-generated PostgREST API (RLS-protected) plus a few Postgres functions and one optional edge function. Everything requires `Authorization: Bearer <user JWT>`.

## Tables (PostgREST, `/rest/v1/<table>`)
Read: all tables the user is a member of. Direct writes are allowed only where noted.

| Table | Insert | Update | Delete |
|---|---|---|---|
| `trips` | self as owner | owner (not `owner_id`) | owner |
| `trip_members` | no (RPC) | owner: `role` | owner (non-owners), self-leave |
| `destinations`, `itinerary_items`, `reservations`, `budgets` | owner/editor | owner/editor | owner/editor |
| `notes` | owner/editor | author or owner | author or owner |
| `packing_*` | editor (shared) / any member (own personal) | same | same |
| `documents` | editor, own uploads | none | owner or uploader |
| `expenses` | no (RPC) | no (RPC) | owner or creating editor |
| `settlements` | no (RPC) | never | never |
| `trip_invitations` | no (RPC) | no | owner / inviter |
| `profiles` | by trigger | self: name, avatar, time zone | no |

## RPC (`POST /rest/v1/rpc/<name>`)
| Function | Args | Returns |
|---|---|---|
| `create_invitation` | `p_trip, p_email, p_role('editor'\|'viewer')` | raw token (once) |
| `invitation_preview` | `p_token` | `{trip_name, role, status, expires_at}` |
| `accept_invitation` / `decline_invitation` | `p_token` | `{status, trip_id?}` |
| `save_expense` | `p_trip, p_expense_id (null=create), p_data jsonb, p_splits jsonb[]` | expense id |
| `record_settlement` | `p_trip, p_from, p_to, p_amount, p_currency, p_date, p_note` | settlement id |

`p_data`: `paid_by, description, amount_cents, currency, expense_date, category, notes, itinerary_item_id, split_method`.
`p_splits`: `[{user_id, amount_cents, share_value}]`; amounts must sum to `amount_cents`.
Errors: `42501` not allowed, `23514` invalid value or unbalanced, `23503` not a trip member, `P0002` not found.

## Storage
Bucket `trip-documents` (private). Upload to `<trip_id>/<uuid>-<name>`; read via `createSignedUrl(path, 60)`.

## Edge function `ai-assist` (optional)
`POST /functions/v1/ai-assist` body `{tripId, kind: 'itinerary'|'packing'|'summary', input:{interests,budget,activities}}`, returns `{result, cached}`. Statuses: 401 not signed in, 404 not a member, 429 hourly cap, 503 not configured.

## Integration notes
All entities use UUID primary keys and `updated_at`, so external systems (budget app, calendar, meal planner) can reference trips and items stably. Calendar export is generated client-side (`src/lib/ics.ts`).
