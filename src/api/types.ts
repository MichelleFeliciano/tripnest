import type { ItemType } from '../lib/itinerary';
import type { SplitMethod } from '../lib/splits';
import type { ExpenseCategory, BudgetCategory } from '../lib/budget';
import type { TripStatus } from '../lib/trip';

/**
 * Everything is stored on the device. People who share a trip are "travelers": just names, not accounts.
 * Fields named user_id / paid_by / assigned_to / owner_id / from_user / to_user all hold a traveler id.
 */
export interface Trip {
  id: string;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string;
  cover_image_url: string | null;
  primary_destination: string | null;
  status: TripStatus;
  notes: string | null;
  default_currency: string;
  budget_near_pct: number;
  created_at: string;
}
export interface Traveler {
  id: string;
  trip_id: string;
  name: string;
  /** The traveler this device's owner is (drives "you owe…" wording and the personal packing list). */
  is_me: boolean;
  sort_order: number;
}
export interface Destination {
  id: string;
  trip_id: string;
  name: string;
  country: string | null;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  arrival_date: string | null;
  departure_date: string | null;
  sort_order: number;
}
export interface ItineraryRow {
  id: string;
  trip_id: string;
  destination_id: string | null;
  local_date: string;
  start_at: string | null;
  start_tz: string | null;
  end_at: string | null;
  end_tz: string | null;
  title: string;
  description: string | null;
  item_type: ItemType;
  location_name: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  cost_cents: number | null;
  currency: string | null;
  confirmation_number: string | null;
  website: string | null;
  contact: string | null;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
}
export type ReservationKind = 'flight' | 'hotel' | 'restaurant' | 'activity' | 'car_rental' | 'other';
export interface Reservation {
  id: string;
  trip_id: string;
  itinerary_item_id: string | null;
  kind: ReservationKind;
  title: string;
  provider: string | null;
  confirmation_number: string | null;
  starts_at: string | null;
  starts_tz: string | null;
  ends_at: string | null;
  ends_tz: string | null;
  website: string | null;
  phone: string | null;
  address: string | null;
  details: Record<string, string>;
  notes: string | null;
}
export interface PackingCategory {
  id: string;
  trip_id: string;
  name: string;
  is_shared: boolean;
  owner_id: string | null;
  sort_order: number;
}
export interface PackingItem {
  id: string;
  trip_id: string;
  category_id: string;
  name: string;
  quantity: number;
  packed: boolean;
  assigned_to: string | null;
  notes: string | null;
  is_shared: boolean;
  owner_id: string | null;
  created_at: string;
}
export interface Expense {
  id: string;
  trip_id: string;
  paid_by: string;
  description: string;
  amount_cents: number;
  currency: string;
  expense_date: string;
  category: ExpenseCategory;
  notes: string | null;
  itinerary_item_id: string | null;
  split_method: SplitMethod;
  created_at: string;
  expense_splits: { user_id: string; amount_cents: number; share_value: number | null }[];
}
export interface Settlement {
  id: string;
  trip_id: string;
  from_user: string;
  to_user: string;
  amount_cents: number;
  currency: string;
  settled_on: string;
  note: string | null;
  created_at: string;
}
export interface BudgetRowDb {
  id: string;
  trip_id: string;
  category: BudgetCategory | null;
  amount_cents: number;
  currency: string;
}
export type NoteScope = 'trip' | 'destination' | 'itinerary' | 'reservation';
export interface Note {
  id: string;
  trip_id: string;
  scope: NoteScope;
  target_id: string | null;
  body: string;
  created_at: string;
}
export interface DocumentRow {
  id: string;
  trip_id: string;
  itinerary_item_id: string | null;
  reservation_id: string | null;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

/** A pre-trip to-do item (book flights, check passport...). */
export interface Task {
  id: string;
  trip_id: string;
  title: string;
  due_date: string | null;
  done: boolean;
  notes: string | null;
  created_at: string;
}

export interface TripData {
  trip: Trip;
  /** Traveler id of "me" on this device. */
  me: string;
  travelers: Traveler[];
  destinations: Destination[];
  items: ItineraryRow[];
  reservations: Reservation[];
  packingCategories: PackingCategory[];
  packingItems: PackingItem[];
  expenses: Expense[];
  settlements: Settlement[];
  budgets: BudgetRowDb[];
  notes: Note[];
  documents: DocumentRow[];
  tasks: Task[];
}
