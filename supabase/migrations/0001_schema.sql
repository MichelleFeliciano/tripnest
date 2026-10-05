-- TripNest schema. Money is stored as integer minor units (amount_cents). See docs/DATABASE.md.
-- "users" = Supabase auth.users; "profiles" extends it.

-- ───────────────────────── helpers ─────────────────────────
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ───────────────────────── profiles ─────────────────────────
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default '' check (char_length(display_name) <= 80),
  avatar_url text,
  home_timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated before update on public.profiles for each row execute function public.set_updated_at();

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, lower(new.email), coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), split_part(new.email, '@', 1)));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ───────────────────────── trips & members ─────────────────────────
create table public.trips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text check (char_length(description) <= 5000),
  start_date date not null,
  end_date date not null,
  cover_image_url text check (cover_image_url is null or cover_image_url ~* '^https://'),
  primary_destination text check (char_length(primary_destination) <= 200),
  status text not null default 'planning' check (status in ('planning','upcoming','in_progress','completed','archived')),
  notes text check (char_length(notes) <= 20000),
  default_currency text not null default 'USD' check (default_currency ~ '^[A-Z]{3}$'),
  budget_near_pct int not null default 80 check (budget_near_pct between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trips_dates_ordered check (end_date >= start_date),
  constraint trips_max_length check (end_date - start_date <= 366)
);
create index trips_owner_idx on public.trips(owner_id);
create trigger trips_updated before update on public.trips for each row execute function public.set_updated_at();

create table public.trip_members (
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','editor','viewer')),
  created_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);
create index trip_members_user_idx on public.trip_members(user_id);
create unique index trip_members_one_owner on public.trip_members(trip_id) where role = 'owner';

-- the creator becomes the owner member automatically
create or replace function public.add_owner_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.trip_members (trip_id, user_id, role) values (new.id, new.owner_id, 'owner');
  return new;
end $$;
create trigger trips_add_owner after insert on public.trips for each row execute function public.add_owner_member();

-- Permission helpers. SECURITY DEFINER so policies can consult trip_members without recursion.
create or replace function public.trip_role(t uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from public.trip_members where trip_id = t and user_id = auth.uid()
$$;
create or replace function public.is_trip_member(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.trip_members where trip_id = t and user_id = auth.uid())
$$;
create or replace function public.can_edit_trip(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.trip_members where trip_id = t and user_id = auth.uid() and role in ('owner','editor'))
$$;
create or replace function public.is_trip_owner(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.trip_members where trip_id = t and user_id = auth.uid() and role = 'owner')
$$;
create or replace function public.is_member_of(t uuid, u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.trip_members where trip_id = t and user_id = u)
$$;
create or replace function public.shares_trip_with(u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.trip_members a join public.trip_members b on a.trip_id = b.trip_id
    where a.user_id = auth.uid() and b.user_id = u)
$$;

-- ───────────────────────── invitations ─────────────────────────
-- Only a SHA-256 hash of the token is stored; the raw token is returned once by create_invitation().
create table public.trip_invitations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  email text not null check (email = lower(email) and char_length(email) between 3 and 254),
  role text not null check (role in ('editor','viewer')),
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending','accepted','declined','expired')),
  invited_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);
create index trip_invitations_trip_idx on public.trip_invitations(trip_id);
create unique index trip_invitations_one_pending on public.trip_invitations(trip_id, email) where status = 'pending';

-- ───────────────────────── destinations ─────────────────────────
create table public.destinations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  country text check (char_length(country) <= 100),
  region text check (char_length(region) <= 100),
  latitude numeric(9,6) check (latitude between -90 and 90),
  longitude numeric(9,6) check (longitude between -180 and 180),
  notes text check (char_length(notes) <= 5000),
  arrival_date date,
  departure_date date,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint destinations_dates check (arrival_date is null or departure_date is null or departure_date >= arrival_date),
  constraint destinations_coords_pair check ((latitude is null) = (longitude is null)),
  unique (id, trip_id)
);
create index destinations_trip_idx on public.destinations(trip_id);
create trigger destinations_updated before update on public.destinations for each row execute function public.set_updated_at();

-- ───────────────────────── itinerary ─────────────────────────
-- Times: an instant (timestamptz) + the IANA zone where it happens. local_date is the calendar day at the place.
create table public.itinerary_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  destination_id uuid,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  local_date date not null,
  start_at timestamptz,
  start_tz text,
  end_at timestamptz,
  end_tz text,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (char_length(description) <= 5000),
  item_type text not null default 'activity' check (item_type in ('flight','hotel','restaurant','activity','transportation','event','meeting','free_time','other')),
  location_name text check (char_length(location_name) <= 200),
  address text check (char_length(address) <= 300),
  latitude numeric(9,6) check (latitude between -90 and 90),
  longitude numeric(9,6) check (longitude between -180 and 180),
  notes text check (char_length(notes) <= 5000),
  cost_cents bigint check (cost_cents is null or cost_cents >= 0),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  confirmation_number text check (char_length(confirmation_number) <= 100),
  website text check (website is null or website ~* '^https?://'),
  contact text check (char_length(contact) <= 300),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint itinerary_times_ordered check (start_at is null or end_at is null or end_at >= start_at),
  constraint itinerary_start_has_tz check (start_at is null or start_tz is not null),
  constraint itinerary_end_has_tz check (end_at is null or end_tz is not null),
  constraint itinerary_coords_pair check ((latitude is null) = (longitude is null)),
  unique (id, trip_id),
  foreign key (destination_id, trip_id) references public.destinations(id, trip_id) on delete set null (destination_id)
);
create index itinerary_trip_date_idx on public.itinerary_items(trip_id, local_date, start_at);
create trigger itinerary_updated before update on public.itinerary_items for each row execute function public.set_updated_at();

-- ───────────────────────── reservations ─────────────────────────
create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  itinerary_item_id uuid,
  kind text not null check (kind in ('flight','hotel','restaurant','activity','car_rental','other')),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  provider text check (char_length(provider) <= 200),
  confirmation_number text check (char_length(confirmation_number) <= 100),
  starts_at timestamptz,
  starts_tz text,
  ends_at timestamptz,
  ends_tz text,
  website text check (website is null or website ~* '^https?://'),
  phone text check (char_length(phone) <= 60),
  address text check (char_length(address) <= 300),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object' and pg_column_size(details) < 20000),
  notes text check (char_length(notes) <= 5000),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, trip_id),
  foreign key (itinerary_item_id, trip_id) references public.itinerary_items(id, trip_id) on delete set null (itinerary_item_id)
);
create index reservations_trip_idx on public.reservations(trip_id);
create trigger reservations_updated before update on public.reservations for each row execute function public.set_updated_at();

-- ───────────────────────── packing ─────────────────────────
create table public.packing_categories (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  is_shared boolean not null default true,
  owner_id uuid references auth.users(id) on delete cascade,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint packing_cat_owner check ((is_shared and owner_id is null) or (not is_shared and owner_id is not null)),
  unique (id, trip_id)
);
create index packing_categories_trip_idx on public.packing_categories(trip_id);

create table public.packing_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  category_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  quantity int not null default 1 check (quantity between 1 and 999),
  packed boolean not null default false,
  assigned_to uuid references auth.users(id) on delete set null,
  notes text check (char_length(notes) <= 1000),
  is_shared boolean not null default true,
  owner_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint packing_item_owner check ((is_shared and owner_id is null) or (not is_shared and owner_id is not null)),
  foreign key (category_id, trip_id) references public.packing_categories(id, trip_id) on delete cascade
);
create index packing_items_trip_idx on public.packing_items(trip_id);
create index packing_items_category_idx on public.packing_items(category_id);
create trigger packing_items_updated before update on public.packing_items for each row execute function public.set_updated_at();

-- ───────────────────────── expenses ─────────────────────────
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict default auth.uid(),
  paid_by uuid not null references auth.users(id) on delete restrict,
  description text not null check (char_length(btrim(description)) between 1 and 200),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000000),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  expense_date date not null,
  category text not null default 'Other' check (category in ('Lodging','Food','Transportation','Activities','Shopping','Tickets','Gas','Other')),
  notes text check (char_length(notes) <= 2000),
  itinerary_item_id uuid,
  split_method text not null check (split_method in ('equal','custom','percent','shares')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, trip_id),
  foreign key (itinerary_item_id, trip_id) references public.itinerary_items(id, trip_id) on delete set null (itinerary_item_id)
);
create index expenses_trip_idx on public.expenses(trip_id, expense_date);
create trigger expenses_updated before update on public.expenses for each row execute function public.set_updated_at();

create table public.expense_splits (
  expense_id uuid not null references public.expenses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  amount_cents bigint not null check (amount_cents >= 0),
  share_value numeric, -- the user's input (bp / shares / cents) kept for editing; informational
  primary key (expense_id, user_id)
);

-- Defense in depth: the splits of an expense must always add up to its total, checked at commit.
create or replace function public.check_expense_total() returns trigger
language plpgsql as $$
declare
  eid uuid;
  total bigint;
  split_sum bigint;
  n int;
begin
  if tg_table_name = 'expenses' then eid := new.id; else eid := new.expense_id; end if;
  select amount_cents into total from public.expenses where id = eid;
  if total is null then return null; end if; -- expense deleted in this transaction
  select coalesce(sum(amount_cents), 0), count(*) into split_sum, n from public.expense_splits where expense_id = eid;
  if n = 0 or split_sum <> total then
    raise exception 'Expense splits (%) must equal the expense total (%)', split_sum, total using errcode = '23514';
  end if;
  return null;
end $$;
create constraint trigger expenses_total_check after insert or update on public.expenses
  deferrable initially deferred for each row execute function public.check_expense_total();
create constraint trigger expense_splits_total_check after insert or update on public.expense_splits
  deferrable initially deferred for each row execute function public.check_expense_total();

-- ───────────────────────── settlements (append-only ledger) ─────────────────────────
create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  from_user uuid not null references auth.users(id) on delete restrict, -- paid
  to_user uuid not null references auth.users(id) on delete restrict,   -- received
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000000),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  settled_on date not null default current_date,
  note text check (char_length(note) <= 500),
  recorded_by uuid not null references auth.users(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  constraint settlements_distinct_people check (from_user <> to_user)
);
create index settlements_trip_idx on public.settlements(trip_id);

-- ───────────────────────── budgets ─────────────────────────
create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  category text check (category in ('Transportation','Lodging','Food','Activities','Shopping','Other')), -- null = total
  amount_cents bigint not null check (amount_cents >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (trip_id, category)
);
create trigger budgets_updated before update on public.budgets for each row execute function public.set_updated_at();

-- ───────────────────────── notes ─────────────────────────
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  scope text not null check (scope in ('trip','destination','itinerary','reservation')),
  target_id uuid,
  body text not null check (char_length(btrim(body)) between 1 and 10000),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notes_scope_target check ((scope = 'trip') = (target_id is null))
);
create index notes_trip_idx on public.notes(trip_id, scope, target_id);
create trigger notes_updated before update on public.notes for each row execute function public.set_updated_at();

-- A note's target must exist and belong to the same trip.
create or replace function public.check_note_target() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.scope = 'destination' and not exists (select 1 from public.destinations where id = new.target_id and trip_id = new.trip_id)
    or new.scope = 'itinerary' and not exists (select 1 from public.itinerary_items where id = new.target_id and trip_id = new.trip_id)
    or new.scope = 'reservation' and not exists (select 1 from public.reservations where id = new.target_id and trip_id = new.trip_id) then
    raise exception 'Note target does not belong to this trip' using errcode = '23503';
  end if;
  return new;
end $$;
create trigger notes_target_check before insert or update on public.notes for each row execute function public.check_note_target();

-- ───────────────────────── documents (metadata; files live in private storage) ─────────────────────────
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  itinerary_item_id uuid,
  reservation_id uuid,
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 200),
  mime_type text not null check (mime_type in ('application/pdf','image/png','image/jpeg','image/webp','image/heic','text/plain')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_by uuid not null references auth.users(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  constraint documents_path_in_trip check (storage_path like trip_id::text || '/%'),
  foreign key (itinerary_item_id, trip_id) references public.itinerary_items(id, trip_id) on delete set null (itinerary_item_id),
  foreign key (reservation_id, trip_id) references public.reservations(id, trip_id) on delete set null (reservation_id)
);
create index documents_trip_idx on public.documents(trip_id);

-- ───────────────────────── reserved for read-only sharing / AI cache ─────────────────────────
create table public.secure_share_tokens (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  token_hash text not null unique,
  scope text not null default 'read' check (scope = 'read'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid not null references auth.users(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now()
);
create index secure_share_tokens_trip_idx on public.secure_share_tokens(trip_id);

create table public.ai_cache (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  kind text not null check (kind in ('itinerary','packing','summary')),
  input_hash text not null,
  result jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (trip_id, kind, input_hash)
);
