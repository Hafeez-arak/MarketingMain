-- ─── v2: Contacts, the rest of Musa's clients and suppliers ────────────────
-- 2026-10-28, after 20261120_contacts_2_rules.sql. The owner: everything his
-- application has for clients and suppliers, not a subset. What his two
-- screens have that the first cut did not:
--
--   · a number on every record, as his C-2026-000001 / S-2026-000001
--     (one series here, per company and year: one record, several roles);
--   · supplier categories the company names itself (Arabic and English,
--     active or not), used to filter and group;
--   · a supplier's banking and terms: IBAN (Saudi or, outside the Kingdom,
--     foreign), SWIFT, payment terms in days; and a free-text address;
--   · the activity log (his audit_log + ActivityLog): who created, changed
--     or deleted what, field by field, old → new;
--   · delete as he does it: a record nothing else uses can be deleted, and
--     its contact persons go with it (his client_contacts cascade).
--
-- What his screens show that lives in other modules (quotations, CRM
-- opportunities, projects, sales and supplier invoices, balances, aging, the
-- account statement) is not here: v2 has none of those modules yet
-- (dev/erp-pilot/CONTACTS.md).
--
-- v2 ONLY: the local v2 database (dev/v2db). Safe to re-run.

-- ── Supplier categories ──
create table if not exists public.contacts_categories (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- The company's own name for it (Arabic in his screens), and the English one.
  name         text not null check (length(btrim(name)) between 1 and 120),
  name_en      text check (name_en is null or length(btrim(name_en)) between 1 and 120),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint contacts_categories_id_ws unique (id, workspace_id)
);
create unique index if not exists contacts_categories_name_uq on public.contacts_categories (workspace_id, lower(btrim(name)));

alter table public.contacts_categories enable row level security;
revoke all on public.contacts_categories from anon;
-- No delete: a category is switched off, as in his screen (a used one keeps its suppliers' history).
grant select, insert, update on public.contacts_categories to authenticated;

drop policy if exists contacts_categories_read on public.contacts_categories;
create policy contacts_categories_read on public.contacts_categories
  for select to authenticated
  using (public.has_section(workspace_id, 'contacts', 'view'));

-- Naming the categories is a setting: managing.
drop policy if exists contacts_categories_add on public.contacts_categories;
create policy contacts_categories_add on public.contacts_categories
  for insert to authenticated
  with check (public.has_section(workspace_id, 'contacts', 'manage'));

drop policy if exists contacts_categories_change on public.contacts_categories;
create policy contacts_categories_change on public.contacts_categories
  for update to authenticated
  using (public.has_section(workspace_id, 'contacts', 'manage'))
  with check (public.has_section(workspace_id, 'contacts', 'manage'));

create or replace function public.contacts_categories_tidy()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.name := btrim(new.name);
  new.name_en := nullif(btrim(new.name_en), '');
  if tg_op = 'UPDATE' then
    if new.workspace_id <> old.workspace_id then
      raise exception 'CONTACTS_WORKSPACE_FIXED' using errcode = 'P0001';
    end if;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists contacts_categories_tidy on public.contacts_categories;
create trigger contacts_categories_tidy before insert or update on public.contacts_categories
  for each row execute function public.contacts_categories_tidy();

-- ── New fields on an organisation ──
alter table public.contacts_orgs
  add column if not exists contact_no text,
  add column if not exists category_id uuid,
  add column if not exists iban text,
  add column if not exists swift text,
  add column if not exists payment_terms_days integer,
  add column if not exists address text;

alter table public.contacts_orgs drop constraint if exists contacts_orgs_category_fk;
alter table public.contacts_orgs add constraint contacts_orgs_category_fk
  foreign key (category_id, workspace_id) references public.contacts_categories (id, workspace_id);

-- His IBAN rule: any country's shape, and the Saudi shape when the country is SA.
alter table public.contacts_orgs drop constraint if exists contacts_orgs_iban;
alter table public.contacts_orgs add constraint contacts_orgs_iban check (
  iban is null or (iban ~ '^[A-Z]{2}[0-9]{2}[0-9A-Z]{11,30}$' and (country <> 'SA' or iban ~ '^SA[0-9]{2}[0-9A-Z]{20}$')));
alter table public.contacts_orgs drop constraint if exists contacts_orgs_swift;
alter table public.contacts_orgs add constraint contacts_orgs_swift check (
  swift is null or swift ~ '^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$');
alter table public.contacts_orgs drop constraint if exists contacts_orgs_payment_terms;
alter table public.contacts_orgs add constraint contacts_orgs_payment_terms check (
  payment_terms_days is null or payment_terms_days between 0 and 3650);
alter table public.contacts_orgs drop constraint if exists contacts_orgs_address;
alter table public.contacts_orgs add constraint contacts_orgs_address check (
  address is null or length(btrim(address)) between 1 and 500);
create index if not exists contacts_orgs_category_idx on public.contacts_orgs (category_id);

-- ── Numbers: C-2026-000001, per company and year ──
create table if not exists public.contacts_counters (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  year         integer not null,
  last         integer not null default 0,
  primary key (workspace_id, year)
);
-- Nobody reads or writes it but the numbering trigger (security definer, below).
alter table public.contacts_counters enable row level security;
revoke all on public.contacts_counters from anon, authenticated;

create or replace function public.contacts_orgs_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  y integer := extract(year from now())::integer;
  n integer;
begin
  if tg_op = 'UPDATE' then
    new.contact_no := old.contact_no;  -- a number never changes
    return new;
  end if;
  insert into public.contacts_counters as c (workspace_id, year, last) values (new.workspace_id, y, 1)
  on conflict (workspace_id, year) do update set last = c.last + 1
  returning last into n;
  new.contact_no := 'C-' || y || '-' || lpad(n::text, 6, '0');
  return new;
end;
$$;
-- Named to fire before contacts_orgs_tidy (triggers run in name order).
drop trigger if exists contacts_orgs_number on public.contacts_orgs;
create trigger contacts_orgs_number before insert or update on public.contacts_orgs
  for each row execute function public.contacts_orgs_number();

-- The records already there get theirs in the order they were made. The
-- triggers stay out of it: an archived one is locked, and this is not a change
-- anybody made.
alter table public.contacts_orgs disable trigger user;
with numbered as (
  select o.id, extract(year from o.created_at)::integer as y,
         row_number() over (partition by o.workspace_id, extract(year from o.created_at) order by o.created_at, o.id) as n
    from public.contacts_orgs o where o.contact_no is null
)
update public.contacts_orgs o set contact_no = 'C-' || x.y || '-' || lpad(x.n::text, 6, '0')
  from numbered x where x.id = o.id;
insert into public.contacts_counters (workspace_id, year, last)
select workspace_id, split_part(contact_no, '-', 2)::integer, max(split_part(contact_no, '-', 3)::integer)
  from public.contacts_orgs group by 1, 2
on conflict (workspace_id, year) do update set last = greatest(public.contacts_counters.last, excluded.last);
alter table public.contacts_orgs enable trigger user;

alter table public.contacts_orgs alter column contact_no set not null;
create unique index if not exists contacts_orgs_no_uq on public.contacts_orgs (workspace_id, contact_no);

-- ── The tidy-and-rules trigger, with the new fields ──
-- 20261120_contacts_2_rules.sql's function, plus: IBAN and SWIFT without
-- spaces in capitals, the address trimmed, and no new link to a category the
-- company switched off.
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
  new.address           := nullif(btrim(new.address), '');
  new.phone             := nullif(btrim(new.phone), '');
  new.email             := lower(nullif(btrim(new.email), ''));
  new.website           := nullif(btrim(new.website), '');
  new.iban              := upper(nullif(regexp_replace(coalesce(new.iban, ''), '\s', '', 'g'), ''));
  new.swift             := upper(nullif(regexp_replace(coalesce(new.swift, ''), '\s', '', 'g'), ''));
  new.notes             := coalesce(new.notes, '');
  new.roles             := coalesce(new.roles, '{}');
  if new.roles <@ canonical then
    new.roles := array(select c from unnest(canonical) with ordinality as x(c, i) where c = any(new.roles) order by i);
  end if;

  if tg_op = 'UPDATE' then
    if new.workspace_id <> old.workspace_id then
      raise exception 'CONTACTS_WORKSPACE_FIXED' using errcode = 'P0001';
    end if;
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

  -- A category the company switched off is kept where it is, but not given anew.
  if new.category_id is not null and (tg_op = 'INSERT' or new.category_id is distinct from old.category_id) then
    if exists (select 1 from public.contacts_categories c where c.id = new.category_id and not c.is_active) then
      raise exception 'CONTACTS_CATEGORY_INACTIVE' using errcode = 'P0001';
    end if;
  end if;

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

-- ── Delete as he does it: the contact persons go with their organisation ──
alter table public.contacts_people drop constraint if exists contacts_people_org_fk;
alter table public.contacts_people add constraint contacts_people_org_fk
  foreign key (org_id, workspace_id) references public.contacts_orgs (id, workspace_id) on delete cascade;

-- ── The activity log ──
-- One row per change, written by the database whoever made it (a screen,
-- the import, SQL). Kept when the record is deleted, as his audit_log is.
create table if not exists public.contacts_activity (
  id           bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  org_id       uuid,                 -- the organisation (also for a person under it)
  person_id    uuid,                 -- set when the row is about a contact person
  action       text not null check (action in ('insert', 'update', 'delete')),
  -- What it was called at the time, so a deleted record's history still reads.
  label        text not null default '',
  -- Field → [old, new]; only the fields that changed (update only).
  changes      jsonb not null default '{}'::jsonb,
  actor        uuid references auth.users(id) on delete set null,
  at           timestamptz not null default now()
);
create index if not exists contacts_activity_org_idx on public.contacts_activity (workspace_id, org_id, at desc);

alter table public.contacts_activity enable row level security;
revoke all on public.contacts_activity from anon;
grant select on public.contacts_activity to authenticated;
-- His screens show it only with audit.view; here, to whoever manages Contacts.
drop policy if exists contacts_activity_read on public.contacts_activity;
create policy contacts_activity_read on public.contacts_activity
  for select to authenticated
  using (public.has_section(workspace_id, 'contacts', 'manage'));

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

drop trigger if exists contacts_orgs_log on public.contacts_orgs;
create trigger contacts_orgs_log after insert or update or delete on public.contacts_orgs
  for each row execute function public.contacts_log();
drop trigger if exists contacts_people_log on public.contacts_people;
create trigger contacts_people_log after insert or update or delete on public.contacts_people
  for each row execute function public.contacts_log();

-- ── The import, with the new fields ──
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
        nat_building_no, nat_street, nat_district, city, nat_postal_code, nat_additional_no, address,
        phone, email, website, iban, swift, payment_terms_days, notes)
      values (
        ws, coalesce(nullif(r->>'kind', ''), 'company'), coalesce(r->>'name', ''), r->>'name_ar',
        array(select jsonb_array_elements_text(case when jsonb_typeof(r->'roles') = 'array' then r->'roles' else '[]'::jsonb end)),
        r->>'vat_number', r->>'cr_number', r->>'country',
        r->>'nat_building_no', r->>'nat_street', r->>'nat_district', r->>'city', r->>'nat_postal_code', r->>'nat_additional_no', r->>'address',
        r->>'phone', r->>'email', r->>'website', r->>'iban', r->>'swift', nullif(r->>'payment_terms_days', '')::integer,
        coalesce(r->>'notes', ''))
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
