-- ════════════════════════════════════════════════════════════════════════
-- Tags on media_library — lets generated images/videos saved from the
-- content-generation flow (plan id, idea id, platform) be found later
-- without a separate gallery table. media_library itself predates this
-- repo's migrations (no CREATE TABLE here), so this is additive only —
-- if it already has a tags column this is a no-op.
--
-- Run ONCE in the Supabase SQL editor. Idempotent + additive.
-- ════════════════════════════════════════════════════════════════════════

alter table public.media_library
  add column if not exists tags text[] default '{}';
