import { Link } from 'react-router-dom';
import { useTrip } from '../../hooks/contexts';

export default function More() {
  const { data } = useTrip();
  const base = `/trips/${data.trip.id}`;
  const links: [string, string, string][] = [
    ['explore', '🧭', 'Explore things to do'], ['details', '🧾', 'Travel details'], ['reservations', '🎫', 'Reservations'], ['budget', '📊', 'Budget'], ['notes', '📝', 'Notes'],
    ['documents', '📎', 'Documents'], ['members', '👥', 'Travelers'], ['map', '🗺️', 'Map'], ['search', '🔍', 'Search'], ['export', '🖨️', 'Export & print'], ['settings', '⚙️', 'Trip settings'],
  ];
  return (
    <div>
      <h2>More</h2>
      <ul className="list card">
        {links.map(([p, icon, label]) => <li key={p}><Link to={`${base}/${p}`} style={{ display: 'block', minHeight: 44, textDecoration: 'none', fontWeight: 600 }}><span aria-hidden="true">{icon}</span> {label}</Link></li>)}
      </ul>
    </div>
  );
}
