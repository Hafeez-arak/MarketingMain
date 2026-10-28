-- ─── v2 HR parity, part 2: papers ──────────────────────────────────────────
-- 2026-10-29. Papers (identity and work documents) keep his rules (seven
-- types, "other" says what it is, expiry not before issue, 60-day warning).
-- Two changes:
--
--   · who: his hr.manage — Manage here — adds, edits and deletes papers and
--     reads everyone's. A person whose login is linked to the employee also
--     reads their own (a kindness of ours, kept from the first port).
--   · a scan or photo may be attached to a paper. NOTE: his employee papers
--     have no file at all (only his finance documents take an image); this is
--     an addition asked for in the brief, optional on every paper.
--     Files go to the private bucket 'hr-papers' under <workspace>/<employee>/
--     and only Manage (or the person themselves, for reading) reaches them.
--     Deleting a company removes the folder (src/lib/workspaceFiles.js).
--
-- v2 ONLY: the local v2 database (dev/v2db). Safe to re-run.

alter table public.hr_documents add column if not exists file_path text;
alter table public.hr_documents add column if not exists file_name text;
alter table public.hr_documents add column if not exists file_size integer;
alter table public.hr_documents add column if not exists file_type text;
do $$ begin
  -- A file lives in its own company's folder and its own employee's subfolder.
  alter table public.hr_documents add constraint hr_documents_file_place
    check (file_path is null or file_path like workspace_id::text || '/' || employee_id::text || '/%');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.hr_documents add constraint hr_documents_file_size
    check (file_size is null or file_size between 1 and 10485760);
exception when duplicate_object then null; end $$;

-- Papers: Manage writes; Manage (or the person, with View) reads.
drop policy if exists hr_documents_read on public.hr_documents;
create policy hr_documents_read on public.hr_documents for select to authenticated
  using (public.has_section(workspace_id, 'hr', 'manage')
         or (public.has_section(workspace_id, 'hr', 'view') and employee_id = public.hr_my_employee(workspace_id)));
drop policy if exists hr_documents_write on public.hr_documents;
create policy hr_documents_write on public.hr_documents for all to authenticated
  using (public.has_section(workspace_id, 'hr', 'manage'))
  with check (public.has_section(workspace_id, 'hr', 'manage'));

-- ── The bucket: private, 10 MB, scans and photos only ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hr-papers', 'hr-papers', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 10485760,
  allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

-- Path: <workspace>/<employee>/<file>. The first folder is the company, the
-- second the person; a path that is not two real ids reaches nobody.
create or replace function public.hr_papers_folder_ok(path text, need_manage boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare ws uuid; emp uuid; parts text[];
begin
  parts := string_to_array(path, '/');
  if array_length(parts, 1) is null or array_length(parts, 1) < 3 then return false; end if;
  begin
    ws := parts[1]::uuid; emp := parts[2]::uuid;
  exception when others then
    return false;
  end;
  if public.has_section(ws, 'hr', 'manage') then return true; end if;
  if need_manage then return false; end if;
  return public.has_section(ws, 'hr', 'view') and emp = public.hr_my_employee(ws);
end $$;
revoke all on function public.hr_papers_folder_ok(text, boolean) from public, anon;
grant execute on function public.hr_papers_folder_ok(text, boolean) to authenticated;

drop policy if exists "hr-papers read" on storage.objects;
create policy "hr-papers read" on storage.objects for select to authenticated
  using (bucket_id = 'hr-papers' and public.hr_papers_folder_ok(name, false));
drop policy if exists "hr-papers insert" on storage.objects;
create policy "hr-papers insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'hr-papers' and public.hr_papers_folder_ok(name, true));
drop policy if exists "hr-papers update" on storage.objects;
create policy "hr-papers update" on storage.objects for update to authenticated
  using (bucket_id = 'hr-papers' and public.hr_papers_folder_ok(name, true));
drop policy if exists "hr-papers delete" on storage.objects;
create policy "hr-papers delete" on storage.objects for delete to authenticated
  using (bucket_id = 'hr-papers' and public.hr_papers_folder_ok(name, true));
