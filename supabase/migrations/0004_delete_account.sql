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
