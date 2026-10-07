# TripNest Architecture

## Goal
A trip planner that is mobile-first, free to run forever, private by default, and correct with money, time zones and data. Hosted on GitHub Pages with **no backend and no accounts**.

## Decisions
| Choice | Why |
|---|---|
| Static web app (React + TypeScript + Vite, plain CSS) | Hosts for free on GitHub Pages; nothing to run or pay for |
| Data in the browser's **IndexedDB** | Private (never leaves the device), works offline, holds files (documents) as well as records |
| Travelers are **names, not accounts** | Needed for splitting costs and packing, without sign-in or sharing infrastructure |
| Service worker generated at build time | After one visit the whole app opens with no connection |
| Pure logic in `src/lib` | Money, splits, balances, budgets, time zones, itinerary, ICS, search are framework-free and unit tested |
| Leaflet + OpenStreetMap, Nominatim, Overpass | Free, no API keys; optional and non-essential. The app works fully without them |

**Trade-off accepted:** each device has its own copy. A trip moves between devices only through an explicit backup/trip file. Real-time sharing would require a server (not built; see the end of this file).

## Layout
```
src/lib/       pure, deterministic logic (tested): money, splits, balances, budget, time, itinerary, packing, ics, search, explore, trip
src/api/       db.ts (IndexedDB transactions) · api.ts (all rules + cascades) · backup.ts (export/restore/import) · settings.ts
src/pages/     screens;  src/components/  shared UI;  src/hooks/  drafts, async helpers, trip context
tests/         vitest (logic + storage) and tests/e2e (Playwright)
vite.config.ts also emits dist/sw.js (the offline service worker) after each production build
```

## Data flow
Screens call `src/api/api.ts`. Every write runs in **one IndexedDB transaction** that validates the rule first (valid money, splits add up, same-trip references, no duplicate names...) and either fully applies or fully rolls back. Screens then reload the trip and re-render. Form input is kept in sessionStorage so a failed save never loses what was typed.

## Time zones
Each timed itinerary value is `(UTC instant, IANA zone of the place)` plus `local_date`. Users type wall-clock time at the place; `zonedToUtc` converts using that zone (DST-aware: gaps roll forward, ambiguous times pick the first occurrence). Display always uses the stored zone, never the viewer's. Conflict detection compares instants. ICS export writes UTC instants plus the local time text.

## Money
Integer minor units everywhere; per-currency exponents (JPY 0, BHD 3...). Details in [EXPENSE_LOGIC.md](EXPENSE_LOGIC.md).

## Offline and install
`vite.config.ts` lists every built file into `dist/sw.js`, which precaches them. Navigation requests try the network first and fall back to the cached app shell; assets are served from the cache. Map tiles and place lookups always use the network and are never cached. A web manifest and icons make it installable.

## What is not built (and how it would be added)
- **Sharing a trip live between two people.** Requires a shared store. Options considered: a hosted database with accounts, or a private GitHub repository used as storage with each person's GitHub token. Neither was chosen; today sharing is by exchanging a trip file.
- **AI suggestions, weather, push notifications, currency conversion.** Deliberately omitted (they need keys or servers). Calculations never use AI.
