# QA report

Scope: the on-device version of TripNest (no backend, no accounts). Everything below was run on this code; nothing is claimed that was not run.

## Results (latest full run)
| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | clean |
| Unit, storage and property tests (`npm test`, 18 files) | **283 passed**, 0 failed |
| Production build | succeeds (app script 225 kB, 73 kB gzipped; map code loads only on the Map page) |
| Browser tests on GitHub Actions (Chromium on Linux, one job per screen size, run 38022749001) | **198 passed**, 0 failed, 0 retried; 10 skipped (checks that only apply to some screen sizes) |
| The same browser tests on the developer PC (Microsoft Edge) | pass; Edge and Chromium differ in places (see below), so both are used |

## What is tested
**Logic (unit):** trip dates and duration; time zones including the Chicagoâ†’Puerto Rico flight, daylight-saving gaps/ambiguity, half-hour zones; itinerary ordering and cross-zone conflicts; packing progress, templates, privacy of personal lists; budgets and thresholds; search; Explore query building, ranking and junk filtering; ICS output (structure, line folding, escaping, UTC instants, all-day events); money parsing (including `12,50`), every split method with property tests over thousands of totals, balances, settlement simplification, partial and over-payments, multiple currencies.

**Property tests (thousands of generated cases each, seeded so failures are reproducible):** wall-clock time round-trips through UTC for 16 zones (including 30- and 45-minute offsets, Lord Howe and Chatham daylight saving, southern-hemisphere DST) on every day of a year with daylight-saving gaps rolling forward only; later times never map to earlier instants; 3,000 random ledgers (all four split methods, two currencies, payments) always net to zero and clear with at most n-1 transfers, independent of input order; money parse/format round-trips exactly for USD/JPY/BHD/EUR and 20,000 junk strings never throw anything but `MoneyError`; hostile text (emoji, CR/LF, backslashes) always produces valid calendar lines of at most 75 bytes that unfold back to the original; budget math matches an independent calculation; conflict detection matches a brute-force check; trip date lists agree across leap years and month ends.

**On-device data layer (27 tests, fake IndexedDB):** every rule in [DATABASE.md](DATABASE.md): invalid dates/money/coordinates/URLs refused; splits must add up; payer and split people must be on the trip; cross-trip references refused; rows cannot move to another trip; failed saves leave nothing behind; cascades and unlinking; traveler removal blocked while in an expense or payment; documents (type, size, open, delete with trip); **backup round-trip including documents; importing a trip file as an independent copy with all links remapped and identical balances; damaged or tampered backups refused; a failed restore rolls back and leaves existing data intact.**

**Browser (Edge, real IndexedDB):**
- every screen and dialog at **375 px, 320 px, 375 px dark mode and desktop**: no sideways scrolling, nothing sticking out, tap targets â‰¥ 32 px on phones, no console errors, automated accessibility scan (axe, WCAG 2.2 AA) with zero serious or critical findings, in light and dark;
- phone navigation and "money tables show every amount without scrolling" regression checks;
- **user journeys:** create a trip â†’ itinerary item â†’ reload; invalid input refused; custom-split expense â†’ balances â†’ partial payment â†’ reload â†’ undo payment; $100 split three ways is 33.33/33.33/33.34; packing templates, personal lists per traveler, packed items survive reload; **backup â†’ erase everything â†’ restore**; a damaged backup is refused and changes nothing; delete a trip;
- **to-do list, copy-as-template, undo / Recently deleted (files included), reordering, backup reminder, Home Screen tip, share sheet (with a stand-in), weather (mocked)**, each with unit tests and a browser journey, plus an accessibility scan of the new banners and the weather card;
- **offline (production build + service worker):** after one visit the network is cut; reload, a deep link and saving a new expense all work, and the data survives going back online; the manifest and icons are valid.

## Bugs found by this testing and fixed
**Feature batch (calendar reminders, install prompt, countdown and key info, password-protected backups, merge between phones):**
- Found while testing: the password box did not take focus when it opened, so you had to click into it first (dialogs can now focus a marked field); a test asserting "restore puts everything back exactly" had to learn that a restored row is now stamped as a new change (correct: that is what lets a restore beat an earlier deletion on the other phone).
- Merge is tested at three levels: the rules in isolation (19 tests, including 400 random edit-and-delete histories on two phones that must end up identical), against a real database with two simulated phones (13 tests: first import, update both ways, deletions, undo, documents, collisions, older files), and in the browser with two separate browser profiles passing a file through the real screens.
- Password protection: round trips (accents, emoji, 2 MB), wrong password, tampering, crafted files, Unicode-form differences, and the full lock, erase, restore flow in a browser.
- Accessibility scan (light, dark, phone) of the new screens: key info dialog, password options, import preview, password prompt.
- Still not verified: a real phone (see [DEVICE_CHECKLIST.md](DEVICE_CHECKLIST.md)).

**Housekeeping pass:** the repository was scanned for leftovers from the earlier hosted-database version (none in the code, docs or git history; only two ignore-file lines, now removed), for unused source files and unused dependencies (none), and for committed secrets (none). A LICENSE (MIT) and README screenshots were added; a small header artifact (a sliver of gradient beside the wave under the trip banner) found while taking the screenshots was fixed.

**Second stylesheet pass (each finding first reproduced by a test):**
- **A long unbroken word (a pasted link, a very long name) pushed most trip pages to 1,600 px or wider.** Page content now wraps anywhere; guarded by a test that fills every page with such strings.
- **Body text ignored the browser's text-size setting** (it was fixed at 16 px). It now follows it, and 150% and 200% text are tested on a phone.
- At large text the title wrapped out of the top bar; the title now shrinks first so Back and Profile always stay visible.
- **Focused text boxes changed shape** (their 14 px corners snapped to 6 px); fixed.
- **Focus rings were clipped** inside the calendar grid, segmented buttons and scrolling tables; they are now drawn inside those boxes.
- **Keyboard focus could end up hidden behind the sticky top bar, tab bar or day heading** (five places on a phone, e.g. the Website link and Add traveler); fixed with scroll padding, guarded by a test that tabs through four pages and checks what is on top.
- The earlier notch fix did not work on phones, because later phone rules overrode the safe-area padding; fixed.
- Printing: wide tables were clipped by their scroll box and the undo message could print; fixed.
- New sweeps: every page at 12 screen sizes (including landscape phones, both sides of the 720 px breakpoint, tablets and 1920 px) with the right navigation at each; print layout; Windows high-contrast mode.

**Stylesheet review (every rule read; unused classes found by script):**
- **The map painted over the sticky top bar and the bottom tab bar** when scrolling past it (Leaflet's internal layers sit at z-index 400 to 1000). Fixed; guarded by a browser test that checks what is actually under the bar.
- **On iPhones with a home indicator the bottom tab bar lost about half its height** (the safe-area padding was taken out of a fixed height instead of added to it). Fixed. Not verified on a real iPhone: browsers on a PC report no safe area, so this one rests on reading the CSS.
- Landscape iPhones with a notch: content could sit under the notch; side safe-area padding added to the top bar, page and tab bar.
- Buttons stayed lifted after a tap on phones (hover effects now only where a real hover exists).
- Wrapped segmented buttons (Explore categories) were clipped by a pill-shaped border; long dialogs now use dynamic viewport height so a phone's address bar cannot hide the bottom.
- Windows high-contrast mode would have hidden progress bars and selected states; added rules. Decorative emoji now have a plain fallback for browsers without the alt-text syntax.
- Removed unused rules; the app manifest no longer locks portrait orientation and its colours match the current theme.

**First run on GitHub's servers (a different browser and fonts than the developer PC):**
- **The Expenses table scrolled sideways on phones** (22 px too wide at 375 px) with Linux's wider fonts, though it fit on Windows. Table cells on phones can now break long words and use tighter buttons.
- Two tests raced a slower machine (they moved on before an erase or restore had finished, or looked for the opened file after it had already downloaded). Fixed in the tests; the app was right.
- Headless Chromium has no PDF viewer, so opening a stored PDF downloads it; the tests accept either outcome.

**Code review round (found by reading the code and probing in a real browser):**
- **Backups failed in real browsers when they included two or more documents** ("The transaction has finished"): files were converted inside the database transaction, which a browser closes as soon as slow work happens. The in-memory test database had hidden it. Fixed; now guarded by a real-browser test.
- **Opening a document always showed a false "blocked" message** (the browser returns nothing when the new tab is opened with the noopener option). Fixed.
- **Any crash produced a blank page.** Added an error page that says the trips are safe and offers Reload, plus an automatic one-time reload when a new version replaces a file the page still needs.
- **Damaged or hand-edited backups could crash a screen later** (a date that is not a date, an unknown category, a zero quantity...). Opening a file now checks every field the screens depend on and refuses it with a clear message.
- **Half-typed itinerary forms leaked between trips** (the saved draft was not tied to a trip). Fixed.
- **The app crashed when opened over plain http** (for example from a phone on the home network during development) because it needed `crypto.randomUUID`. Fixed with a fallback.
- **Editing an itinerary item pre-filled an end date, so changing only the start date produced a confusing "end before start" error.** Fixed.
- **After shortening a trip, items on removed days could not be re-saved** (the date picker rejected their own date). Fixed.
- **The default time zone for a new item came from an arbitrary existing item.** It now follows the most recently touched one.
- **Records missing a created time or sort order could crash lists.** Sorting is now tolerant.
- **Slow connections:** the service worker now falls back to the cached app after 4 seconds instead of waiting on a poor network.

**Earlier:**
- Expenses page was 454 px wide on a 375 px phone (an invisible table header escaped its scroll container), pushing the **More** button off screen.
- Money tables cut off amounts on phones; fixed by moving Edit/Delete under the description and dropping secondary columns on small screens; a regression test guards it (it caught a later regression from the new theme's padding).
- Split-method buttons overflowed the Add Expense dialog.
- Scrollable tables were not keyboard-reachable.
- **Offline mode silently failed** on first try (cached files were missed because of a `Vary` header); fixed and covered by the offline test.
- "1 nights" grammar.

## Not verified
- **Real devices.** All browser tests use Chromium-family emulation (Edge locally, Chromium in CI). iPhone Safari and real Android phones have not been tried, nor touch gestures, notches, or the home-screen install flow itself.
- **Screen readers** (VoiceOver/TalkBack/NVDA). Only the automated axe scan was run.
- **Weather** (Open-Meteo) was tested against mocked replies shaped like Open-Meteo's documented format; the live service has not been called by the tests. **The share sheet** was tested with a stand-in, because desktop browsers have none: it has not been tried on a real iPhone or Android phone.
- **Map tiles, "Find coordinates" and Explore** call free OpenStreetMap services; they were exercised against the live services earlier in development, but the automated tests block them for determinism.
- **Print/PDF output** was not inspected visually.
- **Storage eviction behaviour** differs by browser; the persistence request is best-effort and cannot be tested automatically.

## Known limitations
- No live sharing between devices. Phones keep a trip in step by passing trip files, and importing an updated file offers to merge (newer edit wins). It depends on both phones' clocks being roughly right, and a deletion only travels for 30 days (while it is still in Recently deleted).
- Anyone who can unlock the device and open the browser profile can read the trips. Backup files are only encrypted if you choose a password, and a forgotten password cannot be recovered.
- Clearing browser data deletes trips unless a backup exists (the app warns and offers backups).
- Itinerary items are reordered with up/down buttons (and only among items at the same time, or all-day items); there is no drag-and-drop. No push notifications, currency conversion or AI suggestions (the earlier optional AI feature required a server and was removed).
- A reservation entered with a date but no time is stored at midnight local time.

## History
Earlier versions used a hosted database (Supabase) with accounts and row-level security. That backend was removed when the project it ran on was deleted; the tests for it were retired with it. Its lessons (exact-cents money, rollbacks, same-trip references, safe imports) were carried into the on-device layer and re-tested there.
