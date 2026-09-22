-- ════════════════════════════════════════════════════════════════════════
-- The business line survives the run that found it
-- ════════════════════════════════════════════════════════════════════════
-- Arak sells lighting, specified by an architect at concept stage, and
-- controls, specified by an MEP or ELV consultant months later. Of the 17
-- rivals on the watchlist, 8 sell only lighting and 4 only controls. Since
-- 2026-09-17 every finding carries the line it belongs to — stamped in code
-- from the pass that produced it, never guessed by a model.
--
-- ── WHY THIS COLUMN HAS TO EXIST ──
-- The line lived only on `report.findings`, inside the run's jsonb. The store
-- is the half that CROSSES weeks — a lead found three weeks ago and still open
-- belongs on today's list — and it dropped the line on the way in. So a reader
-- who picked "Controls" saw this week's controls findings and none of the
-- controls leads the tracker had been carrying since, which reads as "nothing
-- is happening in controls" and is the exact failure the split exists to end.
--
-- ── NOT NULL DEFAULT '' RATHER THAN NULLABLE ──
-- '' means "we could not tie this to a business", which is a real and honest
-- answer that the report renders as its own group. A null would mean the same
-- thing while forcing every reader to handle two spellings of it. Every row
-- written before today gets '', which is true of them: nothing stamped them.
--
-- No backfill. The line is derived from evidence the run had in front of it
-- and this migration does not have that evidence; inventing one from a stored
-- summary would put controls leads on the lighting board, which is worse than
-- leaving them honestly unclassified until the next run restamps them.

alter table public.research_signals
  add column if not exists line text not null default '';

alter table public.research_opportunities
  add column if not exists line text not null default '';

comment on column public.research_signals.line is
  'Business line key from the brand''s own customFields.business_lines (e.g. lighting, controls). '''' when it could not be tied to one.';
comment on column public.research_opportunities.line is
  'Business line key from the brand''s own customFields.business_lines. '''' when it could not be tied to one.';

-- The report reads "every open lead in controls" on every render, and the
-- tracker is the list that grows without bound.
create index if not exists research_opportunities_ws_line_idx
  on public.research_opportunities (workspace_id, line);
create index if not exists research_signals_ws_line_idx
  on public.research_signals (workspace_id, line);
