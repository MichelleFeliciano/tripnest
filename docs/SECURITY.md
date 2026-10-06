# Security

## Model
The browser holds only the Supabase **anon** key. All authorization is enforced in Postgres, so a modified client gains nothing.

| Layer | Protection |
|---|---|
| Authentication | Supabase Auth (bcrypt, email confirmation, reset by emailed link, built-in rate limits). Sessions are JWTs; signing out clears the local trip cache |
| Authorization | RLS on all 17 tables; roles from `trip_members`; helper functions `is_trip_member / can_edit_trip / is_trip_owner` |
| Privileges | `anon` has no table or function access. Clients cannot write `expenses`, `expense_splits`, `settlements`, `ai_cache`, `trip_members` (insert/update except role), or invitations directly. Column-level grants stop users changing `trips.owner_id` or `profiles.email`. `trip_invitations.token_hash` is not selectable |
| Invitations | 244-bit random token shown once, only its SHA-256 stored, 7-day expiry, single use, tied to an email: only a signed-in account with that email can preview/accept; unknown token and wrong account give the same error. Ownership can't be granted. Limits: 25 pending per trip, 20 created per user per hour |
| Money integrity | See EXPENSE_LOGIC.md: RPC validation + deferred constraint + revoked direct writes + append-only settlements; only the payer, receiver or owner can record a settlement |
| Cross-trip leaks | Composite foreign keys; note-target trigger; packing-assignee trigger |
| Documents | Private bucket; objects live under `<trip_id>/…`; storage RLS checks membership of that trip; uploads need editor; viewers can't write; MIME allow-list and 10 MB limit (client and database); the browser only ever receives **60-second signed URLs**, requested on click and never stored |
| Input/Output | Length and format checks in SQL and forms; React escapes output; no `dangerouslySetInnerHTML`; map popups built from text nodes; external links must be http(s) and use `rel="noopener noreferrer"`; cover images https-only with `referrerPolicy=no-referrer` |
| Secrets | `.env` is git-ignored; only `VITE_*` public values go to the browser. The Anthropic key lives in Supabase secrets, used only inside the edge function |
| AI | Off by default; edge function verifies the JWT, reads trip data through the user's own RLS-bound client, caps 20 calls/hour/user, and returns suggestions that the UI applies only after the user clicks "Add" |

## Verified by tests
`tests/rls.test.ts` runs the real migrations in Postgres and checks, among others: outsiders see nothing; viewers can't write; editors can't alter/delete/archive trips or change roles; owner can't be removed or demoted; ownership can't be reassigned; invitation tokens are hidden, single-use, email-bound, expiring, can't grant owner; expense splits must balance and bypass attempts fail; settlements can't be edited or deleted; personal packing lists are private; storage objects/documents are member-only and trip-scoped.

## Known gaps / operator responsibilities
- **Enable email confirmation** in Supabase Auth; invitation matching trusts the JWT email.
- Edge-function CORS is `*` (it still requires a valid JWT). Restrict to your origin in production.
- Add a Content-Security-Policy header at the host (map tiles need `img-src tile.openstreetmap.org`; Nominatim needs `connect-src nominatim.openstreetmap.org`; Explore needs `connect-src overpass-api.de`). Explore only sends coordinates and a fixed category query to these public services, never trip or personal data.
- The invitation link is shared by the inviter manually; email delivery is not built.
- No MFA/audit log in the MVP. Supabase's own auth rate limits apply to sign-in and reset.
- The local cache (`localStorage`) holds the last viewed trip on that device; it's cleared at log out but not encrypted.
