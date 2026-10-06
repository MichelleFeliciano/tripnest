-- ===== 0001_schema.sql =====
-- TripNest schema. Money is stored as integer minor units (amount_cents). See docs/DATABASE.md.
-- "users" = Supabase auth.users; "profiles" extends it.

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ profiles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ trips & members â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ invitations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ destinations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ itinerary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ reservations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ packing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ expenses â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict default auth.uid(),
  paid_by uuid not null references auth.users(id) on delete restrict,
  description text not null check (char_length(btrim(description)) between 1 and 200),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
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

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ settlements (append-only ledger) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  from_user uuid not null references auth.users(id) on delete restrict, -- paid
  to_user uuid not null references auth.users(id) on delete restrict,   -- received
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  settled_on date not null default current_date,
  note text check (char_length(note) <= 500),
  recorded_by uuid not null references auth.users(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  constraint settlements_distinct_people check (from_user <> to_user)
);
create index settlements_trip_idx on public.settlements(trip_id);

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ budgets â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ notes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ documents (metadata; files live in private storage) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ reserved for read-only sharing / AI cache â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

-- ===== 0002_security.sql =====
-- Row-level security, privileges and transactional RPCs. See docs/SECURITY.md.
-- Principle: every table has RLS enabled; anything that must satisfy a cross-row invariant
-- (expenses+splits, settlements, invitations, membership) is written ONLY through SECURITY DEFINER
-- functions that re-check the caller's role, and direct writes are revoked.

alter table public.profiles enable row level security;
alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.trip_invitations enable row level security;
alter table public.destinations enable row level security;
alter table public.itinerary_items enable row level security;
alter table public.reservations enable row level security;
alter table public.packing_categories enable row level security;
alter table public.packing_items enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_splits enable row level security;
alter table public.settlements enable row level security;
alter table public.budgets enable row level security;
alter table public.notes enable row level security;
alter table public.documents enable row level security;
alter table public.secure_share_tokens enable row level security;
alter table public.ai_cache enable row level security;

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ privileges: anonymous users get nothing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;
revoke execute on all functions in schema public from public;
grant execute on all functions in schema public to authenticated;

-- RPC-only tables: no direct writes from clients.
revoke insert, update, delete on public.expenses, public.expense_splits, public.settlements, public.ai_cache from authenticated;
revoke insert, update on public.trip_members from authenticated;
revoke insert, update, delete on public.trip_invitations from authenticated;
revoke insert, update on public.secure_share_tokens from authenticated;
grant update (role) on public.trip_members to authenticated;
-- hide token hashes from clients entirely
revoke select on public.trip_invitations from authenticated;
grant select (id, trip_id, email, role, status, invited_by, expires_at, created_at, responded_at) on public.trip_invitations to authenticated;
grant delete on public.trip_invitations to authenticated;
-- column-level: users cannot reassign trip ownership or forge profile emails
revoke update on public.trips from authenticated;
grant update (name, description, start_date, end_date, cover_image_url, primary_destination, status, notes, default_currency, budget_near_pct) on public.trips to authenticated;
revoke update on public.profiles from authenticated;
grant update (display_name, avatar_url, home_timezone) on public.profiles to authenticated;
revoke insert, delete on public.profiles from authenticated;

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ profiles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_trip_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ trips â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create policy trips_select on public.trips for select to authenticated
  using (owner_id = auth.uid() or public.is_trip_member(id));
create policy trips_insert on public.trips for insert to authenticated
  with check (owner_id = auth.uid());
create policy trips_update on public.trips for update to authenticated
  using (public.is_trip_owner(id)) with check (public.is_trip_owner(id));
create policy trips_delete on public.trips for delete to authenticated
  using (public.is_trip_owner(id));

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ members â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create policy members_select on public.trip_members for select to authenticated
  using (public.is_trip_member(trip_id));
create policy members_update on public.trip_members for update to authenticated
  using (public.is_trip_owner(trip_id) and role <> 'owner')
  with check (public.is_trip_owner(trip_id) and role in ('editor','viewer'));
create policy members_delete on public.trip_members for delete to authenticated
  using (role <> 'owner' and (public.is_trip_owner(trip_id) or user_id = auth.uid()));

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ invitations (read/revoke only; creation & acceptance via RPC) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create policy invitations_select on public.trip_invitations for select to authenticated
  using (public.can_edit_trip(trip_id));
create policy invitations_delete on public.trip_invitations for delete to authenticated
  using (public.is_trip_owner(trip_id) or (invited_by = auth.uid() and public.can_edit_trip(trip_id)));

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ simple trip-scoped tables â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
do $$
declare t text;
begin
  foreach t in array array['destinations','itinerary_items','reservations','budgets'] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_trip_member(trip_id))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.can_edit_trip(trip_id))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.can_edit_trip(trip_id)) with check (public.can_edit_trip(trip_id))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.can_edit_trip(trip_id))', t || '_delete', t);
  end loop;
end $$;

-- notes: editors write; editors change their own, owner any
create policy notes_select on public.notes for select to authenticated using (public.is_trip_member(trip_id));
create policy notes_insert on public.notes for insert to authenticated
  with check (public.can_edit_trip(trip_id) and created_by = auth.uid());
create policy notes_update on public.notes for update to authenticated
  using (public.can_edit_trip(trip_id) and (created_by = auth.uid() or public.is_trip_owner(trip_id)))
  with check (public.can_edit_trip(trip_id));
create policy notes_delete on public.notes for delete to authenticated
  using (public.can_edit_trip(trip_id) and (created_by = auth.uid() or public.is_trip_owner(trip_id)));

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ packing: shared lists need editor; personal lists belong to their owner â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
do $$
declare t text;
begin
  foreach t in array array['packing_categories','packing_items'] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_trip_member(trip_id) and (is_shared or owner_id = auth.uid()))', t || '_select', t);
    execute format($p$create policy %I on public.%I for insert to authenticated with check (
      (is_shared and public.can_edit_trip(trip_id)) or (not is_shared and owner_id = auth.uid() and public.is_trip_member(trip_id)))$p$, t || '_insert', t);
    execute format($p$create policy %I on public.%I for update to authenticated using (
      (is_shared and public.can_edit_trip(trip_id)) or (not is_shared and owner_id = auth.uid() and public.is_trip_member(trip_id)))
      with check ((is_shared and public.can_edit_trip(trip_id)) or (not is_shared and owner_id = auth.uid() and public.is_trip_member(trip_id)))$p$, t || '_update', t);
    execute format($p$create policy %I on public.%I for delete to authenticated using (
      (is_shared and public.can_edit_trip(trip_id)) or (not is_shared and owner_id = auth.uid() and public.is_trip_member(trip_id)))$p$, t || '_delete', t);
  end loop;
end $$;

create or replace function public.check_packing_assignee() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.assigned_to is not null and not public.is_member_of(new.trip_id, new.assigned_to) then
    raise exception 'Assignee is not a member of this trip' using errcode = '23503';
  end if;
  return new;
end $$;
create trigger packing_items_assignee before insert or update on public.packing_items
  for each row execute function public.check_packing_assignee();

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ expenses & settlements: read for members; delete via policy; writes via RPC â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create policy expenses_select on public.expenses for select to authenticated using (public.is_trip_member(trip_id));
grant delete on public.expenses to authenticated;
create policy expenses_delete on public.expenses for delete to authenticated
  using (public.is_trip_owner(trip_id) or (created_by = auth.uid() and public.can_edit_trip(trip_id)));

create policy splits_select on public.expense_splits for select to authenticated
  using (exists (select 1 from public.expenses e where e.id = expense_id and public.is_trip_member(e.trip_id)));

create policy settlements_select on public.settlements for select to authenticated using (public.is_trip_member(trip_id));
-- settlements are append-only: no update/delete policy exists, and privileges are revoked above.

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ documents â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create policy documents_select on public.documents for select to authenticated using (public.is_trip_member(trip_id));
create policy documents_insert on public.documents for insert to authenticated
  with check (public.can_edit_trip(trip_id) and uploaded_by = auth.uid());
create policy documents_delete on public.documents for delete to authenticated
  using (public.is_trip_owner(trip_id) or (uploaded_by = auth.uid() and public.can_edit_trip(trip_id)));

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ reserved tables â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create policy share_tokens_select on public.secure_share_tokens for select to authenticated using (public.is_trip_owner(trip_id));
create policy ai_cache_select on public.ai_cache for select to authenticated using (public.is_trip_member(trip_id));

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• RPCs â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

create or replace function public.hash_token(p_token text) returns text
language sql immutable as $$ select encode(sha256(convert_to(p_token, 'UTF8')), 'hex') $$;

-- Returns the raw token ONCE. Only its hash is stored.
create or replace function public.create_invitation(p_trip uuid, p_email text, p_role text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(btrim(p_email));
  v_token text;
begin
  if auth.uid() is null or not public.can_edit_trip(p_trip) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_role not in ('editor','viewer') then raise exception 'Invalid role' using errcode = '22023'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    raise exception 'Invalid email address' using errcode = '22023';
  end if;
  if exists (select 1 from public.trip_members m join public.profiles p on p.id = m.user_id where m.trip_id = p_trip and p.email = v_email) then
    raise exception 'That person is already on this trip' using errcode = '23505';
  end if;
  -- simple abuse limits
  if (select count(*) from public.trip_invitations where trip_id = p_trip and status = 'pending' and expires_at > now()) >= 25 then
    raise exception 'Too many pending invitations for this trip' using errcode = '54000';
  end if;
  if (select count(*) from public.trip_invitations where invited_by = auth.uid() and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Invitation limit reached, try again later' using errcode = '54000';
  end if;
  delete from public.trip_invitations where trip_id = p_trip and email = v_email and status <> 'accepted';
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.trip_invitations (trip_id, email, role, token_hash, invited_by)
  values (p_trip, v_email, p_role, public.hash_token(v_token), auth.uid());
  return v_token;
end $$;

-- What the invitee sees before accepting. Identical error for unknown token / wrong account (no enumeration).
create or replace function public.invitation_preview(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare inv public.trip_invitations; t_name text;
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  select * into inv from public.trip_invitations where token_hash = public.hash_token(p_token);
  if not found or inv.email <> lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;
  select name into t_name from public.trips where id = inv.trip_id;
  return jsonb_build_object(
    'trip_name', t_name, 'role', inv.role, 'expires_at', inv.expires_at,
    'status', case when inv.status = 'pending' and inv.expires_at < now() then 'expired' else inv.status end);
end $$;

create or replace function public.accept_invitation(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare inv public.trip_invitations;
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  select * into inv from public.trip_invitations where token_hash = public.hash_token(p_token) for update;
  if not found or inv.email <> lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;
  if inv.status = 'pending' and inv.expires_at < now() then
    update public.trip_invitations set status = 'expired', responded_at = now() where id = inv.id;
    return jsonb_build_object('status', 'expired');
  end if;
  if inv.status <> 'pending' then return jsonb_build_object('status', inv.status); end if;
  insert into public.trip_members (trip_id, user_id, role) values (inv.trip_id, auth.uid(), inv.role)
    on conflict (trip_id, user_id) do nothing;
  update public.trip_invitations set status = 'accepted', responded_at = now() where id = inv.id;
  return jsonb_build_object('status', 'accepted', 'trip_id', inv.trip_id);
end $$;

create or replace function public.decline_invitation(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare inv public.trip_invitations;
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  select * into inv from public.trip_invitations where token_hash = public.hash_token(p_token) for update;
  if not found or inv.email <> lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;
  if inv.status = 'pending' then
    update public.trip_invitations set status = case when inv.expires_at < now() then 'expired' else 'declined' end, responded_at = now() where id = inv.id;
  end if;
  return jsonb_build_object('status', (select status from public.trip_invitations where id = inv.id));
end $$;

-- Create/update an expense and its splits atomically. Amounts are integer minor units.
create or replace function public.save_expense(p_trip uuid, p_expense_id uuid, p_data jsonb, p_splits jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_role text := public.trip_role(p_trip);
  v_paid uuid := (p_data ->> 'paid_by')::uuid;
  v_amount bigint := (p_data ->> 'amount_cents')::bigint;
  v_creator uuid;
  v_id uuid;
  v_sum bigint := 0;
  s jsonb;
begin
  if v_role is null or v_role not in ('owner','editor') then raise exception 'Not allowed' using errcode = '42501'; end if;
  if v_amount is null or v_amount <= 0 then raise exception 'Amount must be greater than zero' using errcode = '23514'; end if;
  if not public.is_member_of(p_trip, v_paid) then raise exception 'Payer must be a trip member' using errcode = '23503'; end if;
  if jsonb_typeof(p_splits) <> 'array' or jsonb_array_length(p_splits) = 0 then
    raise exception 'An expense needs at least one split' using errcode = '23514';
  end if;
  for s in select * from jsonb_array_elements(p_splits) loop
    if not public.is_member_of(p_trip, (s ->> 'user_id')::uuid) then raise exception 'Split person must be a trip member' using errcode = '23503'; end if;
    if (s ->> 'amount_cents')::bigint < 0 then raise exception 'Split amounts cannot be negative' using errcode = '23514'; end if;
    v_sum := v_sum + (s ->> 'amount_cents')::bigint;
  end loop;
  if v_sum <> v_amount then
    raise exception 'Splits (%) must add up to the expense total (%)', v_sum, v_amount using errcode = '23514';
  end if;

  if p_expense_id is null then
    insert into public.expenses (trip_id, created_by, paid_by, description, amount_cents, currency, expense_date, category, notes, itinerary_item_id, split_method)
    values (p_trip, auth.uid(), v_paid, p_data ->> 'description', v_amount, coalesce(p_data ->> 'currency', 'USD'),
            (p_data ->> 'expense_date')::date, coalesce(p_data ->> 'category', 'Other'), nullif(p_data ->> 'notes', ''),
            nullif(p_data ->> 'itinerary_item_id', '')::uuid, p_data ->> 'split_method')
    returning id into v_id;
  else
    select created_by into v_creator from public.expenses where id = p_expense_id and trip_id = p_trip;
    if not found then raise exception 'Expense not found' using errcode = 'P0002'; end if;
    if v_role <> 'owner' and v_creator <> auth.uid() then raise exception 'Not allowed' using errcode = '42501'; end if;
    update public.expenses set paid_by = v_paid, description = p_data ->> 'description', amount_cents = v_amount,
      currency = coalesce(p_data ->> 'currency', 'USD'), expense_date = (p_data ->> 'expense_date')::date,
      category = coalesce(p_data ->> 'category', 'Other'), notes = nullif(p_data ->> 'notes', ''),
      itinerary_item_id = nullif(p_data ->> 'itinerary_item_id', '')::uuid, split_method = p_data ->> 'split_method'
    where id = p_expense_id;
    delete from public.expense_splits where expense_id = p_expense_id;
    v_id := p_expense_id;
  end if;

  insert into public.expense_splits (expense_id, user_id, amount_cents, share_value)
  select v_id, (e ->> 'user_id')::uuid, (e ->> 'amount_cents')::bigint, nullif(e ->> 'share_value', '')::numeric
  from jsonb_array_elements(p_splits) e;
  return v_id;
end $$;

create or replace function public.appears_in_expenses(t uuid, u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.expenses e where e.trip_id = t and e.paid_by = u)
      or exists (select 1 from public.expense_splits s join public.expenses e on e.id = s.expense_id where e.trip_id = t and s.user_id = u)
$$;

-- Record that a debt was paid (a ledger entry only; no money moves). Append-only.
create or replace function public.record_settlement(p_trip uuid, p_from uuid, p_to uuid, p_amount bigint, p_currency text, p_date date, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.can_edit_trip(p_trip) then raise exception 'Not allowed' using errcode = '42501'; end if;
  -- Only the payer, the receiver, or the owner may record a payment (an editor cannot forge one between others).
  if auth.uid() not in (p_from, p_to) and not public.is_trip_owner(p_trip) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  -- Both must be members, or former members who still appear in this trip's expenses (so their debts can be cleared).
  if not (public.is_member_of(p_trip, p_from) or public.appears_in_expenses(p_trip, p_from))
     or not (public.is_member_of(p_trip, p_to) or public.appears_in_expenses(p_trip, p_to)) then
    raise exception 'Both people must be trip members' using errcode = '23503';
  end if;
  insert into public.settlements (trip_id, from_user, to_user, amount_cents, currency, settled_on, note, recorded_by)
  values (p_trip, p_from, p_to, p_amount, p_currency, coalesce(p_date, current_date), nullif(p_note, ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Rows can never be moved to another trip by UPDATE.
create or replace function public.pin_trip_id() returns trigger
language plpgsql as $$
begin
  if new.trip_id is distinct from old.trip_id then
    raise exception 'trip_id cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;
do $$
declare t text;
begin
  foreach t in array array['destinations','itinerary_items','reservations','budgets','notes','packing_categories','packing_items'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.pin_trip_id()', t || '_pin_trip', t);
  end loop;
end $$;

-- A packing item must live in a category of the same visibility and owner.
create or replace function public.check_packing_category() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.packing_categories c where c.id = new.category_id
                 and c.is_shared = new.is_shared and c.owner_id is not distinct from new.owner_id) then
    raise exception 'Item must be in a category of the same list (shared or personal)' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger packing_items_category before insert or update on public.packing_items
  for each row execute function public.check_packing_category();

-- Re-apply function grants for anything created above.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
-- trigger-only functions need no client access
revoke execute on function public.is_member_of(uuid, uuid), public.appears_in_expenses(uuid, uuid) from authenticated;
revoke execute on function public.pin_trip_id(), public.check_packing_category() from authenticated;
revoke execute on function public.handle_new_user(), public.add_owner_member(), public.check_expense_total(),
  public.check_note_target(), public.check_packing_assignee(), public.set_updated_at() from authenticated;

-- ===== 0003_storage.sql =====
-- Private document storage. The bucket is NOT public: files are reachable only through
-- short-lived signed URLs minted for authenticated trip members.
-- Object path convention: <trip_id>/<random-uuid>-<sanitized-file-name>

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('trip-documents', 'trip-documents', false, 10485760,
        array['application/pdf','image/png','image/jpeg','image/webp','image/heic','text/plain'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.storage_trip_id(path text) returns uuid
language sql immutable as $$
  select case when split_part(path, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(path, '/', 1)::uuid end
$$;

create policy trip_docs_read on storage.objects for select to authenticated
  using (bucket_id = 'trip-documents' and public.is_trip_member(public.storage_trip_id(name)));
create policy trip_docs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'trip-documents' and public.can_edit_trip(public.storage_trip_id(name)));
create policy trip_docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'trip-documents' and public.can_edit_trip(public.storage_trip_id(name)));

-- ===== 0004_delete_account.sql =====
-- Self-service account deletion.
--
-- Policy:
--  * Trips you own that nobody else has joined are deleted with the account (children cascade).
--  * Trips you own that other people have joined BLOCK deletion: delete the trip or remove the members first.
--  * In trips you merely joined, your membership disappears but your financial history (expenses you paid or
--    created, your splits, payments you made/received) stays, re-attributed to a placeholder "Former traveler"
--    so other people's balances never change.

-- Placeholder identity: cannot sign in (no password, banned), never a trip member.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000dead', 'deleted-user@tripnest.invalid')
  on conflict (id) do nothing;
do $$
begin
  update auth.users set banned_until = 'infinity' where id = '00000000-0000-0000-0000-00000000dead';
exception when undefined_column then
  null; -- non-Supabase environments (tests) have no banned_until column
end $$;
update public.profiles set display_name = 'Former traveler' where id = '00000000-0000-0000-0000-00000000dead';

-- What would happen? Powers the confirmation dialog.
create or replace function public.account_deletion_preview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  return jsonb_build_object(
    'owned_with_others', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name,
               'members', (select count(*) from public.trip_members m where m.trip_id = t.id and m.user_id <> me)) order by t.name)
      from public.trips t
      where t.owner_id = me and exists (select 1 from public.trip_members m where m.trip_id = t.id and m.user_id <> me)), '[]'::jsonb),
    'owned_solo', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name)
      from public.trips t
      where t.owner_id = me and not exists (select 1 from public.trip_members m where m.trip_id = t.id and m.user_id <> me)), '[]'::jsonb),
    'shared_trips', (select count(*) from public.trip_members m join public.trips t on t.id = m.trip_id where m.user_id = me and t.owner_id <> me),
    'shared_expenses', (select count(*) from public.expenses e join public.trips t on t.id = e.trip_id
                         where t.owner_id <> me and (e.paid_by = me or e.created_by = me
                           or exists (select 1 from public.expense_splits s where s.expense_id = e.id and s.user_id = me)))
  );
end $$;

create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  tomb constant uuid := '00000000-0000-0000-0000-00000000dead';
begin
  if me is null or me = tomb then raise exception 'Not authenticated' using errcode = '28000'; end if;

  if exists (select 1 from public.trips t where t.owner_id = me
             and exists (select 1 from public.trip_members m where m.trip_id = t.id and m.user_id <> me)) then
    raise exception 'You still own trips that other people have joined. Delete those trips or remove the other travelers first.' using errcode = 'P0001';
  end if;

  -- 1. trips only you were on (children cascade)
  delete from public.trips where owner_id = me;

  -- 2. settlements: payments between two deleted people would become self-payments (net zero), so drop them
  delete from public.settlements where (from_user = me and to_user = tomb) or (from_user = tomb and to_user = me);
  update public.settlements set from_user = tomb where from_user = me;
  update public.settlements set to_user = tomb where to_user = me;
  update public.settlements set recorded_by = tomb where recorded_by = me;

  -- 3. expenses and splits (amounts preserved; splits of two deleted people on one expense are merged)
  update public.expenses set paid_by = tomb where paid_by = me;
  update public.expenses set created_by = tomb where created_by = me;
  insert into public.expense_splits (expense_id, user_id, amount_cents, share_value)
    select expense_id, tomb, amount_cents, null from public.expense_splits where user_id = me
  on conflict (expense_id, user_id) do update
    set amount_cents = public.expense_splits.amount_cents + excluded.amount_cents, share_value = null;
  delete from public.expense_splits where user_id = me;

  update public.documents set uploaded_by = tomb where uploaded_by = me;

  -- 4. the account itself (cascades profile, memberships, invitations you sent, personal packing lists)
  delete from auth.users where id = me;
end $$;

revoke execute on function public.account_deletion_preview(), public.delete_my_account() from public, anon;
grant execute on function public.account_deletion_preview(), public.delete_my_account() to authenticated;

