# Data model (on-device)

Stored in the browser's IndexedDB database `tripnest` (version 2), plus a few preferences in localStorage (`tripnest:settings` for your name and time zone; `tripnest:device` for per-device notes such as the last backup date and whether weather is on; short-lived caches for weather and Explore results). One object store per table, keyed by `id` (UUID); every table except `trips` has an index on `trip_id`. A separate `blobs` store holds uploaded document files.

| Store | Contents |
|---|---|
| `trips` | name, dates (`end >= start`, at most 366 days; 367 is refused), status, default currency, budget warning %, notes |
| `travelers` | name, `is_me`, order. The people on a trip (not accounts) |
| `destinations` | name, country, region, coordinates (both or neither), arrival/departure |
| `itinerary_items` | date, optional start/end **instants with IANA zones**, type, location, cost (minor units), confirmation, website, contact |
| `reservations` | typed bookings (flight/hotel/restaurant/activity/rental car/other) with flexible `details` |
| `packing_categories`, `packing_items` | shared lists (`is_shared`) or a traveler's personal list (`owner_id`), quantity, packed, assignee |
| `expenses` | amount (integer minor units), currency, payer, category, split method, and the **splits embedded** in the same record |
| `settlements` | recorded payments between two travelers |
| `budgets` | one row per (trip, category); `category = null` is the total |
| `notes` | scope trip/destination/itinerary/reservation + target |
| `tasks` | the pre-trip to-do list: title, optional due date, done, notes (added in version 2) |
| `trash` | "Recently deleted": whatever a delete removed (rows, files and links to restore), kept 30 days, never included in backups (added in version 2) |
| `documents` | file metadata; the file itself is in `blobs` under the same id |

Fields named `user_id`, `paid_by`, `assigned_to`, `owner_id`, `from_user`, `to_user` all hold a **traveler id**.

## Rules enforced on every write (`src/api/api.ts`, tested in `tests/store.test.ts`)
- Required text, lengths, enums, currency format `^[A-Z]{3}$`, non-negative money, valid dates, coordinate ranges, https/http-only URLs.
- A time zone is required with every timestamp; an end cannot be before its start.
- **An expense's splits must add up exactly to its total**; payer and everyone in the split must be travelers on that trip; no duplicates.
- Payments: positive amount, two different travelers on the trip.
- References (destination, itinerary item, reservation, packing category, note target, assignee) must belong to the **same trip**. A row can never be moved to another trip.
- Packing items must sit in a category of the same list (shared vs a particular traveler's).
- One budget per (trip, category).
- A traveler who appears in any expense or payment cannot be removed (balances never change by accident); a trip keeps at least one traveler.
- Cascades: deleting a trip removes everything in it including document files; deleting a packing category removes its items; deleting a destination/itinerary item/reservation unlinks (never deletes) what pointed at it, except the notes written about it, which go with it and come back together on Undo; removing a traveler also removes their personal packing list and clears their assignments (all of it comes back on Undo). Restoring from Recently deleted checks that what a row depends on still exists (the payer of an expense, the thing a note is about, a second budget for the same category) and refuses with a plain message instead of restoring something half-broken.
- Deleting anything keeps a copy in `trash` in the same transaction, so Undo and Restore bring it back with its files; restoring refuses to re-create something under a parent that is gone (for example an expense whose trip is still deleted).
- All multi-store changes run in **one transaction** and roll back entirely on error.

## Backup file (`tripnest-*.json`)
`{ app: "tripnest", format: 1, exportedAt, settings?, tables: { <store>: [...] }, files: { <documentId>: { type, data(base64) } } }`.
A backup can also be **password protected**: the file is then `{ app, format, encrypted: true, kdf: "PBKDF2-SHA256", iterations, salt, iv, data }` where `data` is the whole backup encrypted with AES-256-GCM (see SECURITY.md). Opening one asks for the password first. Opening one validates structure, ids, trips, itinerary dates/zones, that every expense's splits add up, payments, and that nothing belongs to a missing trip. Invalid files are refused and change nothing. *Restore* replaces everything on the device; *Import a trip file* adds copies with fresh ids and remapped links, never overwriting.

## Keeping one trip in step on two phones (merge)
Every saved row carries `updated_at`, set by the storage layer on each save (`Tx.put`). Restoring a backup, importing and merging use `putAsIs`, which keeps a row's own stamp. A single-trip file also carries `tombstones`: what was deleted from that trip recently (taken from Recently deleted, so up to 30 days).

Importing a file (`src/api/merge.ts`, rules in `src/lib/merge.ts`, both tested):
- A trip this device does not have is added **keeping its ids**, so later files for it can be matched. If any of its rows would collide with rows stored under another trip, it is added as a separate copy instead.
- A trip this device already has can be **updated** or added as a **separate copy** (the person chooses, after a preview of how many rows would be added, changed or removed).
- Update rules: for a row on both sides the **newer** `updated_at` wins (ties, or no stamp, keep this device's row, so a merge never changes anything on a guess). A row only the file has is added unless this device deleted it more recently. A deletion recorded in the file removes the row here unless this device changed it more recently. Which traveler is "me" is never changed. A traveler is never removed while an expense, payment, packing list or assignment still refers to them. Afterwards, links to rows that no longer exist are cleared (or the dependent row is dropped), as a normal delete does.
- Rows an update removes go to Recently deleted (kind "Update") and can be restored.
- It relies on the two phones' clocks being roughly right: if one phone's clock is a day wrong, its edits can wrongly win or lose.

`trips.key_info` (optional text, at most 2,000 characters) is the pinned "Key info" note; it is left out when a trip is copied as a template.

## Storage limits
Browsers typically allow hundreds of MB to several GB. Documents are limited to 10 MB each. The Profile page shows usage and whether the browser has promised not to evict the data (TripNest asks for this). Download backups regularly.
