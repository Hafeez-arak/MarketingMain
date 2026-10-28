-- ─── Contacts: deleting a company works again (2026-10-28) ─────────────────
-- Found by the CRM rebuild: deleting any company that holds a Contacts
-- organisation failed. The cascade deletes its organisations and people, the
-- history trigger (contacts_log) then wrote a 'delete' row for each one under
-- the company being deleted, and that row's foreign key refused it, failing
-- the whole delete. The trigger now records nothing when the company itself
-- is gone. Everything else it does is unchanged.
--
-- v2 ONLY: the local v2 database (dev/v2db). Safe to re-run.

create or replace function public.contacts_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  rec jsonb := coalesce(n, o);
  diff jsonb := '{}'::jsonb;
  k text;
begin
  -- Deleting a whole company deletes its organisations and people with it
  -- (on delete cascade). Their history goes with the company, so there is
  -- nothing to record, and a row naming the vanished company would be
  -- refused by its foreign key, failing the whole delete.
  if tg_op = 'DELETE' and not exists (select 1 from public.workspaces where id = (rec ->> 'workspace_id')::uuid) then
    return null;
  end if;
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      if k not in ('updated_at', 'updated_by', 'created_at', 'created_by', 'archived_at', 'archived_by')
         and (o -> k) is distinct from (n -> k) then
        diff := diff || jsonb_build_object(k, jsonb_build_array(o -> k, n -> k));
      end if;
    end loop;
    if diff = '{}'::jsonb then
      return null;
    end if;
  end if;
  insert into public.contacts_activity (workspace_id, org_id, person_id, action, label, changes, actor)
  values (
    (rec ->> 'workspace_id')::uuid,
    case when tg_table_name = 'contacts_orgs' then (rec ->> 'id')::uuid else (rec ->> 'org_id')::uuid end,
    case when tg_table_name = 'contacts_people' then (rec ->> 'id')::uuid end,
    lower(tg_op), coalesce(rec ->> 'name', ''), diff, auth.uid());
  return null;
end;
$$;
