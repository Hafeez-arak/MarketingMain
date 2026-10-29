-- ─── v2: Catalog (the company's items and their specifications), tables ────
-- 2026-10-30. Musa's catalog (الكتالوج) rewritten in our own stack as the v2
-- section `catalog` (dev/erp-pilot/CATALOG.md). Our own clean tables in
-- `public`, written from what the screens do, not from his code.
--
--   catalog_spec_fields  the specifications the company records (power, IP
--                        rating, beam angle…), named by the company. Switched
--                        off, never deleted.
--   catalog_items        an item: code, name, brand, model, category, unit.
--                        No prices, no stock quantities. Switched off, never
--                        deleted.
--   catalog_item_specs   one value of one field on one item. A blank value is
--                        no row at all: "no value is assumed".
--   catalog_audit        who changed what, filled by triggers (as hr_audit).
--
-- Every row names its company; rows of one company point at each other only
-- through (workspace_id, id) keys, so an item can never carry another
-- company's field.
--
-- Who may do what (the section grant, 20261101_section_access). Musa has two
-- permissions, catalog.view and catalog.manage:
--   view    reads everything, the history included
--   work    the same as view (his catalog has no day-to-day tier)
--   manage  adds and edits items, switches them on and off, edits their
--           specs, manages the spec fields
-- No delete policy on items or fields: a mistake is switched off.
--
-- v2 ONLY: the local v2 database (dev/v2db). Safe to re-run.

-- ── The section key ──
-- A check constraint is replaced whole: every key there today, plus 'catalog'.
-- (20261125_crm_1_tables.sql was the last to touch these three.)
alter table public.section_access drop constraint if exists section_access_section_check;
alter table public.section_access add constraint section_access_section_check
  check (section in ('ceo', 'sales', 'marketing', 'insights', 'technical', 'finance', 'hr', 'contacts', 'crm', 'catalog'));
alter table public.tasks drop constraint if exists tasks_section_check;
alter table public.tasks add constraint tasks_section_check
  check (section in ('ceo', 'sales', 'marketing', 'insights', 'technical', 'finance', 'hr', 'contacts', 'crm', 'catalog'));
alter table public.meetings drop constraint if exists meetings_section_check;
alter table public.meetings add constraint meetings_section_check
  check (section in ('ceo', 'sales', 'marketing', 'insights', 'technical', 'finance', 'hr', 'contacts', 'crm', 'catalog'));

-- ── The specification fields ──

create table if not exists public.catalog_spec_fields (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null check (length(btrim(name)) > 0),
  name_en      text check (name_en is null or length(btrim(name_en)) > 0),
  unit         text check (unit is null or length(btrim(unit)) > 0),
  -- Smaller first.
  sequence     integer not null default 10,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint catalog_spec_fields_ws_id unique (workspace_id, id)
);
create unique index if not exists catalog_spec_fields_name_uq on public.catalog_spec_fields (workspace_id, lower(btrim(name)));

-- ── The items ──

create table if not exists public.catalog_items (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  code          text not null check (length(code) > 0 and code = btrim(code)),
  name          text not null check (length(btrim(name)) > 0),
  brand         text check (brand is null or length(btrim(brand)) > 0),
  model_no      text check (model_no is null or length(btrim(model_no)) > 0),
  category      text check (category is null or length(btrim(category)) > 0),
  unit          text not null check (length(btrim(unit)) > 0),
  description   text,
  stocked       boolean not null default false,
  active        boolean not null default true,
  -- Private files in the bucket catalog-files, <workspace>/<item>/<file>
  -- (20261130_catalog_2_files.sql). A new file replaces the path; the old
  -- file stays in storage.
  datasheet_path text,
  image_path     text,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint catalog_items_ws_id unique (workspace_id, id),
  constraint catalog_items_code_uq unique (workspace_id, code),
  constraint catalog_items_datasheet_place check (datasheet_path is null or datasheet_path like workspace_id::text || '/' || id::text || '/%'),
  constraint catalog_items_image_place check (image_path is null or image_path like workspace_id::text || '/' || id::text || '/%')
);
create index if not exists catalog_items_list_idx on public.catalog_items (workspace_id, active, category);

-- ── The values ──

create table if not exists public.catalog_item_specs (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  item_id      uuid not null,
  field_id     uuid not null,
  value        text not null check (length(btrim(value)) > 0),
  updated_at   timestamptz not null default now(),
  constraint catalog_item_specs_item_fk foreign key (workspace_id, item_id) references public.catalog_items (workspace_id, id) on delete cascade,
  constraint catalog_item_specs_field_fk foreign key (workspace_id, field_id) references public.catalog_spec_fields (workspace_id, id),
  constraint catalog_item_specs_uq unique (item_id, field_id)
);
create index if not exists catalog_item_specs_field_idx on public.catalog_item_specs (workspace_id, field_id);

-- ── The history ──
-- One row per change, written by the database whoever made it. A company's
-- history goes with the company.

create table if not exists public.catalog_audit (
  id           bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  table_name   text not null,
  row_id       uuid not null,
  -- The item the row belongs to (the row itself for an item); null for a
  -- spec field. A deleted item's history stays.
  item_id      uuid,
  action       text not null check (action in ('insert', 'update', 'delete')),
  changed_by   uuid,
  changed_at   timestamptz not null default now(),
  old_data     jsonb,
  new_data     jsonb
);
create index if not exists catalog_audit_item_idx on public.catalog_audit (workspace_id, item_id, id desc);
create index if not exists catalog_audit_row_idx on public.catalog_audit (workspace_id, table_name, row_id, id desc);

-- ── Rules in triggers ──

-- A row never moves to another company; updated_at is the database's clock.
create or replace function public.catalog_touch()
returns trigger
language plpgsql
as $$
begin
  if new.workspace_id is distinct from old.workspace_id then
    raise exception 'CATALOG_WORKSPACE_FIXED' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.catalog_items_rules()
returns trigger
language plpgsql
as $$
begin
  if new.workspace_id is distinct from old.workspace_id then
    raise exception 'CATALOG_WORKSPACE_FIXED' using errcode = 'P0001';
  end if;
  -- WAITING FOR THE STOCK MODULE: Musa's rule "a stocked item stays stocked
  -- once it has stock documents" is checked here, when `stocked` goes from
  -- true to false: refuse with CATALOG_STOCKED_IN_USE if any stock document
  -- line names this item. There are no stock documents in v2 yet, so there
  -- is nothing to look at.
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists catalog_spec_fields_touch on public.catalog_spec_fields;
create trigger catalog_spec_fields_touch before update on public.catalog_spec_fields
  for each row execute function public.catalog_touch();
drop trigger if exists catalog_items_touch on public.catalog_items;
create trigger catalog_items_touch before update on public.catalog_items
  for each row execute function public.catalog_items_rules();
drop trigger if exists catalog_item_specs_touch on public.catalog_item_specs;
create trigger catalog_item_specs_touch before update on public.catalog_item_specs
  for each row execute function public.catalog_touch();

create or replace function public.catalog_audit_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare r jsonb; item uuid;
begin
  r := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  -- Deleting a whole company deletes its history with it, not into it.
  if tg_op = 'DELETE' and not exists (select 1 from public.workspaces where id = (r->>'workspace_id')::uuid) then
    return old;
  end if;
  item := case tg_table_name when 'catalog_items' then (r->>'id')::uuid
                             when 'catalog_item_specs' then (r->>'item_id')::uuid end;
  insert into public.catalog_audit (workspace_id, table_name, row_id, item_id, action, changed_by, old_data, new_data)
  values ((r->>'workspace_id')::uuid, tg_table_name, (r->>'id')::uuid, item, lower(tg_op), auth.uid(),
          case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['catalog_spec_fields', 'catalog_items', 'catalog_item_specs'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.catalog_audit_row()', t || '_audit', t);
  end loop;
end $$;

-- ── Who reads, who writes ──
alter table public.catalog_spec_fields enable row level security;
alter table public.catalog_items enable row level security;
alter table public.catalog_item_specs enable row level security;
alter table public.catalog_audit enable row level security;

revoke all on public.catalog_spec_fields, public.catalog_items, public.catalog_item_specs, public.catalog_audit from anon, authenticated;
-- Fields and items are switched off, never deleted. A spec given a blank
-- value is deleted.
grant select, insert, update on public.catalog_spec_fields, public.catalog_items to authenticated;
grant select, insert, update, delete on public.catalog_item_specs to authenticated;
grant select on public.catalog_audit to authenticated;

do $$
declare t text;
begin
  foreach t in array array['catalog_spec_fields', 'catalog_items', 'catalog_item_specs', 'catalog_audit'] loop
    execute format('drop policy if exists %1$s_read on public.%1$I', t);
    execute format('create policy %1$s_read on public.%1$I for select to authenticated using (public.has_section(workspace_id, ''catalog'', ''view''))', t);
  end loop;
  foreach t in array array['catalog_spec_fields', 'catalog_items', 'catalog_item_specs'] loop
    execute format('drop policy if exists %1$s_add on public.%1$I', t);
    execute format('create policy %1$s_add on public.%1$I for insert to authenticated with check (public.has_section(workspace_id, ''catalog'', ''manage''))', t);
    execute format('drop policy if exists %1$s_change on public.%1$I', t);
    execute format('create policy %1$s_change on public.%1$I for update to authenticated using (public.has_section(workspace_id, ''catalog'', ''manage'')) with check (public.has_section(workspace_id, ''catalog'', ''manage''))', t);
  end loop;
end $$;
drop policy if exists catalog_item_specs_remove on public.catalog_item_specs;
create policy catalog_item_specs_remove on public.catalog_item_specs
  for delete to authenticated using (public.has_section(workspace_id, 'catalog', 'manage'));
