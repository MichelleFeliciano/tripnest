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
