# QA report

Scope: the on-device version of TripNest (no backend, no accounts). Everything below was run on this code; nothing is claimed that was not run.

## Results (latest full run)
| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | clean |
| Unit + storage tests (`npm test`, 5 files) | **103 passed**, 0 failed |
| Production build | succeeds (app script 225 kB, 73 kB gzipped; map code loads only on the Map page) |
| Browser tests (`npm run test:e2e`, Microsoft Edge) | **135 passed**, 0 failed, 3 skipped (phone-only checks on desktop) |

## What is tested
**Logic (unit):** trip dates and duration; time zones including the Chicago→Puerto Rico flight, daylight-saving gaps/ambiguity, half-hour zones; itinerary ordering and cross-zone conflicts; packing progress, templates, privacy of personal lists; budgets and thresholds; search; Explore query building, ranking and junk filtering; ICS output (structure, line folding, escaping, UTC instants, all-day events); money parsing (including `12,50`), every split method with property tests over thousands of totals, balances, settlement simplification, partial and over-payments, multiple currencies.

**On-device data layer (27 tests, fake IndexedDB):** every rule in [DATABASE.md](DATABASE.md): invalid dates/money/coordinates/URLs refused; splits must add up; payer and split people must be on the trip; cross-trip references refused; rows cannot move to another trip; failed saves leave nothing behind; cascades and unlinking; traveler removal blocked while in an expense or payment; documents (type, size, open, delete with trip); **backup round-trip including documents; importing a trip file as an independent copy with all links remapped and identical balances; damaged or tampered backups refused; a failed restore rolls back and leaves existing data intact.**

**Browser (Edge, real IndexedDB):**
- every screen and dialog at **375 px, 320 px, 375 px dark mode and desktop**: no sideways scrolling, nothing sticking out, tap targets ≥ 32 px on phones, no console errors, automated accessibility scan (axe, WCAG 2.2 AA) with zero serious or critical findings, in light and dark;
- phone navigation and "money tables show every amount without scrolling" regression checks;
- **user journeys:** create a trip → itinerary item → reload; invalid input refused; custom-split expense → balances → partial payment → reload → undo payment; $100 split three ways is 33.33/33.33/33.34; packing templates, personal lists per traveler, packed items survive reload; **backup → erase everything → restore**; a damaged backup is refused and changes nothing; delete a trip;
- **offline (production build + service worker):** after one visit the network is cut; reload, a deep link and saving a new expense all work, and the data survives going back online; the manifest and icons are valid.

## Bugs found by this testing and fixed
- Expenses page was 454 px wide on a 375 px phone (an invisible table header escaped its scroll container), pushing the **More** button off screen.
- Money tables cut off amounts on phones; fixed by moving Edit/Delete under the description and dropping secondary columns on small screens; a regression test guards it (it caught a later regression from the new theme's padding).
- Split-method buttons overflowed the Add Expense dialog.
- Scrollable tables were not keyboard-reachable.
- **Offline mode silently failed** on first try (cached files were missed because of a `Vary` header); fixed and covered by the offline test.
- "1 nights" grammar.

## Not verified
- **Real devices.** All browser tests use Edge (Chromium) emulation. iPhone Safari and real Android phones have not been tried, nor touch gestures, notches, or the home-screen install flow itself.
- **Screen readers** (VoiceOver/TalkBack/NVDA). Only the automated axe scan was run.
- **Map tiles, "Find coordinates" and Explore** call free OpenStreetMap services; they were exercised against the live services earlier in development, but the automated tests block them for determinism.
- **Print/PDF output** was not inspected visually.
- **Storage eviction behaviour** differs by browser; the persistence request is best-effort and cannot be tested automatically.

## Known limitations
- No live sharing between devices (use backup / trip files). Each device is its own copy.
- Anyone who can unlock the device and open the browser profile can read the trips; backup files are not encrypted.
- Clearing browser data deletes trips unless a backup exists (the app warns and offers backups).
- No drag-and-drop reordering, push notifications, weather, currency conversion or AI suggestions (the earlier optional AI feature required a server and was removed).
- A reservation entered with a date but no time is stored at midnight local time.

## History
Earlier versions used a hosted database (Supabase) with accounts and row-level security. That backend was removed when the project it ran on was deleted; the tests for it were retired with it. Its lessons (exact-cents money, rollbacks, same-trip references, safe imports) were carried into the on-device layer and re-tested there.
