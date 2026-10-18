-- ─── The CEO's weekly brief ────────────────────────────────────────────────
-- 2026-10-18. The CEO asked for the important points in one or two pages,
-- not numbers every time. A brief is written every Sunday morning (and on
-- demand), stored here, and shown on the CEO page in Arabic or English.
--
-- `kpis` and `facts` are computed in code; the model only writes `brief`
-- (judgement, in both languages) from them, so it cannot invent a figure.
--
-- Applied by hand. Safe to re-run.

alter table public.workspaces
  add column if not exists ceo_brief_enabled boolean not null default false;

update public.workspaces set ceo_brief_enabled = true
 where id = '00000000-0000-0000-0000-000000000001';  -- Arak Lighting

create table if not exists public.ceo_briefs (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  period_start  timestamptz not null,
  period_end    timestamptz not null,
  kpis          jsonb not null default '[]'::jsonb,
  facts         jsonb not null default '{}'::jsonb,
  brief         jsonb not null default '{}'::jsonb,
  trigger       text not null default 'manual' check (trigger in ('manual', 'schedule')),
  created_by    uuid references auth.users(id) on delete set null,
  model         text not null default '',
  cost_usd      numeric not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists ceo_briefs_latest_idx on public.ceo_briefs (workspace_id, created_at desc);

alter table public.ceo_briefs enable row level security;

-- Admins only: the brief is built from leads and sales, which only admins see.
drop policy if exists ceo_briefs_admin_read on public.ceo_briefs;
create policy ceo_briefs_admin_read on public.ceo_briefs
  for select to authenticated
  using (public.is_access_admin() and public.is_workspace_member(workspace_id));
