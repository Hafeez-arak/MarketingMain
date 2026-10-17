-- ─── Where to look: a source list the research reads first ─────────────────
-- 2026-10-17. The 13 Oct run built its project findings on scribd, an Oracle
-- job posting and a UK consultancy page, because the agent had no idea which
-- sites carry this market's projects. Sources are a third kind of agenda row,
-- beside standing questions and the competitor watchlist, so they get the
-- same panel, the same RLS and the same assistant tools for free.
--
--   subject      the thing itself: a domain, an @handle, a #hashtag, a phrase
--   source_type  how the lens uses it (see the CHECK below)
--   why          what it carries — read by the lens and shown on the panel
--   tier         1 = read every run, 2 = most runs, 3 = when searches allow

alter table public.research_agenda
  drop constraint if exists research_agenda_kind_check;
alter table public.research_agenda
  add constraint research_agenda_kind_check
  check (kind = any (array['question', 'competitor', 'metric', 'source']));

alter table public.research_agenda
  add column if not exists source_type text not null default '';

alter table public.research_agenda
  drop constraint if exists research_agenda_source_type_check;
alter table public.research_agenda
  add constraint research_agenda_source_type_check
  check (source_type = any (array[
    '', 'website', 'news', 'tender_portal', 'exchange', 'government',
    'instagram', 'linkedin', 'x', 'hashtag', 'keyword'
  ]));

-- ─── A project's value is not our package ──────────────────────────────────
-- The targets lens now says whether value_sar is the whole project or our
-- package, names the piece of a big project that fits us (and who holds it),
-- and records that piece's own value when a source gives one. Sales → Targets
-- converts a project value to our share using sales_icp.config.share.
alter table public.research_opportunities
  add column if not exists value_kind text not null default '',
  add column if not exists package text not null default '',
  add column if not exists package_value_sar numeric;
