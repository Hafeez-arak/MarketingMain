-- ─── v2: Contacts, the rules ───────────────────────────────────────────────
-- 2026-10-28, after 20261120_contacts_1_tables.sql. The rules a section grant
-- cannot express, in the database so the screens, the import and anything
-- written later (the CRM's "won needs a client") all meet the same ones:
--
--   · tidy: trimmed text, blanks stored as null, roles in a fixed order;
--   · one organisation per VAT number and per CR in a company (his rule),
--     said with the other organisation's name;
--   · a client company registered for VAT has its full national address;
--   · archiving and restoring are managing; an archived organisation is
--     locked (restore it first), and nobody is added to it;
--   · one primary contact per organisation: marking a new one moves it;
--   · a row never moves to another company.
--
-- The functions run as the caller (security invoker), so RLS still applies
-- to everything they read and write. A failure is an exception whose
-- message is a code (CONTACTS_…) and whose detail is the data the screen
-- needs; lib/contacts/client.js turns it into words.
--
-- v2 ONLY: the local v2 database (dev/v2db). Safe to re-run.

create or replace function public.contacts_orgs_tidy()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  canonical constant text[] := array['client', 'supplier', 'main_contractor', 'consultant', 'subcontractor', 'sister_company'];
  other     text;
  missing   text[];
begin
  new.name              := btrim(new.name);
  new.name_ar           := nullif(btrim(new.name_ar), '');
  new.vat_number        := nullif(regexp_replace(coalesce(new.vat_number, ''), '\s', '', 'g'), '');
  new.cr_number         := nullif(btrim(new.cr_number), '');
  new.country           := upper(coalesce(nullif(btrim(new.country), ''), 'SA'));
  new.nat_building_no   := nullif(btrim(new.nat_building_no), '');
  new.nat_street        := nullif(btrim(new.nat_street), '');
  new.nat_district      := nullif(btrim(new.nat_district), '');
  new.city              := nullif(btrim(new.city), '');
  new.nat_postal_code   := nullif(btrim(new.nat_postal_code), '');
  new.nat_additional_no := nullif(btrim(new.nat_additional_no), '');
  new.phone             := nullif(btrim(new.phone), '');
  new.email             := lower(nullif(btrim(new.email), ''));
  new.website           := nullif(btrim(new.website), '');
  new.notes             := coalesce(new.notes, '');
  new.roles             := coalesce(new.roles, '{}');
  -- Known roles in the fixed order, each once; an unknown one is left for
  -- the check constraint to refuse.
  if new.roles <@ canonical then
    new.roles := array(select c from unnest(canonical) with ordinality as x(c, i) where c = any(new.roles) order by i);
  end if;

  if tg_op = 'UPDATE' then
    if new.workspace_id <> old.workspace_id then
      raise exception 'CONTACTS_WORKSPACE_FIXED' using errcode = 'P0001';
    end if;
    -- Archived = locked. Only restoring it (a change of status) gets through.
    if old.status = 'archived' and new.status = 'archived' then
      raise exception 'CONTACTS_ARCHIVED' using errcode = 'P0001', detail = old.name;
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  else
    new.created_by := coalesce(new.created_by, auth.uid());
    new.created_at := now();
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();

  -- Archiving and restoring (or adding one already archived) are managing.
  -- No signed-in person (a migration, the service key): no section to ask.
  if (tg_op = 'INSERT' and new.status = 'archived') or (tg_op = 'UPDATE' and new.status <> old.status) then
    if auth.uid() is not null and not public.has_section(new.workspace_id, 'contacts', 'manage') then
      raise exception 'CONTACTS_NEEDS_MANAGE' using errcode = 'P0001';
    end if;
    if new.status = 'archived' then
      new.archived_at := now();
      new.archived_by := auth.uid();
    end if;
  end if;
  if new.status = 'active' then
    new.archived_at := null;
    new.archived_by := null;
  end if;

  -- The duplicate guard: checked only when the number is written.
  if new.vat_number is not null and (tg_op = 'INSERT' or new.vat_number is distinct from old.vat_number) then
    select o.name into other from public.contacts_orgs o
     where o.workspace_id = new.workspace_id and o.vat_number = new.vat_number and o.id <> new.id
     limit 1;
    if found then
      raise exception 'CONTACTS_DUPLICATE_VAT' using errcode = 'P0001', detail = other;
    end if;
  end if;
  if new.cr_number is not null and (tg_op = 'INSERT' or new.cr_number is distinct from old.cr_number) then
    select o.name into other from public.contacts_orgs o
     where o.workspace_id = new.workspace_id and lower(o.cr_number) = lower(new.cr_number) and o.id <> new.id
     limit 1;
    if found then
      raise exception 'CONTACTS_DUPLICATE_CR' using errcode = 'P0001', detail = other;
    end if;
  end if;

  -- A client company registered for VAT: the full national address.
  if new.kind = 'company' and new.vat_number is not null and 'client' = any(new.roles) then
    missing := array_remove(array[
      case when new.nat_building_no is null then 'nat_building_no' end,
      case when new.nat_street is null then 'nat_street' end,
      case when new.nat_district is null then 'nat_district' end,
      case when new.city is null then 'city' end,
      case when new.nat_postal_code is null then 'nat_postal_code' end
    ], null);
    if cardinality(missing) > 0 then
      raise exception 'CONTACTS_ADDRESS_REQUIRED' using errcode = 'P0001', detail = array_to_string(missing, ',');
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists contacts_orgs_tidy on public.contacts_orgs;
create trigger contacts_orgs_tidy before insert or update on public.contacts_orgs
  for each row execute function public.contacts_orgs_tidy();

create or replace function public.contacts_people_tidy()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  org_status text;
  org_name   text;
begin
  new.name      := btrim(new.name);
  new.name_ar   := nullif(btrim(new.name_ar), '');
  new.job_title := nullif(btrim(new.job_title), '');
  new.phone     := nullif(btrim(new.phone), '');
  new.email     := lower(nullif(btrim(new.email), ''));
  new.notes     := coalesce(new.notes, '');

  if tg_op = 'UPDATE' then
    if new.workspace_id <> old.workspace_id then
      raise exception 'CONTACTS_WORKSPACE_FIXED' using errcode = 'P0001';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    -- Nobody is moved out of an archived organisation either.
    if old.org_id is not null and old.org_id is distinct from new.org_id then
      select o.status, o.name into org_status, org_name from public.contacts_orgs o where o.id = old.org_id;
      if org_status = 'archived' then
        raise exception 'CONTACTS_ARCHIVED' using errcode = 'P0001', detail = org_name;
      end if;
    end if;
  else
    new.created_by := coalesce(new.created_by, auth.uid());
    new.created_at := now();
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();

  -- An archived organisation is locked: nobody added to it or changed under it.
  if new.org_id is not null then
    select o.status, o.name into org_status, org_name
      from public.contacts_orgs o where o.id = new.org_id and o.workspace_id = new.workspace_id;
    if org_status = 'archived' then
      raise exception 'CONTACTS_ARCHIVED' using errcode = 'P0001', detail = org_name;
    end if;
  end if;

  -- One primary contact per organisation: the new one takes the flag.
  if new.org_id is null then
    new.is_primary := false;
  elsif new.is_primary and (tg_op = 'INSERT' or not old.is_primary or new.org_id is distinct from old.org_id) then
    update public.contacts_people p set is_primary = false
     where p.org_id = new.org_id and p.is_primary and p.id <> new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists contacts_people_tidy on public.contacts_people;
create trigger contacts_people_tidy before insert or update on public.contacts_people
  for each row execute function public.contacts_people_tidy();

/*
 * Is this organisation one the company still deals with? For the modules
 * that will point at Contacts (the CRM's "won needs a client", quotations):
 * no new document for an archived organisation, as in Musa's ERP.
 */
create or replace function public.contacts_org_is_active(org uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (select 1 from public.contacts_orgs o where o.id = org and o.status = 'active');
$$;
revoke all on function public.contacts_org_is_active(uuid) from public, anon;
grant execute on function public.contacts_org_is_active(uuid) to authenticated;

/*
 * Import organisations (the CSV screen sends them already parsed and
 * checked). Managing only. Each row is its own attempt: a refused row is
 * reported by its line and the rest still go in, so one duplicate VAT
 * number does not throw away a whole file. Returns one row per input row.
 */
create or replace function public.contacts_import_orgs(ws uuid, items jsonb)
returns table (line_no integer, org_id uuid, error_code text, error_detail text)
language plpgsql
set search_path = public
as $$
declare
  r      jsonb;
  n      bigint;
  new_id uuid;
begin
  if not public.has_section(ws, 'contacts', 'manage') then
    raise exception 'CONTACTS_NEEDS_MANAGE' using errcode = 'P0001';
  end if;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) > 2000 then
    raise exception 'CONTACTS_IMPORT_TOO_BIG' using errcode = 'P0001';
  end if;
  for r, n in select e, i from jsonb_array_elements(items) with ordinality as t(e, i) loop
    begin
      insert into public.contacts_orgs (
        workspace_id, kind, name, name_ar, roles, vat_number, cr_number, country,
        nat_building_no, nat_street, nat_district, city, nat_postal_code, nat_additional_no,
        phone, email, website, notes)
      values (
        ws, coalesce(nullif(r->>'kind', ''), 'company'), coalesce(r->>'name', ''), r->>'name_ar',
        array(select jsonb_array_elements_text(case when jsonb_typeof(r->'roles') = 'array' then r->'roles' else '[]'::jsonb end)),
        r->>'vat_number', r->>'cr_number', r->>'country',
        r->>'nat_building_no', r->>'nat_street', r->>'nat_district', r->>'city', r->>'nat_postal_code', r->>'nat_additional_no',
        r->>'phone', r->>'email', r->>'website', coalesce(r->>'notes', ''))
      returning id into new_id;
      line_no := n; org_id := new_id; error_code := null; error_detail := null;
      return next;
    exception when others then
      line_no := n; org_id := null; error_code := sqlerrm;
      get stacked diagnostics error_detail = pg_exception_detail;
      return next;
    end;
  end loop;
end;
$$;
revoke all on function public.contacts_import_orgs(uuid, jsonb) from public, anon;
grant execute on function public.contacts_import_orgs(uuid, jsonb) to authenticated;
