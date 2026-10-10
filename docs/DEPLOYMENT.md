# Deployment

TripNest is a static site. There is no database, server or secret to configure. Hosting is free on GitHub Pages.

## How it is deployed here
`.github/workflows/deploy.yml` runs on every push and pull request. Jobs:
- **build**: `npm ci`, `npm test`, the production build, and the Pages bundle
- **e2e**: the Playwright browser tests, one job per project (phone-375, phone-320, phone-dark, desktop, offline-pwa) in parallel, using Chromium on the runner. Failure screenshots and traces are kept for 7 days as workflow artifacts
- **deploy**: only for a push to `main`, and only after **build and every e2e job passed**

The build job's steps:
1. `npm ci`
2. `npm test` (the unit and storage tests; a failure stops the deploy)
3. `npm run build` with `VITE_BASE=/<repo>/` (the site lives under a sub-path on GitHub Pages)
4. copies `index.html` to `404.html` (Pages has no single-page-app fallback, so deep links still open the app) and adds `.nojekyll`
5. publishes `dist/` with the official Pages actions

Live URL: **https://michellefeliciano.github.io/tripnest/**

## One-time setup (already done)
- The repository must be **public** (free GitHub plans only serve Pages from public repos). It contains no secrets: there are none in the project.
- Settings → Pages → Source: **GitHub Actions**.

## Forking or moving it
Fork or copy the repo, enable Pages with the Actions source, push to `main`. The URL becomes `https://<user>.github.io/<repo>/` and the build picks the sub-path up from the repository name. For a custom domain served from the root, build with `VITE_BASE=/` (the default).

## Other static hosts
Run `npm run build` and upload `dist/`. Netlify/Cloudflare Pages work as-is (`public/_redirects` provides the SPA fallback); Vercel uses `vercel.json`.

## Installing on a phone
iPhone (Safari): Share → Add to Home Screen. Android (Chrome): menu → Install app / Add to Home screen. After the first visit the app also opens with no connection.

## Updating
Push to `main`. Open copies of the app pick up the new version the next time they are reloaded online (the service worker replaces its cache when the build changes). Stored trips are never touched by an update.

## Smoke test after deploying
Create a trip → add an itinerary item → add an expense split three ways with a custom split → record a partial payment → upload a PDF → download a backup → reload → switch the phone to airplane mode and reopen the app.
