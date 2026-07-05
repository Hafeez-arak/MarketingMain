-- ════════════════════════════════════════════════════════════════════════
-- Brand Brain v2 — ARAK Content Studio
-- ════════════════════════════════════════════════════════════════════════
-- Turns the flat brand_profile into the central source of truth: structured
-- identity modules + an asset library + products/suppliers/competitors.
--
-- Run ONCE in the Supabase SQL editor (project: "Arak Marketing").
-- Safe to re-run — every statement is idempotent.
-- Assumes the existing helper public.is_workspace_member(uuid) and the
-- public.workspaces / public.brand_profile tables already exist.
-- ════════════════════════════════════════════════════════════════════════

-- 1) ── Extend brand_profile with the identity / market / products modules ──
--    (text columns — cheap, and flatten straight into the n8n instructions blob)
alter table public.brand_profile
  add column if not exists mission            text default '',  -- why Arak exists
  add column if not exists positioning        text default '',  -- where it sits in the market
  add column if not exists value_proposition  text default '',  -- the core promise
  add column if not exists brand_story        text default '',  -- 45+ yrs narrative
  add column if not exists company_facts      text default '',  -- hard facts AI can state
  add column if not exists visual_identity    text default '',  -- colours / type / photography style
  add column if not exists market_context     text default '',  -- KSA / Vision 2030 framing
  add column if not exists product_sheet_path text default '',  -- Storage path to uploaded Excel/CSV
  add column if not exists product_index      text default '';  -- lightweight parsed summary for prompts

-- 2) ── Asset library: logos, product/project photos, references, music ─────
create table if not exists public.brand_assets (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind         text not null default 'other'
               check (kind in ('logo','product_photo','project_photo','reference','music','other')),
  storage_path text not null,            -- path within the brand-assets bucket
  public_url   text not null,            -- resolved public URL (fed to FLUX/i2v/render)
  title        text default '',
  caption      text default '',          -- description used as generation context / alt text
  tags         text[] default '{}',
  created_at   timestamptz not null default now()
);
create index if not exists brand_assets_ws_idx on public.brand_assets(workspace_id);

-- 3) ── Suppliers (~40-50 supply partners) ─────────────────────────────────
create table if not exists public.brand_suppliers (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null,
  category     text default '',          -- e.g. "LED drivers", "outdoor facade"
  brand_lines  text default '',          -- product lines carried
  notes        text default '',
  created_at   timestamptz not null default now()
);
create index if not exists brand_suppliers_ws_idx on public.brand_suppliers(workspace_id);

-- 4) ── Competitor watch ───────────────────────────────────────────────────
create table if not exists public.brand_competitors (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  name          text not null,
  positioning   text default '',
  strengths     text default '',
  how_we_differ text default '',         -- the angle content should lean on
  watch_url     text default '',
  created_at    timestamptz not null default now()
);
create index if not exists brand_competitors_ws_idx on public.brand_competitors(workspace_id);

-- 5) ── Row-level security: scope every table to the caller's workspace ─────
alter table public.brand_assets      enable row level security;
alter table public.brand_suppliers   enable row level security;
alter table public.brand_competitors enable row level security;

drop policy if exists brand_assets_rw on public.brand_assets;
create policy brand_assets_rw on public.brand_assets
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists brand_suppliers_rw on public.brand_suppliers;
create policy brand_suppliers_rw on public.brand_suppliers
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists brand_competitors_rw on public.brand_competitors;
create policy brand_competitors_rw on public.brand_competitors
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- 6) ── Storage bucket for assets + the product sheet ──────────────────────
insert into storage.buckets (id, name, public)
values ('brand-assets', 'brand-assets', true)
on conflict (id) do nothing;

-- Public read (URLs are fed to FLUX / i2v / render APIs); authenticated write.
drop policy if exists "brand-assets read"   on storage.objects;
create policy "brand-assets read"   on storage.objects
  for select using (bucket_id = 'brand-assets');

drop policy if exists "brand-assets insert" on storage.objects;
create policy "brand-assets insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'brand-assets');

drop policy if exists "brand-assets update" on storage.objects;
create policy "brand-assets update" on storage.objects
  for update to authenticated using (bucket_id = 'brand-assets');

drop policy if exists "brand-assets delete" on storage.objects;
create policy "brand-assets delete" on storage.objects
  for delete to authenticated using (bucket_id = 'brand-assets');

-- ════════════════════════════════════════════════════════════════════════
-- Done. New: brand_assets, brand_suppliers, brand_competitors tables;
-- 9 new brand_profile columns; brand-assets Storage bucket.
-- ════════════════════════════════════════════════════════════════════════
