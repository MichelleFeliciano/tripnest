# Privacy and security

## Model
TripNest has **no server, no accounts and no analytics**. Your trips, expenses and documents live only in your browser's storage on your device. There is no login to attack and no database to breach. The security question becomes: who can use this device or browser profile, and what does the page itself do.

| Area | What protects it |
|---|---|
| Where data lives | Your browser's IndexedDB on your device. It is never uploaded. Different phones and different browser profiles are separate |
| Network use | Only optional lookups: OpenStreetMap map tiles (Map page), Nominatim geocoding ("Find coordinates"), Overpass places (Explore), Open-Meteo weather (Overview, off until you turn it on), and the "Open in Maps" links, which send an address or coordinates to Apple or Google only when you tap them. They receive coordinates (and the dates being asked about) or a place name you typed, never your trip, names, money or documents. Nothing else leaves the page |
| Output encoding | React escapes all text; no `dangerouslySetInnerHTML`; map popups are built from text nodes |
| Links | External links must be http(s) and use `rel="noopener noreferrer"`; cover images are https-only and sent with no referrer |
| Imported files | Backup and trip files are parsed as data (never executed), size-limited, and structurally validated (ids, dates, time zones, money, that splits add up, that every row belongs to a trip). A bad file is refused and changes nothing. Restores are transactional |
| Documents | Stored as files in IndexedDB; only PDFs, common images and text up to 10 MB are accepted. They open through a temporary local link in a new tab |
| Money integrity | See [EXPENSE_LOGIC.md](EXPENSE_LOGIC.md): integer arithmetic, splits validated on every save and import |
| Dependencies | No runtime backend libraries (React, React Router and Leaflet only) |
| Offline cache | The service worker caches only this site's own build files, never user data or third-party requests |

## Limits you should know about
- **Anyone who can open this browser profile can read the trips.** Use your phone's lock screen. There is no app-level password.
- **Clearing site data deletes your trips.** Download a backup now and then (Profile → Download a backup). TripNest asks the browser for persistent storage, which most browsers grant for installed or frequently used sites, but it is not guaranteed.
- **Backup files are not encrypted.** They contain everything in the trip, including confirmation numbers and (optionally) documents. Store and share them like any private document.
- **A CSP header** is not set (GitHub Pages cannot send custom headers). The app does not load third-party scripts, and the only third-party hosts it contacts are the three OpenStreetMap services above.
- There is no way to share a trip live, and therefore no sharing permissions to get wrong.

## Erasing
Profile → *Erase all data on this device* removes every trip, document and setting after a typed confirmation. Deleting a single trip (Trip settings) removes its documents too.
