# QA report

Date: 2026-10-05. Scope: whole MVP. One independent read-only QA review (code, SQL, tests) was run at the end; its findings and their status are below.

## What was actually run
| Check | Result |
|---|---|
| `npx vitest run` (4 files) | **131 passed, 0 failed** |
| `npx tsc --noEmit` | clean |
| `npm run build` | succeeds (initial JS 433 kB / 125 kB gzip; routes and Leaflet lazy-loaded) |
| UI smoke in a real browser (Vite dev server, no backend) | Login page renders on a 375 px phone viewport in dark mode with no console errors; with the backend unreachable, sign-in shows "Can't reach the server…" and keeps the typed values |

## What was NOT verified (be aware)
- **The full UI has not been exercised against a live Supabase project.** No Supabase credentials/instance were available in this environment, so sign-up emails, password-reset emails, Storage uploads and signed URLs, the edge function, and every logged-in screen have been type-checked and built but not clicked through. Follow the smoke test in DEPLOYMENT.md before real use.
- The database layer **was** verified: migrations 0001-0003 run in an in-process Postgres (PGlite) with stubs for Supabase `auth.uid()/auth.jwt()` and storage. Differences from real Supabase (e.g. the `storage` API server, signed-URL minting, auth schema internals) are not covered.
- No automated accessibility audit (axe/Lighthouse), no screen-reader run, no real-device mobile test, no print-to-PDF visual check, no load testing.
- Map tiles, geocoding (Nominatim) and the AI function were not run.

## Features and how they were tested
| Area | Tested by |
|---|---|
| Trip dates, days/nights, validation (incl. >1 year) | unit tests |
| Roles/permissions matrix | unit tests + 60 database-level tests |
| Time zones (Chicago→Puerto Rico flight, DST gap/ambiguity, half-hour zones, local date) | unit tests |
| Itinerary ordering, grouping, conflicts (incl. cross-zone) | unit tests |
| Packing progress (12/20 = 60%), personal vs shared visibility, templates | unit + DB tests |
| Budgets: total, category, remaining, thresholds, roll-ups, foreign-currency exclusion | unit tests |
| Splits: equal ($100/3 = 33.33/33.33/33.34), custom, percent, shares, rounding property tests over thousands of combinations, invalid input | unit tests |
| Balances (the $300/$100 example), settlement simplification, partial/over-payment, multi-currency separation | unit tests |
| `save_expense` / constraint trigger / revoked direct writes / append-only settlements | DB tests |
| Invitations: hashing, hidden token, wrong account, expiry, decline, single-use, no owner role | DB tests |
| Documents: private bucket, member-only read, editor-only write, path scoping, MIME/size limits | DB tests |
| ICS: structure, CRLF, line folding, escaping, UTC instants for cross-zone events, all-day events | unit tests |
| Search | unit tests |

## Bugs found and fixed
During development: `check_expense_total` referenced columns of both trigger tables (found by the DB tests, fixed); `useAction` dropped state updates under React StrictMode so forms stayed on "Please wait…" (found in the browser, fixed); ICS description omitted the arrival zone (fixed).

From the final QA review, fixed with regression tests:
1. AI endpoint accepted prototype keys (`constructor`) bypassing the usage cap, and viewers could trigger calls. Now `Object.hasOwn`, editors/owners only.
2. Any editor could record a settlement between two other people. Now only the payer, the receiver or the owner.
3. Debts of a removed member could never be settled. Settlements now allow former members who appear in the trip's expenses.
4. Settings form went stale after archive/reload and could revert status. Now re-synced.
5. `12,50` was read as 1250.00. A single comma + 1-2 digits is now a decimal separator.
6. Packing item could land in a category of the other list type (hidden/leaked). UI resets the category on tab switch and a DB trigger enforces matching visibility/owner.
7. Item-form drafts survived Cancel. Cancel now clears the draft.
8. Budget save could half-write on a typo. Everything is parsed before writing.
9. Malformed AI JSON could crash the page. Output is validated.
10. Default dates used UTC (evening defaults to tomorrow). Now local date.
11. DST gap rolled backward. Now rolls forward.
13/14. "Add something" ignored the clicked day; an invalid `?date=` crashed. Fixed.
17. Rows could be moved to another trip by UPDATE of `trip_id`. A trigger now pins it on seven tables.
18. `is_member_of` allowed a membership oracle. Execution revoked.
20. `apportion` could exceed 2^53 near the old cap. Cap lowered to 1e11 minor units (client and DB).

## Explore (added after the QA review)
Query building, parsing, junk filtering, ranking and link safety are unit-tested (`tests/explore.test.ts`). Checked live: geocoding San Juan and fetching 40 sights from Overpass worked; survey-marker junk found in the first live run was filtered. Limits: OpenStreetMap coverage and tagging quality vary by area; the geocoded centre of a city may be its municipal centre rather than the tourist core (use *Another place* or save precise coordinates); the free public Overpass service can be slow or rate-limited.

## Known limitations / not fixed
- Removing a member with an unsettled balance is allowed; their name shows as "Former traveler" and the debt can be settled, but they can't be added to new splits and editing an old expense that includes them redistributes by current members only (finding #3, partial).
- Reservation date without time is stored as 00:00 local and displays "12:00 AM" (#12). An end time without a date is ignored.
- Revoking another editor's invitation silently does nothing (RLS) (#15). Trip creation with extra destinations is two requests, so a failure between them can leave a trip without destinations (#16).
- Any editor can delete any object in the document bucket directly (storage policy is broader than the `documents` table policy) (#19). Tighten if untrusted editors are a concern.
- The AI hourly cap counts successful results only; unparsable model replies are not counted.
- Drag-and-drop reordering is not implemented (not required for MVP; `sort_order` exists). No offline write queue (reads fall back to a cached copy). No push notifications, weather, currency conversion or read-only share links (schema/architecture only).
- Cover images are links, not uploads. The invitation link must be sent by the inviter (no email delivery).

## Accessibility (design review, not audited)
Semantic landmarks and headings, skip link, labelled inputs with hints/errors, native `<dialog>` modals, visible focus ring, 44 px touch targets, checkbox packing list with accessible names, calendar as a table with per-day button labels, expense/balance tables with captions and header scopes, status never colour-only (text + icon), `prefers-reduced-motion` honoured, map has a full text list fallback. Not yet tested with a screen reader or automated tooling.

## Recommended next steps
Run the DEPLOYMENT.md smoke test on a real Supabase project; add Playwright end-to-end tests with two accounts; run axe/Lighthouse; add the offline mutation queue; atomic `create_trip` RPC; email delivery for invitations; tighten storage delete policy; restrict edge-function CORS and add a CSP.
