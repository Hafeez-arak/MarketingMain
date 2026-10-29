-- ─── v2 Catalog, part 2: datasheets and pictures ───────────────────────────
-- 2026-10-30. An item may carry a datasheet (PDF or image) and a picture
-- (JPG, PNG or WebP), 20 MB each, in the private bucket 'catalog-files'
-- under <workspace>/<item>/<file>.
--
--   · Manage uploads; View reads.
--   · A new file replaces the item's path (catalog_items.datasheet_path /
--     image_path); the old file STAYS in storage, Musa keeps it. So no
--     person can delete or overwrite a file while its company exists.
--   · The one delete allowed is clean-up after a company has been deleted
--     (Settings → Delete company, src/lib/workspaceFiles.js): the company's
--     row is gone and the person is the access admin.
--
-- v2 ONLY: the local v2 database (dev/v2db). Safe to re-run.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('catalog-files', 'catalog-files', false, 20971520,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 20971520,
  allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

-- Path: <workspace>/<item>/<file>. The first folder is the company, the
-- second the item; a path that is not two real ids reaches nobody. Writing
-- also needs the item to exist in that company.
create or replace function public.catalog_folder_ok(path text, need_manage boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare ws uuid; it uuid; parts text[];
begin
  parts := string_to_array(path, '/');
  if array_length(parts, 1) is null or array_length(parts, 1) < 3 then return false; end if;
  begin
    ws := parts[1]::uuid; it := parts[2]::uuid;
  exception when others then
    return false;
  end;
  if need_manage then
    return public.has_section(ws, 'catalog', 'manage')
       and exists (select 1 from public.catalog_items i where i.workspace_id = ws and i.id = it);
  end if;
  return public.has_section(ws, 'catalog', 'view');
end $$;
revoke all on function public.catalog_folder_ok(text, boolean) from public, anon;
grant execute on function public.catalog_folder_ok(text, boolean) to authenticated;

-- Is this path a company that no longer exists, and the person the access admin?
create or replace function public.catalog_orphan_ok(path text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare ws uuid;
begin
  begin
    ws := (string_to_array(path, '/'))[1]::uuid;
  exception when others then
    return false;
  end;
  return public.is_access_admin() and not exists (select 1 from public.workspaces w where w.id = ws);
end $$;
revoke all on function public.catalog_orphan_ok(text) from public, anon;
grant execute on function public.catalog_orphan_ok(text) to authenticated;

drop policy if exists "catalog-files read" on storage.objects;
create policy "catalog-files read" on storage.objects for select to authenticated
  using (bucket_id = 'catalog-files' and (public.catalog_folder_ok(name, false) or public.catalog_orphan_ok(name)));
drop policy if exists "catalog-files insert" on storage.objects;
create policy "catalog-files insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'catalog-files' and public.catalog_folder_ok(name, true));
-- No update policy: a file is never overwritten.
drop policy if exists "catalog-files delete" on storage.objects;
create policy "catalog-files delete" on storage.objects for delete to authenticated
  using (bucket_id = 'catalog-files' and public.catalog_orphan_ok(name));
