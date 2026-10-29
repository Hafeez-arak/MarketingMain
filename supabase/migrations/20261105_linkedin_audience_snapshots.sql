-- ─── Who follows the LinkedIn page, week by week ───────────────────────────
-- 2026-10-29. The CEO asked whether the page's followers are potential
-- customers or mostly job seekers and suppliers, updated weekly and compared
-- with the week before. LinkedIn's follower demographics (via Zernio) are a
-- LIFETIME breakdown, so the weekly view is a snapshot per week, compared.
--
-- One row per page per week (week_start = the Sunday, Riyadh time). Written by
-- the Sunday cron (api/agent/chat.js) and, when the cron has not run yet that
-- week, by the first look at the LinkedIn Analytics tab (api/zernio/[action].js,
-- `audience`). Both write with the service key; members only read.
--
-- `demographics` = { industry, function, seniority, company_size }, each a list
-- of { label, id, value }. The customer/supplier split is computed when read
-- (src/lib/linkedinAudience.js), so changing those rules re-scores history.
--
-- Applied by hand. Safe to re-run.

create table if not exists public.linkedin_audience_snapshots (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces(id) on delete cascade,
  zernio_account_id  text not null,
  week_start         date not null,
  captured_at        timestamptz not null default now(),
  followers          integer,
  demographics       jsonb not null default '{}'::jsonb,
  unique (workspace_id, zernio_account_id, week_start)
);

create index if not exists linkedin_audience_latest_idx
  on public.linkedin_audience_snapshots (workspace_id, zernio_account_id, week_start desc);

alter table public.linkedin_audience_snapshots enable row level security;

drop policy if exists linkedin_audience_member_read on public.linkedin_audience_snapshots;
create policy linkedin_audience_member_read on public.linkedin_audience_snapshots
  for select to authenticated
  using (public.is_workspace_member(workspace_id));
