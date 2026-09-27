-- ════════════════════════════════════════════════════════════════════════
-- Weekly AI email drafts
-- ════════════════════════════════════════════════════════════════════════
-- Every Monday, after the research run, the agent container beside n8n
-- (server/agentHandlers/emailWeekly.js, driven by the "Agent — weekly email
-- drafts" workflow) writes three marketing-email options for the week from
-- the Brand Brain, the latest research, the calendar, what we posted and how
-- past emails did. One row per workspace per week. The Marketing tab shows
-- them; "Open" turns one into an ordinary draft campaign.
--
-- Written by the server only (service key). People may read them and mark an
-- option used or dismissed — that is the only update the UI makes.
--
-- Run ONCE. Idempotent.

create table if not exists public.email_ai_drafts (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  -- The Monday (Riyadh) of the week these are for.
  week_of          date not null,
  status           text not null default 'running' check (status in ('running','ready','failed')),
  -- [{ angle, why_now, audience, subject, preheader, body, cta_label, cta_url,
  --    ar_subject, ar_preheader, ar_body, ar_cta_label, used_campaign_id?, dismissed? }]
  options          jsonb not null default '[]'::jsonb,
  -- One sentence from the model on what this week's inputs were thin on.
  note             text not null default '',
  -- What the model was given, as counts and dates rather than the text itself:
  -- enough to answer "why did it write about that?" without storing a second
  -- copy of the brand.
  inputs           jsonb not null default '{}'::jsonb,
  research_run_id  uuid references public.research_runs(id) on delete set null,
  model            text not null default '',
  cost_usd         numeric(10,4) not null default 0,
  error            text not null default '',
  trigger          text not null default 'scheduled' check (trigger in ('scheduled','manual')),
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists email_ai_drafts_week_idx
  on public.email_ai_drafts (workspace_id, week_of);

alter table public.email_ai_drafts enable row level security;

drop policy if exists email_ai_drafts_read on public.email_ai_drafts;
create policy email_ai_drafts_read on public.email_ai_drafts
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists email_ai_drafts_mark on public.email_ai_drafts;
create policy email_ai_drafts_mark on public.email_ai_drafts
  for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

notify pgrst, 'reload schema';
