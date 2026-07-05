-- ════════════════════════════════════════════════════════════════════════
-- Content Plans + Idea Approval (ARAK Content Studio)
-- ════════════════════════════════════════════════════════════════════════
-- The monthly planning layer. A plan is generated BEFORE the month starts and
-- holds a set of proposed post ideas (incl. seasonal moments — Ramadan, Eid,
-- National Day). Each idea is individually APPROVED or REJECTED. Only approved
-- ideas advance to content generation (a later phase).
--
-- Run ONCE in the Supabase SQL editor. Idempotent + additive.
-- ════════════════════════════════════════════════════════════════════════

-- 1) ── A monthly content plan ─────────────────────────────────────────────
create table if not exists public.content_plans (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  name          text not null default '',
  month         text default '',          -- 'YYYY-MM' the plan is for
  start_date    date,
  end_date      date,
  goal          text default '',           -- the stated focus for the month
  goal_category text default '',
  platforms     text[] default '{}',
  status        text not null default 'draft'
                check (status in ('draft','approved','active','archived')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists content_plans_ws_idx on public.content_plans(workspace_id);

-- 2) ── A single proposed post idea within a plan ──────────────────────────
create table if not exists public.plan_ideas (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  plan_id         uuid not null references public.content_plans(id) on delete cascade,
  platform        text default 'instagram',
  scheduled_date  date,
  title           text default '',          -- short idea title
  topic           text default '',          -- the brief / what the post is about
  angle           text default '',
  tone            text default '',
  occasion        text default '',          -- e.g. 'Ramadan', 'National Day' — '' if none
  content_pillar  text default '',          -- e.g. 'Project showcase', 'Educational', 'Seasonal'
  rationale       text default '',          -- WHY this idea is proposed (helps the approve/reject call)
  suggested_format text default 'post',     -- post / carousel / reel
  suggested_style text default '',
  status          text not null default 'proposed'
                  check (status in ('proposed','approved','rejected')),
  position        int default 0,            -- ordering within the plan
  created_at      timestamptz not null default now()
);
create index if not exists plan_ideas_plan_idx on public.plan_ideas(plan_id);
create index if not exists plan_ideas_ws_idx   on public.plan_ideas(workspace_id);

-- 3) ── Row-level security ─────────────────────────────────────────────────
alter table public.content_plans enable row level security;
alter table public.plan_ideas    enable row level security;

drop policy if exists content_plans_rw on public.content_plans;
create policy content_plans_rw on public.content_plans
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists plan_ideas_rw on public.plan_ideas;
create policy plan_ideas_rw on public.plan_ideas
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- ════════════════════════════════════════════════════════════════════════
-- Done. New: content_plans, plan_ideas. Nothing existing was touched.
-- ════════════════════════════════════════════════════════════════════════
