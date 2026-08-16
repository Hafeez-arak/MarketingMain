-- ════════════════════════════════════════════════════════════════════════
-- Brand Brain v4 — per-workspace customisable structure
-- ════════════════════════════════════════════════════════════════════════
-- Until now the Brand Brain's *shape* was hardcoded in the React page: one
-- fixed list of fields, worded for a lighting company ("Why Arak exists",
-- "wattage, lumens, IP rating"), plus four fixed directories (Suppliers,
-- Competitors, Products, Message Templates) with fixed columns. Every
-- workspace got that same lighting-shaped form whether or not it sold
-- lighting.
--
-- This migration moves the structure into the database, per workspace, so
-- marketing can reshape it from the web interface: rename sections, add and
-- remove fields, toggle directories off, and define a directory's own
-- columns.
--
-- Storage model for field VALUES is deliberately hybrid:
--   • A field may point at one of brand_profile's existing text columns
--     (storage_column = 'mission'). Nothing about the existing pipeline
--     changes for those — same columns, same n8n payload.
--   • A field with storage_column = '' is a custom field; its value lives in
--     the new brand_profile.custom_fields JSONB under the field's key.
-- That keeps every current consumer working while making new fields free.
--
-- Run ONCE. Every statement is idempotent and additive — no existing table
-- is dropped and no existing value is overwritten.
-- ════════════════════════════════════════════════════════════════════════

-- 1) ── Values for fields that don't map to a fixed column ─────────────────
alter table public.brand_profile
  add column if not exists custom_fields jsonb not null default '{}'::jsonb;

-- 2) ── Section definitions (the page's outline, per workspace) ────────────
--    kind: 'fields'    — a group of text/textarea inputs (brand_fields)
--          'directory' — a repeating list of rows (brand_directory_*)
--          'assets'    — the file-upload Asset Library (brand_assets)
create table if not exists public.brand_sections (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  key          text not null,                       -- stable slug, referenced by fields/rows
  title        text not null,                       -- what marketing sees and can rename
  description  text default '',
  kind         text not null default 'fields' check (kind in ('fields','directory','assets')),
  icon         text default '',                     -- name from the page's icon set
  sort_order   int  not null default 0,
  enabled      boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (workspace_id, key)
);
create index if not exists brand_sections_ws_idx on public.brand_sections(workspace_id);

-- 3) ── Field definitions inside a 'fields' section ────────────────────────
create table if not exists public.brand_fields (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  section_key       text not null,
  key               text not null,                  -- unique per workspace; the custom_fields JSON key
  label             text not null,
  hint              text default '',
  placeholder       text default '',
  input_type        text not null default 'textarea'
                    check (input_type in ('text','textarea','select')),
  options           text[] default '{}',            -- for input_type = 'select'
  rows              int default 4,
  storage_column    text default '',                -- '' → value lives in custom_fields
  prompt_label      text default '',                -- heading used in the flattened AI blob
  include_in_prompt boolean not null default true,  -- off = stored, never sent to the model
  sort_order        int not null default 0,
  enabled           boolean not null default true,
  created_at        timestamptz not null default now(),
  unique (workspace_id, key)
);
create index if not exists brand_fields_ws_idx on public.brand_fields(workspace_id, section_key);

-- 4) ── Column definitions for a 'directory' section ───────────────────────
create table if not exists public.brand_directory_columns (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  section_key  text not null,
  key          text not null,                       -- the JSON key inside brand_directory_rows.data
  label        text not null,
  placeholder  text default '',
  wide         boolean not null default false,      -- render full-width in the row grid
  in_prompt    boolean not null default true,       -- lets price columns be stored but not sent
  sort_order   int not null default 0,
  enabled      boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (workspace_id, section_key, key)
);
create index if not exists brand_directory_columns_ws_idx
  on public.brand_directory_columns(workspace_id, section_key);

-- 5) ── The directory rows themselves — schemaless on purpose ──────────────
--    Row shape is defined by brand_directory_columns, so adding a column is
--    a metadata change, not a DDL change.
create table if not exists public.brand_directory_rows (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  section_key  text not null,
  data         jsonb not null default '{}'::jsonb,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists brand_directory_rows_ws_idx
  on public.brand_directory_rows(workspace_id, section_key, sort_order);

-- 6) ── Row-level security — same workspace scoping as every brand_* table ─
alter table public.brand_sections           enable row level security;
alter table public.brand_fields             enable row level security;
alter table public.brand_directory_columns  enable row level security;
alter table public.brand_directory_rows     enable row level security;

drop policy if exists brand_sections_rw on public.brand_sections;
create policy brand_sections_rw on public.brand_sections
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists brand_fields_rw on public.brand_fields;
create policy brand_fields_rw on public.brand_fields
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists brand_directory_columns_rw on public.brand_directory_columns;
create policy brand_directory_columns_rw on public.brand_directory_columns
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists brand_directory_rows_rw on public.brand_directory_rows;
create policy brand_directory_rows_rw on public.brand_directory_rows
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- ════════════════════════════════════════════════════════════════════════
-- Done. New: brand_sections, brand_fields, brand_directory_columns,
-- brand_directory_rows; brand_profile.custom_fields.
-- Structure content is seeded per workspace by the companion seed files.
-- ════════════════════════════════════════════════════════════════════════
