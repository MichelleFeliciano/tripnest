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

-- ───────────── privileges: anonymous users get nothing ─────────────
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

-- ───────────── profiles ─────────────
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_trip_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- ───────────── trips ─────────────
create policy trips_select on public.trips for select to authenticated
  using (owner_id = auth.uid() or public.is_trip_member(id));
create policy trips_insert on public.trips for insert to authenticated
  with check (owner_id = auth.uid());
create policy trips_update on public.trips for update to authenticated
  using (public.is_trip_owner(id)) with check (public.is_trip_owner(id));
create policy trips_delete on public.trips for delete to authenticated
  using (public.is_trip_owner(id));

-- ───────────── members ─────────────
create policy members_select on public.trip_members for select to authenticated
  using (public.is_trip_member(trip_id));
create policy members_update on public.trip_members for update to authenticated
  using (public.is_trip_owner(trip_id) and role <> 'owner')
  with check (public.is_trip_owner(trip_id) and role in ('editor','viewer'));
create policy members_delete on public.trip_members for delete to authenticated
  using (role <> 'owner' and (public.is_trip_owner(trip_id) or user_id = auth.uid()));

-- ───────────── invitations (read/revoke only; creation & acceptance via RPC) ─────────────
create policy invitations_select on public.trip_invitations for select to authenticated
  using (public.can_edit_trip(trip_id));
create policy invitations_delete on public.trip_invitations for delete to authenticated
  using (public.is_trip_owner(trip_id) or (invited_by = auth.uid() and public.can_edit_trip(trip_id)));

-- ───────────── simple trip-scoped tables ─────────────
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

-- ───────────── packing: shared lists need editor; personal lists belong to their owner ─────────────
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

-- ───────────── expenses & settlements: read for members; delete via policy; writes via RPC ─────────────
create policy expenses_select on public.expenses for select to authenticated using (public.is_trip_member(trip_id));
grant delete on public.expenses to authenticated;
create policy expenses_delete on public.expenses for delete to authenticated
  using (public.is_trip_owner(trip_id) or (created_by = auth.uid() and public.can_edit_trip(trip_id)));

create policy splits_select on public.expense_splits for select to authenticated
  using (exists (select 1 from public.expenses e where e.id = expense_id and public.is_trip_member(e.trip_id)));

create policy settlements_select on public.settlements for select to authenticated using (public.is_trip_member(trip_id));
-- settlements are append-only: no update/delete policy exists, and privileges are revoked above.

-- ───────────── documents ─────────────
create policy documents_select on public.documents for select to authenticated using (public.is_trip_member(trip_id));
create policy documents_insert on public.documents for insert to authenticated
  with check (public.can_edit_trip(trip_id) and uploaded_by = auth.uid());
create policy documents_delete on public.documents for delete to authenticated
  using (public.is_trip_owner(trip_id) or (uploaded_by = auth.uid() and public.can_edit_trip(trip_id)));

-- ───────────── reserved tables ─────────────
create policy share_tokens_select on public.secure_share_tokens for select to authenticated using (public.is_trip_owner(trip_id));
create policy ai_cache_select on public.ai_cache for select to authenticated using (public.is_trip_member(trip_id));

-- ═════════════════════════ RPCs ═════════════════════════

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

-- Record that a debt was paid (a ledger entry only; no money moves). Append-only.
create or replace function public.record_settlement(p_trip uuid, p_from uuid, p_to uuid, p_amount bigint, p_currency text, p_date date, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.can_edit_trip(p_trip) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if not (public.is_member_of(p_trip, p_from) and public.is_member_of(p_trip, p_to)) then
    raise exception 'Both people must be trip members' using errcode = '23503';
  end if;
  insert into public.settlements (trip_id, from_user, to_user, amount_cents, currency, settled_on, note, recorded_by)
  values (p_trip, p_from, p_to, p_amount, p_currency, coalesce(p_date, current_date), nullif(p_note, ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Re-apply function grants for anything created above.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
-- trigger-only functions need no client access
revoke execute on function public.handle_new_user(), public.add_owner_member(), public.check_expense_total(),
  public.check_note_target(), public.check_packing_assignee(), public.set_updated_at() from authenticated;
