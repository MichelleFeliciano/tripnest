export interface SearchDoc {
  kind: 'itinerary' | 'reservation' | 'note' | 'packing' | 'expense';
  id: string;
  title: string;
  detail: string;
  /** Extra text that is searchable but not displayed. */
  haystack: string;
}

/** AND-match every whitespace-separated term, case/diacritic-insensitive. */
export function searchDocs(docs: SearchDoc[], query: string): SearchDoc[] {
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const terms = norm(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  return docs.filter((d) => {
    const h = norm(`${d.title} ${d.detail} ${d.haystack}`);
    return terms.every((t) => h.includes(t));
  });
}
