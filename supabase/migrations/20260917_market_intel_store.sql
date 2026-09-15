-- ════════════════════════════════════════════════════════════════════════
-- The market-intelligence store: signals, leads, events
-- ════════════════════════════════════════════════════════════════════════
-- A research run used to live and die inside `research_runs.report`. The
-- 14 Sep brief found three live sales openings — the Tuwaiq Palace retender,
-- Mondrian Riyadh with no contractor named, thirteen Riyadh hotels under
-- construction — and a week later nothing on any screen would remember them
-- unless the next run happened to find them again in the same words.
--
-- Three tables, one per kind of thing a team keeps coming back to:
--
--   research_signals        every small observed fact, about a competitor or
--                           the market, with its source and the date it was
--                           seen. Little pieces from here and there — a
--                           LinkedIn post, a job advert, an exhibitor list —
--                           that only mean something once combined, which is
--                           why they are kept across weeks rather than per run.
--   research_opportunities  tenders, projects and leads, carried week to week,
--                           with a status the sales team owns.
--   research_events         expos, conferences and sponsorship openings, with
--                           the exhibitor deadline and who else is going.
--
-- Nothing is ever deleted by the agent. A lead nobody pursues is 'dropped' by
-- a person; an event that has passed is 'concluded' by code. The agent may
-- insert and may fill in fields it newly established — it never overwrites a
-- field a person owns (status, owner_note, decision).
--
-- `fingerprint` is the dedup key, computed in code (src/lib/agent/intel.js)
-- from the NAME of the thing, not from the model's headline, because the same
-- project is described in different words every week.

create table if not exists public.research_signals (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  -- Name as it appears on the watchlist. Empty means a market-level signal.
  competitor      text not null default '',
  category        text not null default 'other'
                  check (category in ('project','partnership','product','pricing','hiring','expansion',
                                      'content','event','award','leadership','regulation','gigaproject',
                                      'tech','tender','other')),
  -- Where it was seen. The point of the store is that these differ.
  channel         text not null default 'other'
                  check (channel in ('website','linkedin','instagram','tiktok','x','youtube','news','jobs',
                                     'tender_portal','event_site','government','other')),
  summary         text not null,
  detail          text not null default '',
  relevance       text not null default 'medium' check (relevance in ('high','medium','low')),
  source_url      text not null,
  source_title    text not null default '',
  event_date      date,
  fingerprint     text not null,
  first_run_id    uuid references public.research_runs(id) on delete set null,
  last_run_id     uuid references public.research_runs(id) on delete set null,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  times_seen      int not null default 1,
  -- The week it first appeared in a report. Low-relevance signals are stored
  -- and never reported, so this stays null for them.
  reported_in     date,
  created_at      timestamptz not null default now()
);

create unique index if not exists research_signals_fp_idx
  on public.research_signals (workspace_id, fingerprint);
create index if not exists research_signals_seen_idx
  on public.research_signals (workspace_id, last_seen_at desc);

create table if not exists public.research_opportunities (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  type             text not null default 'project' check (type in ('tender','project','lead')),
  -- The project's or tender's own name. The dedup key is built from this.
  name             text not null,
  headline         text not null default '',
  client           text not null default '',
  contractor       text not null default '',
  consultant       text not null default '',
  location         text not null default '',
  scope            text not null default '',
  stage            text not null default '',
  deadline         date,
  timing           text not null default 'unconfirmed' check (timing in ('open','closed','unconfirmed')),
  relevance        text not null default 'medium' check (relevance in ('high','medium','low')),
  suggested_action text not null default '',
  source_url       text not null,
  sources          jsonb not null default '[]'::jsonb,
  -- Owned by people. The agent never writes these two after insert.
  status           text not null default 'new'
                   check (status in ('new','assigned','pursued','won','lost','dropped')),
  owner_note       text not null default '',
  fingerprint      text not null,
  first_run_id     uuid references public.research_runs(id) on delete set null,
  last_run_id      uuid references public.research_runs(id) on delete set null,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  times_seen       int not null default 1,
  -- What the latest run established that the row did not already say.
  last_change      text not null default '',
  updated_at       timestamptz not null default now(),
  created_at       timestamptz not null default now()
);

create unique index if not exists research_opportunities_fp_idx
  on public.research_opportunities (workspace_id, fingerprint);
create index if not exists research_opportunities_open_idx
  on public.research_opportunities (workspace_id, status, deadline);

create table if not exists public.research_events (
  id                     uuid primary key default gen_random_uuid(),
  workspace_id           uuid not null references public.workspaces(id) on delete cascade,
  name                   text not null,
  start_date             date,
  end_date               date,
  venue                  text not null default '',
  city                   text not null default '',
  organizer              text not null default '',
  url                    text not null default '',
  exhibitor_deadline     date,
  -- Names, as on the watchlist. Text rather than uuids: a rival seen on an
  -- exhibitor list may not be on the watchlist yet, and that is a signal too.
  competitors_exhibiting text[] not null default '{}',
  relevance              text not null default 'medium' check (relevance in ('high','medium','low')),
  recommendation         text not null default '',
  status                 text not null default 'upcoming' check (status in ('upcoming','concluded','tbc')),
  -- Owned by people.
  decision               text not null default 'undecided'
                         check (decision in ('undecided','visiting','exhibiting','sponsoring','skipping')),
  source_url             text not null default '',
  fingerprint            text not null,
  first_run_id           uuid references public.research_runs(id) on delete set null,
  last_run_id            uuid references public.research_runs(id) on delete set null,
  first_seen_at          timestamptz not null default now(),
  last_seen_at           timestamptz not null default now(),
  last_change            text not null default '',
  updated_at             timestamptz not null default now(),
  created_at             timestamptz not null default now()
);

create unique index if not exists research_events_fp_idx
  on public.research_events (workspace_id, fingerprint);
create index if not exists research_events_date_idx
  on public.research_events (workspace_id, start_date);

-- ── RLS ──
-- Membership, not isolation: the operators belong to every workspace, so this
-- passes all of them at once. Every query in application code carries its own
-- workspace_id filter. RLS is not isolation in this database.
alter table public.research_signals enable row level security;
alter table public.research_opportunities enable row level security;
alter table public.research_events enable row level security;

drop policy if exists research_signals_member on public.research_signals;
create policy research_signals_member on public.research_signals
  for all to authenticated
  using (exists (select 1 from public.workspace_members m
                 where m.workspace_id = research_signals.workspace_id and m.user_id = auth.uid()))
  with check (exists (select 1 from public.workspace_members m
                      where m.workspace_id = research_signals.workspace_id and m.user_id = auth.uid()));

drop policy if exists research_opportunities_member on public.research_opportunities;
create policy research_opportunities_member on public.research_opportunities
  for all to authenticated
  using (exists (select 1 from public.workspace_members m
                 where m.workspace_id = research_opportunities.workspace_id and m.user_id = auth.uid()))
  with check (exists (select 1 from public.workspace_members m
                      where m.workspace_id = research_opportunities.workspace_id and m.user_id = auth.uid()));

drop policy if exists research_events_member on public.research_events;
create policy research_events_member on public.research_events
  for all to authenticated
  using (exists (select 1 from public.workspace_members m
                 where m.workspace_id = research_events.workspace_id and m.user_id = auth.uid()))
  with check (exists (select 1 from public.workspace_members m
                      where m.workspace_id = research_events.workspace_id and m.user_id = auth.uid()));
