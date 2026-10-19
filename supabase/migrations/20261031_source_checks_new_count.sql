-- ─── How much of a source check was new ────────────────────────────────────
-- 2026-10-19, second pass on the source sweep. A source is now read directly
-- where it can be (its feed, its LinkedIn page, its Instagram posts through
-- Meta), and the lenses are handed only what is NEW since that source's last
-- check. new_count is that number; result_count stays the total read.
-- Null on rows written before this existed.
alter table public.research_source_checks
  add column if not exists new_count int;
