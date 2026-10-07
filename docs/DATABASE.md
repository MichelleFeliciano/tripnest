# Data model (on-device)

Stored in the browser's IndexedDB database `tripnest` (version 1), plus a few preferences in localStorage (`tripnest:settings`). One object store per table, keyed by `id` (UUID); every table except `trips` has an index on `trip_id`. A separate `blobs` store holds uploaded document files.

| Store | Contents |
|---|---|
| `trips` | name, dates (`end >= start`, at most 366 days), status, default currency, budget warning %, notes |
| `travelers` | name, `is_me`, order. The people on a trip (not accounts) |
| `destinations` | name, country, region, coordinates (both or neither), arrival/departure |
| `itinerary_items` | date, optional start/end **instants with IANA zones**, type, location, cost (minor units), confirmation, website, contact |
| `reservations` | typed bookings (flight/hotel/restaurant/activity/rental car/other) with flexible `details` |
| `packing_categories`, `packing_items` | shared lists (`is_shared`) or a traveler's personal list (`owner_id`), quantity, packed, assignee |
| `expenses` | amount (integer minor units), currency, payer, category, split method, and the **splits embedded** in the same record |
| `settlements` | recorded payments between two travelers |
| `budgets` | one row per (trip, category); `category = null` is the total |
| `notes` | scope trip/destination/itinerary/reservation + target |
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
- Cascades: deleting a trip removes everything in it including document files; deleting a packing category removes its items; deleting a destination/itinerary item/reservation unlinks (never deletes) what pointed at it.
- All multi-store changes run in **one transaction** and roll back entirely on error.

## Backup file (`tripnest-*.json`)
`{ app: "tripnest", format: 1, exportedAt, settings?, tables: { <store>: [...] }, files: { <documentId>: { type, data(base64) } } }`.
Opening one validates structure, ids, trips, itinerary dates/zones, that every expense's splits add up, payments, and that nothing belongs to a missing trip. Invalid files are refused and change nothing. *Restore* replaces everything on the device; *Import a trip file* adds copies with fresh ids and remapped links, never overwriting.

## Storage limits
Browsers typically allow hundreds of MB to several GB. Documents are limited to 10 MB each. The Profile page shows usage and whether the browser has promised not to evict the data (TripNest asks for this). Download backups regularly.
