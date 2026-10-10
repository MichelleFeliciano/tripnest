# Data API (internal)

There is no web API. The screens talk to a small TypeScript module over the on-device store. This is the surface other code (or a future sync feature) would build on. All functions throw `ApiError` with a plain-language message.

## `src/api/api.ts`
| Group | Functions |
|---|---|
| `trips` | `list()`, `create(trip, travelerNames, extraDestinations)`, `update(id, patch)`, `remove(id)` (also deletes documents) |
| `loadTrip(id)` | everything about one trip: trip, travelers, destinations, items, reservations, packing, expenses, settlements, budgets, notes, documents |
| `travelers` | `add`, `rename`, `setMe`, `remove` (refused while the person is in an expense or payment) |
| `rows` | `insert(table, row)`, `update(table, id, patch)`, `remove(table, id)` for destinations, itinerary items, reservations, budgets, notes, packing categories/items |
| `packing` | `applyTemplate(tripId, template, shared, ownerId)`, `toggle(id, packed)` |
| `expenses` | `save(tripId, expenseId \| null, expense, splits)`, `remove(id)`, `settle(...)`, `removeSettlement(id)` |
| `documents` | `upload(tripId, file, link)`, `openUrl(id)`, `remove(doc)` |
| `tasks` | `add(tripId, title, dueDate)`, `toggle(id, done)`, `update(id, patch)`, `remove(id)` |
| `itinerary` | `reorder(updates)`: new manual order for items that sort as equals (`moveWithinGroup` in `lib/itinerary` computes it) |
| `trash` | `list()`, `restore(id)`, `discard(id)`, `empty()`, `purgeOld()`. Every delete function returns `{ id, summary }` so the UI can offer Undo |

## `src/api/backup.ts`
`exportData({ tripId?, includeFiles })` · `parseBackup(text)` (validates) · `restoreAll(file)` · `importTrips(file)` (copies, new ids) · `eraseEverything()` · `backupFileName(name?)`

## Other modules
`src/api/copyTrip.ts`: `copyTrip(tripId, options)` and the pure `makeTemplate`. `src/api/weather.ts`: `loadTripWeather(...)` (Open-Meteo, cached, only after opt-in). `src/api/device.ts`: per-device notes (last backup, snooze, weather on, temperature unit). `src/components/share.ts`: `shareOrDownload`.

## `src/api/settings.ts`
`getSettings()` / `saveSettings()`: display name and home time zone, kept in localStorage.

## Pure logic (`src/lib`)
`money` (parse/format, integer minor units) · `splits` (`computeSplits`) · `balances` (`computeNetBalances`, `suggestSettlements`) · `budget` · `time` (`zonedToUtc`, formatting) · `itinerary` (ordering, conflicts) · `packing` (progress, templates) · `ics` (`buildIcs`) · `search` · `explore` · `trip`.

## Future integrations
Everything uses UUID ids and ISO dates, so a sync or integration layer (calendar, family budget app, meal planner) can read a trip through `exportData` and write through `importTrips` without touching the screens.
