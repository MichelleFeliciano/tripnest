# 🌴 TripNest

Plan a trip in one place: itinerary, reservations, packing, shared expenses with fair splitting, budgets, notes, documents, maps and calendar export. Built for phones, works offline, and **everything stays on your own device**. There are no accounts, no servers and no sign-up.

**Live:** https://michellefeliciano.github.io/tripnest/ (add it to your home screen for an app-like experience)

## How it works
TripNest is a static web app. Trips are stored in your browser (IndexedDB) on the device you use, so each phone has its own private copy. To protect against lost data or to move a trip to another phone, download a backup or a trip file from the app and import it elsewhere. Nothing is uploaded anywhere. The only network requests are optional map tiles and place lookups (OpenStreetMap), and only when you use the map or Explore.

## Features
- **Trips**: dates validated (days/nights calculated), status, destinations, notes, dashboard with today's plan, next item, expenses, packing progress and quick actions.
- **Travelers**: the people on a trip are just names. Choose which one is you.
- **Itinerary** with times in the **local time zone of each place** (a flight can leave Chicago and land in Puerto Rico). Timeline, month calendar, week and day views, schedule-conflict warnings.
- **Reservations & travel details**: flights, hotels, restaurants, activities, rental cars, contacts, with a quick-access page of confirmation numbers.
- **Packing**: shared list plus a personal list per traveler, categories, quantities, assignees, "12 / 20 packed (60%)", five editable templates.
- **Expenses**: equal / custom / percentage / shares splits that always add up exactly, who-owes-whom, simplified settlement plan, partial payments, multi-currency (never silently converted).
- **Budgets**: total and per category, under/near/over with gentle wording.
- **Documents** (PDFs, images) saved on the device, available offline.
- **Explore**: sights, museums, food, beaches and activities near each destination (OpenStreetMap), added to your itinerary with one tap.
- **Map**, **search**, **printable booklet / PDF**, **.ics calendar export**.
- **Back up / restore / import a trip file / erase everything**.
- **Works offline** after the first visit, and installs to the home screen.

## Stack
React 18 + TypeScript + Vite (plain CSS) · IndexedDB · Leaflet/OpenStreetMap · a generated service worker · Vitest · Playwright. No backend. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Local development
```bash
npm install
npm run dev        # http://localhost:5173
```
No environment variables or accounts are needed.

## Testing
```bash
npm test           # 103 unit + storage tests (money, splits, balances, time zones, backups, rules)
npm run build      # typecheck + production build
npm run test:e2e   # browser tests in Microsoft Edge: every screen on phone/dark/desktop, real user journeys, offline mode
```
See [docs/QA_REPORT.md](docs/QA_REPORT.md) for exactly what was and wasn't verified.

## Deployment
GitHub Pages, deployed by Actions on every push to `main` (the tests must pass first). See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Docs
[Architecture](docs/ARCHITECTURE.md) · [Data](docs/DATABASE.md) · [Expense logic](docs/EXPENSE_LOGIC.md) · [Privacy & security](docs/SECURITY.md) · [Data API](docs/API.md) · [Deployment](docs/DEPLOYMENT.md) · [QA report](docs/QA_REPORT.md)
