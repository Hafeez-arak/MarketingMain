-- ════════════════════════════════════════════════════════════════════════
-- Applied directly to the Arak Marketing project (vxjhfvehccftvajgtqtv) on
-- 2026-08-10, via the Supabase MCP once it was reconnected to the correct
-- project. Recorded here so a fresh setup's migration history matches what
-- is actually live, and so the gap this closes doesn't recur.
--
-- Why this exists as a SEPARATE file from 20260810_creative_studio.sql:
-- that file's `create table if not exists` already had `original_prompt`
-- and `prompt_source` added to its CREATE TABLE body, but `IF NOT EXISTS`
-- is a no-op once the table exists — it does not diff or add columns. The
-- table had already been created (by an earlier run of that file, before
-- these two columns were added to it), so re-running it silently did
-- nothing for these columns. This file is the idempotent patch for that
-- case, safe to run on top of either state.
-- ════════════════════════════════════════════════════════════════════════

alter table public.creative_versions add column if not exists original_prompt text default '';
alter table public.creative_versions add column if not exists prompt_source text not null default 'raw';

alter table public.creative_versions drop constraint if exists creative_versions_prompt_source_check;
alter table public.creative_versions add constraint creative_versions_prompt_source_check
  check (prompt_source in ('raw', 'enhanced', 'enhanced_edited'));
