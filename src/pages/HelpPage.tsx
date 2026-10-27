import { Link } from 'react-router-dom';
import { APP_VERSION } from '../lib/changelog';

const TOPICS: { q: string; a: React.ReactNode }[] = [
  { q: 'Where is my data?', a: <>Only on this device, in this browser. There are no accounts and nothing is uploaded. That means nobody else can see your trips, and it also means <strong>a backup is your safety net</strong>: if the browser’s data is cleared or you lose the phone, the backup file is the only copy.</> },
  { q: 'How do I back up?', a: <>Open <Link to="/profile">Profile</Link> and choose <em>Download a backup</em> (or <em>Share backup</em> on a phone). Save it to email or a cloud drive. You can lock the file with a password. TripNest nudges you when it’s been a while.</> },
  { q: 'How do I share a trip with someone?', a: <>Open the trip, go to <em>Export</em>, and send them the trip file. On their phone they open TripNest and choose <em>Import a trip file</em>. If you each change the plan, send files back and forth: importing shows what will change first, <strong>never overwrites silently</strong>, and merges so that the newest change to each thing wins.</> },
  { q: 'I changed something by mistake', a: <>Tap <em>Undo</em> at the top of the trip (or press Ctrl/Cmd+Z). <Link to="/history">History</Link> lists recent changes. Deleted things show an <em>Undo</em> button for a few seconds and stay for 30 days in <Link to="/profile">Profile → Recently deleted</Link>.</> },
  { q: 'Does it work offline?', a: <>Yes. After your first visit the whole app is stored on the device, so it opens on a plane or abroad with no signal. A banner tells you when you’re offline. Maps, weather, Explore and place lookups need a connection.</> },
  { q: 'How do I put it on my Home Screen?', a: <>On iPhone: open it in Safari, tap the Share button, then <em>Add to Home Screen</em>. On Android: use the browser menu and choose <em>Install app</em> (or tap <em>Install</em> when TripNest offers it).</> },
  { q: 'How do I update TripNest?', a: <>When a new version is ready, a banner appears with <em>Update now</em>. You can also check any time in <Link to="/settings">Settings</Link>, which shows the version number and what’s new.</> },
  { q: 'Can I lock the app?', a: <>Yes: in <Link to="/settings">Settings</Link> choose a PIN or password. It keeps people who pick up your phone out of your trips. It doesn’t scramble the stored data itself; for a file you send or store elsewhere, use a password-protected backup.</> },
  { q: 'Dark mode and bigger text', a: <>In <Link to="/settings">Settings</Link> you can follow the device’s dark mode or force Light or Dark, and pick a text size.</> },
  { q: 'How are shared expenses split?', a: <>Amounts are kept in exact cents and split exactly (equal, custom amounts, percentages or shares), with any leftover cent assigned fairly. Different currencies are never converted: each currency has its own balances.</> },
  { q: 'Which places does TripNest contact?', a: <>Only when you use these: OpenStreetMap (maps and place lookups), Overpass (Explore), and Open-Meteo (weather, off until you turn it on). They receive a place name or coordinates, never your trip.</> },
];

export default function HelpPage() {
  return (
    <main className="container">
      <h1>Help</h1>
      <p className="muted">TripNest version {APP_VERSION}. Tap a question to open it.</p>
      <div className="card help-list">
        {TOPICS.map((t) => (
          <details key={t.q}>
            <summary>{t.q}</summary>
            <p>{t.a}</p>
          </details>
        ))}
      </div>
      <p><Link to="/trips">Back to your trips</Link> · <Link to="/settings">Settings</Link></p>
    </main>
  );
}
