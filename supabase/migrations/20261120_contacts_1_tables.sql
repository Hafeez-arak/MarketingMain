-- ─── v2: Contacts (جهات الاتصال), the tables ───────────────────────────────
-- 2026-10-28. Item 3 of Musa's ERP (docs/MODULES.md in his repo), rewritten
-- in our own stack as the v2 section `contacts` (dev/erp-pilot/CONTACTS.md).
-- His ERP keeps clients and suppliers in two tables; his plan, and this
-- rewrite, is ONE record per organisation or person with several roles at
-- once, so a firm that is both a consultant and a client is entered once.
--
--   contacts_orgs    an organisation or an individual: roles, VAT number,
--                    commercial registration (CR), Saudi national address,
--                    phone, email, website, notes, active or archived
--   contacts_people  contact persons, under an organisation or on their own
--
-- Separate from sales_accounts, leads and email_contacts on purpose: how they
-- relate is the owner's decision (CONTACTS.md, "Decisions for the owner").
--
-- Who may do what (the section's grant, 20261101_section_access):
--   view    read
--   work    add and edit organisations and people
--   manage  archive and restore, delete, import
-- RLS checks the grant; the rules that need more than a grant (archive
-- needs manage, an archived organisation is locked, the duplicate guard) are
-- triggers in 20261120_contacts_2_rules.sql.
--
-- v2 ONLY: the local v2 database (dev/v2db). Safe to re-run.

create table if not exists public.contacts_orgs (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  -- A company (منشأة) or an individual (فرد), as Musa's client_type.
  kind              text not null default 'company' check (kind in ('company', 'individual')),
  name              text not null check (length(btrim(name)) between 1 and 200),
  name_ar           text check (name_ar is null or length(btrim(name_ar)) between 1 and 200),
  -- Several at once. An array, not a join table: six fixed values, filtered
  -- with @> (the GIN index below).
  roles             text[] not null default '{}'
                    check (roles <@ array['client', 'supplier', 'main_contractor', 'consultant', 'subcontractor', 'sister_company']::text[]),
  status            text not null default 'active' check (status in ('active', 'archived')),
  -- Saudi VAT registration: 15 digits (his rule).
  vat_number        text check (vat_number is null or vat_number ~ '^[0-9]{15}$'),
  -- Commercial registration: free text up to 30, as his clients (a foreign
  -- supplier's registration is not a Saudi 10-digit CR).
  cr_number         text check (cr_number is null or length(cr_number) between 1 and 30),
  country           text not null default 'SA' check (country ~ '^[A-Z]{2}$'),
  -- The Saudi national address. Numbers are digits; no length is assumed (his rule).
  nat_building_no   text check (nat_building_no is null or nat_building_no ~ '^[0-9]{1,10}$'),
  nat_street        text check (nat_street is null or length(btrim(nat_street)) between 1 and 200),
  nat_district      text check (nat_district is null or length(btrim(nat_district)) between 1 and 200),
  city              text check (city is null or length(btrim(city)) between 1 and 100),
  nat_postal_code   text check (nat_postal_code is null or nat_postal_code ~ '^[0-9]{1,10}$'),
  nat_additional_no text check (nat_additional_no is null or nat_additional_no ~ '^[0-9]{1,10}$'),
  phone             text check (phone is null or length(phone) between 1 and 40),
  email             text check (email is null or email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  website           text check (website is null or length(website) between 1 and 300),
  notes             text not null default '' check (length(notes) <= 5000),
  archived_at       timestamptz,
  archived_by       uuid references auth.users(id) on delete set null,
  created_by        uuid references auth.users(id) on delete set null,
  updated_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint contacts_orgs_archived_shape check ((status = 'archived') = (archived_at is not null)),
  -- A client company registered for VAT carries its full national address
  -- (his rule, for zakat and e-invoicing). The trigger says which part is
  -- missing; this is the backstop.
  constraint contacts_orgs_national_address check (
    kind <> 'company' or vat_number is null or not ('client' = any(roles))
    or (nat_building_no is not null and nat_street is not null and nat_district is not null
        and city is not null and nat_postal_code is not null)),
  -- For contacts_people's (org_id, workspace_id) reference: a person can
  -- only belong to an organisation of the same company.
  constraint contacts_orgs_id_ws unique (id, workspace_id)
);

-- One organisation per VAT number and per CR in a company (archived ones
-- count: restore it instead of entering it again).
create unique index if not exists contacts_orgs_vat_uq on public.contacts_orgs (workspace_id, vat_number) where vat_number is not null;
create unique index if not exists contacts_orgs_cr_uq on public.contacts_orgs (workspace_id, lower(cr_number)) where cr_number is not null;
create index if not exists contacts_orgs_list_idx on public.contacts_orgs (workspace_id, status, name);
create index if not exists contacts_orgs_roles_idx on public.contacts_orgs using gin (roles);

create table if not exists public.contacts_people (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- Null: a person on their own.
  org_id       uuid,
  name         text not null check (length(btrim(name)) between 1 and 200),
  name_ar      text check (name_ar is null or length(btrim(name_ar)) between 1 and 200),
  job_title    text check (job_title is null or length(btrim(job_title)) between 1 and 200),
  phone        text check (phone is null or length(phone) between 1 and 40),
  email        text check (email is null or email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  is_primary   boolean not null default false,
  notes        text not null default '' check (length(notes) <= 5000),
  created_by   uuid references auth.users(id) on delete set null,
  updated_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- No action (not restrict): checked at the end of the statement, so a
  -- company's deletion can cascade through both tables.
  constraint contacts_people_org_fk foreign key (org_id, workspace_id)
    references public.contacts_orgs (id, workspace_id),
  constraint contacts_people_primary_needs_org check (not is_primary or org_id is not null)
);
-- One primary contact per organisation (the trigger moves the flag).
create unique index if not exists contacts_people_one_primary on public.contacts_people (org_id) where is_primary;
create index if not exists contacts_people_org_idx on public.contacts_people (org_id);
create index if not exists contacts_people_list_idx on public.contacts_people (workspace_id, name);

-- ── Who reads, who writes ──
alter table public.contacts_orgs enable row level security;
alter table public.contacts_people enable row level security;

revoke all on public.contacts_orgs, public.contacts_people from anon;
grant select, insert, update, delete on public.contacts_orgs, public.contacts_people to authenticated;

drop policy if exists contacts_orgs_read on public.contacts_orgs;
create policy contacts_orgs_read on public.contacts_orgs
  for select to authenticated
  using (public.has_section(workspace_id, 'contacts', 'view'));

drop policy if exists contacts_orgs_add on public.contacts_orgs;
create policy contacts_orgs_add on public.contacts_orgs
  for insert to authenticated
  with check (public.has_section(workspace_id, 'contacts', 'work'));

drop policy if exists contacts_orgs_change on public.contacts_orgs;
create policy contacts_orgs_change on public.contacts_orgs
  for update to authenticated
  using (public.has_section(workspace_id, 'contacts', 'work'))
  with check (public.has_section(workspace_id, 'contacts', 'work'));

drop policy if exists contacts_orgs_remove on public.contacts_orgs;
create policy contacts_orgs_remove on public.contacts_orgs
  for delete to authenticated
  using (public.has_section(workspace_id, 'contacts', 'manage'));

drop policy if exists contacts_people_read on public.contacts_people;
create policy contacts_people_read on public.contacts_people
  for select to authenticated
  using (public.has_section(workspace_id, 'contacts', 'view'));

drop policy if exists contacts_people_add on public.contacts_people;
create policy contacts_people_add on public.contacts_people
  for insert to authenticated
  with check (public.has_section(workspace_id, 'contacts', 'work'));

drop policy if exists contacts_people_change on public.contacts_people;
create policy contacts_people_change on public.contacts_people
  for update to authenticated
  using (public.has_section(workspace_id, 'contacts', 'work'))
  with check (public.has_section(workspace_id, 'contacts', 'work'));

drop policy if exists contacts_people_remove on public.contacts_people;
create policy contacts_people_remove on public.contacts_people
  for delete to authenticated
  using (public.has_section(workspace_id, 'contacts', 'manage'));
