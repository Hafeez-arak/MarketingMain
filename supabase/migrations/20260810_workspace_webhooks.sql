-- ════════════════════════════════════════════════════════════════════════
-- Workspace Webhooks — ARAK Content Studio
-- ════════════════════════════════════════════════════════════════════════
-- The n8n webhook URLs configured in Settings → Workflow Webhooks used to
-- live only in this browser's localStorage — sign in from another browser
-- or device and every field was blank. One row per workspace, keyed to the
-- signed-in account instead, same pattern as brand_profile.
--
-- The whole webhooks object is stored as one jsonb blob rather than a column
-- per platform: it's a flat settings map (not a queryable/relational table),
-- and new webhook keys (already added twice — Creative Studio's 3) never
-- need a migration to be storable here.
--
-- Run ONCE in the Supabase SQL editor (project: "Arak Marketing").
-- Safe to re-run — every statement is idempotent.
-- Assumes public.is_workspace_member(uuid) and public.workspaces already exist.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.workspace_webhooks (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  webhooks     jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now()
);

alter table public.workspace_webhooks enable row level security;

drop policy if exists workspace_webhooks_rw on public.workspace_webhooks;
create policy workspace_webhooks_rw on public.workspace_webhooks
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
