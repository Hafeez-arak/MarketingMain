-- ════════════════════════════════════════════════════════════════════════
-- Brand Assets — project grouping
-- ════════════════════════════════════════════════════════════════════════
-- Lets project photos (kind = 'project_photo') be grouped under a named
-- project (e.g. "Riyadh Air") so the Asset Library can show one card per
-- project with all its photos, instead of a flat grid. Photos with an empty
-- project stay "Individual" — grouping is optional per photo.
--
-- Run ONCE in the Supabase SQL editor (project: "Arak Marketing").
-- Safe to re-run — idempotent.
-- ════════════════════════════════════════════════════════════════════════

alter table public.brand_assets
  add column if not exists project text default '';

create index if not exists brand_assets_project_idx on public.brand_assets(workspace_id, project);
