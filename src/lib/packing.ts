export interface PackingItemLike {
  id: string;
  name: string;
  categoryId: string;
  quantity: number;
  packed: boolean;
  assignedTo: string | null;
  isShared: boolean;
  ownerId: string | null;
}

export interface Progress {
  packed: number;
  total: number;
  percent: number; // whole percent (rounded), 0 when empty
}

export function packingProgress(items: Pick<PackingItemLike, 'packed'>[]): Progress {
  const total = items.length;
  const packed = items.filter((i) => i.packed).length;
  return { packed, total, percent: total === 0 ? 0 : Math.round((packed * 100) / total) };
}

/** Personal items are visible only to their owner; shared items to every member. */
export function visibleItems<T extends PackingItemLike>(items: T[], userId: string): T[] {
  return items.filter((i) => i.isShared || i.ownerId === userId);
}

export function itemsFor(items: PackingItemLike[], opts: { shared: boolean; userId: string }): PackingItemLike[] {
  return opts.shared ? items.filter((i) => i.isShared) : items.filter((i) => !i.isShared && i.ownerId === opts.userId);
}

export function groupByCategory<T extends PackingItemLike>(items: T[], categoryIds: string[]): Map<string, T[]> {
  const m = new Map<string, T[]>(categoryIds.map((id) => [id, []]));
  for (const it of items) m.get(it.categoryId)?.push(it);
  return m;
}

export function assignedProgress(items: PackingItemLike[], userId: string): Progress {
  return packingProgress(items.filter((i) => i.assignedTo === userId));
}

export interface TemplateCategory {
  name: string;
  items: (string | [string, number])[];
}
export interface PackingTemplate {
  id: string;
  name: string;
  categories: TemplateCategory[];
}

const BASICS: TemplateCategory = { name: 'Travel Essentials', items: ['Wallet', 'ID', 'Phone charger', 'Keys'] };
const TOILETRIES: TemplateCategory = { name: 'Toiletries', items: ['Toothbrush', 'Toothpaste', 'Deodorant', 'Shampoo', 'Medications'] };

export const PACKING_TEMPLATES: PackingTemplate[] = [
  {
    id: 'weekend',
    name: 'Weekend Trip',
    categories: [
      { name: 'Clothing', items: [['Shirts', 3], ['Pants', 2], ['Underwear', 3], ['Socks', 3], 'Pajamas', 'Comfortable shoes'] },
      TOILETRIES,
      BASICS,
    ],
  },
  {
    id: 'beach',
    name: 'Beach Vacation',
    categories: [
      { name: 'Clothing', items: [['Swimsuits', 2], ['Shorts', 3], ['Shirts', 5], ['Underwear', 7], 'Cover-up', 'Sandals', 'Sun hat'] },
      { name: 'Beach Gear', items: ['Sunscreen', 'Sunglasses', 'Beach towel', 'Reusable water bottle', 'Dry bag'] },
      TOILETRIES,
      BASICS,
    ],
  },
  {
    id: 'business',
    name: 'Business Trip',
    categories: [
      { name: 'Clothing', items: [['Dress shirts', 4], ['Slacks', 3], ['Underwear', 5], ['Socks', 5], 'Blazer', 'Dress shoes', 'Belt'] },
      { name: 'Work', items: ['Laptop', 'Laptop charger', 'Business cards', 'Notebook', 'Presentation files'] },
      TOILETRIES,
      BASICS,
    ],
  },
  {
    id: 'international',
    name: 'International Trip',
    categories: [
      { name: 'Documents', items: ['Passport', 'Visa / entry documents', 'Travel insurance', 'Copies of documents', 'Local currency'] },
      { name: 'Clothing', items: [['Shirts', 5], ['Pants', 3], ['Underwear', 7], ['Socks', 7], 'Jacket', 'Walking shoes'] },
      { name: 'Electronics', items: ['Power adapter', 'Phone charger', 'Portable battery', 'Headphones'] },
      TOILETRIES,
      BASICS,
    ],
  },
  {
    id: 'roadtrip',
    name: 'Road Trip',
    categories: [
      { name: 'Car', items: ['Driver\'s license', 'Registration & insurance', 'Phone mount', 'Car charger', 'Spare tire check', 'Emergency kit'] },
      { name: 'Snacks & Drinks', items: ['Water', 'Snacks', 'Cooler', 'Napkins'] },
      { name: 'Clothing', items: [['Shirts', 4], ['Pants', 2], ['Underwear', 4], ['Socks', 4], 'Jacket'] },
      { name: 'Entertainment', items: ['Playlist / podcasts', 'Games', 'Paper maps (backup)'] },
      TOILETRIES,
      BASICS,
    ],
  },
];

export function expandTemplate(t: PackingTemplate) {
  return t.categories.map((c) => ({
    name: c.name,
    items: c.items.map((i) => (Array.isArray(i) ? { name: i[0], quantity: i[1] } : { name: i, quantity: 1 })),
  }));
}
