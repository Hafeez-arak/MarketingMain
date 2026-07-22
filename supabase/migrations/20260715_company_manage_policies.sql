-- Multi-company management from Settings → Companies.
--
-- The workspaces table has RLS that blocks direct client INSERTs (creation is
-- meant to run through a privileged path, like the signup trigger). So instead
-- of loosening that, we expose a SECURITY DEFINER function that atomically
-- creates the company AND the caller's owner membership in one call — no
-- partial workspace can exist without an owner.
--
-- Rename/delete are guarded by ordinary RLS policies (below): any member may
-- rename; only an owner may delete (delete cascades to all the company's data).
--
-- Assumes public.workspaces(id, name) and
-- public.workspace_members(workspace_id, user_id, role) already exist.

-- ── Create: atomic company + owner membership ───────────────────────────────
create or replace function public.create_company(company_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid    uuid := auth.uid();
  new_id uuid;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.workspaces (name)
    values (coalesce(nullif(trim(company_name), ''), 'My Company'))
    returning id into new_id;

  insert into public.workspace_members (workspace_id, user_id, role)
    values (new_id, uid, 'owner');

  return new_id;
end;
$$;

grant execute on function public.create_company(text) to authenticated;

-- ── Rename: any member may rename the company ───────────────────────────────
alter table public.workspaces enable row level security;

drop policy if exists workspaces_update_member on public.workspaces;
create policy workspaces_update_member on public.workspaces
  for update
  using (
    exists (
      select 1 from public.workspace_members m
      where m.workspace_id = workspaces.id
        and m.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.workspace_members m
      where m.workspace_id = workspaces.id
        and m.user_id = auth.uid()
    )
  );

-- ── Delete: only an owner may delete a company ──────────────────────────────
drop policy if exists workspaces_delete_owner on public.workspaces;
create policy workspaces_delete_owner on public.workspaces
  for delete
  using (
    exists (
      select 1 from public.workspace_members m
      where m.workspace_id = workspaces.id
        and m.user_id = auth.uid()
        and m.role = 'owner'
    )
  );
