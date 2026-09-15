-- ════════════════════════════════════════════════════════════════════════
-- plan_ideas.platform_options — per-platform extras on a planned post
-- ════════════════════════════════════════════════════════════════════════
-- LinkedIn joined the campaign planner on 2026-09-15, and one of its formats
-- is a poll. A poll's question and 2–4 answers are the post as much as its
-- text is, and plan_ideas had nowhere to keep them: every column here is
-- either shared by all platforms (caption, format, aspect ratio) or
-- Instagram's (slide_count, image_text).
--
-- Named and shaped exactly like generated_posts.platform_options
-- (20260825_zernio_multi_platform.sql), because finalising a plan copies it
-- across unchanged and the composer reads it from there. One shape in both
-- tables is what stops a poll being translated, and lost, on the way.
--
-- jsonb rather than a poll_question column plus a poll_options array: the
-- next per-platform field should not need a migration, and the composer
-- already treats this object as "whatever this platform was configured
-- with".
--
-- The app only NAMES this column on an insert when an idea carries options,
-- so an Instagram-only plan keeps working on a database that has not had
-- this run yet. A LinkedIn poll does not — run this before using one.
--
-- Run ONCE in the Supabase SQL editor. Idempotent + additive.
-- ════════════════════════════════════════════════════════════════════════

alter table public.plan_ideas
  add column if not exists platform_options jsonb not null default '{}'::jsonb;

comment on column public.plan_ideas.platform_options is
  'Per-platform extras with no column of their own — today a LinkedIn poll: {"poll":{"question","options":[],"duration"}}. Same shape as generated_posts.platform_options; finalize copies it across.';

-- PostgREST caches the schema; without this the new column 404s until the
-- next restart.
notify pgrst, 'reload schema';
