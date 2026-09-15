-- ════════════════════════════════════════════════════════════════════════
-- research_events.takeaway — what came out of an event that already happened
-- ════════════════════════════════════════════════════════════════════════
-- The events lens (2026-09-15) reports recent editions as well as upcoming
-- ones: who exhibited, what was announced, what competitors showed. That is
-- the reason to list an event that has ended at all, and it is a different
-- thing from `recommendation` (what we should do), so it gets its own column.
--
-- Additive, nullable-free with a default, so rows written before this exist
-- unchanged. Must be applied before the first run on the code that writes it:
-- an insert naming a missing column is refused by PostgREST, and persistIntel
-- logs and skips that row rather than failing the run.

alter table public.research_events
  add column if not exists takeaway text not null default '';
