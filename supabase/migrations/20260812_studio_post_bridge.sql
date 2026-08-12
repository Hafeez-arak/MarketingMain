-- ════════════════════════════════════════════════════════════════════════
-- Studio ↔ Plan bridge
--
-- Until now Creative Studio was a dead end: finalizeVersion() copied a
-- finished asset into media_library and stopped, and media_library is only
-- read back as *reference* images for the next generation. There was no way
-- for an asset made in Studio to become a post. Meanwhile the plan → post →
-- Zernio publish spine was fully built but could only ever be fed by the
-- plan-generation workflows.
--
-- This migration adds the join, in three parts:
--   1. plan_ideas   — 'studio' as an image_mode, plus multi-platform targets
--   2. creative_sessions — the reverse link back to the idea, + a brief
--   3. the three post tables — provenance, so a post knows which Studio
--      version it came from
--
-- Run ONCE in the Supabase SQL editor. Idempotent + additive.
-- ════════════════════════════════════════════════════════════════════════


-- ── 1. plan_ideas ───────────────────────────────────────────────────────
-- image_mode = 'studio' is the single flag that prevents a DOUBLE SPEND,
-- and it is the reason this migration exists at all.
--
-- Today, finalizing a plan calls the plan-generation workflow, which pays
-- fal for an image for EVERY approved idea. If a human also builds that
-- same idea by hand in Creative Studio, the workspace is billed twice for
-- one post — once for an image nobody will ever use. 'studio' tells the
-- generation path to skip media for this idea and write the post row with
-- an empty image_url, waiting for the Studio asset to fill it in.
--
-- The existing constraint is named by 20260703_plan_brief_and_vision.sql;
-- drop-then-add rather than a second constraint, so there is exactly one
-- rule about this column and no chance of two disagreeing.

alter table public.plan_ideas
  drop constraint if exists plan_ideas_image_mode_check;

alter table public.plan_ideas
  add constraint plan_ideas_image_mode_check
  check (image_mode in ('generate', 'use_reference', 'studio'));


-- platforms: where this one idea is meant to go.
--
-- `platform` (singular) stays and stays AUTHORITATIVE — every existing
-- workflow, the three generated-post tables, and fetchPastIdeas all read
-- it, and nothing here changes that. `platforms` is additive intent: the
-- set of targets the operator picked, used to pre-select the aspect ratio
-- before generation and to pre-check the platform chips when the asset is
-- sent onward.
--
-- Why this matters more than it looks: IG Reel, TikTok and Snapchat
-- Spotlight are all 9:16, while an IG feed image is 4:5. Choosing targets
-- BEFORE generating means one 9:16 render covers three platforms. Choosing
-- after means paying to render the same idea again at a second ratio.
--
-- Backfilled from `platform` so no existing row is left with an empty set
-- that the UI would have to special-case.

alter table public.plan_ideas
  add column if not exists platforms text[] default '{}';

update public.plan_ideas
   set platforms = array[platform]
 where coalesce(array_length(platforms, 1), 0) = 0
   and coalesce(platform, '') <> '';


-- ── 2. creative_sessions ────────────────────────────────────────────────
-- The reverse link lives HERE and only here.
--
-- One plan idea can spawn several sessions (you restart, you try a
-- different direction, you abandon one). A session belongs to at most one
-- idea. Putting a creative_session_id on plan_ideas as well would be two
-- columns that can disagree about the same relationship, with nothing to
-- keep them honest — so the plan board instead queries
--   creative_sessions?plan_idea_id=in.(...)
-- in one call, which is the exact shape contentPlans.js#fetchIdeaDrafts
-- already uses for draft state.
--
-- on delete set null, not cascade: deleting a plan idea must never destroy
-- generated work the workspace paid fal for. The session survives as an
-- orphan in the Studio sidebar, which is the correct outcome.

alter table public.creative_sessions
  add column if not exists plan_idea_id uuid references public.plan_ideas(id) on delete set null,
  add column if not exists brief        jsonb;

-- Partial: only sessions opened from a plan are ever looked up this way,
-- and they are a small minority of rows.
create index if not exists creative_sessions_plan_idea_idx
  on public.creative_sessions(plan_idea_id)
  where plan_idea_id is not null;

comment on column public.creative_sessions.brief is
  'Snapshot of the plan idea at session-open time (topic, angle, tone, occasion, '
  'pillar, format, ratio, image_idea). A SNAPSHOT on purpose: the session records '
  'what was actually asked for, so later edits to the idea do not silently rewrite '
  'the brief the asset was made against.';


-- ── 3. Provenance on the three post tables ──────────────────────────────
-- So a post row can answer "where did this media come from" without a
-- reverse scan, and so re-sending an asset updates the same row instead of
-- creating a second post for one idea.
--
-- The foreach idiom is copied verbatim from
-- 20260809_zernio_publishing_analytics.sql. Use it for anything touching
-- these three tables: adding a column to two of the three fails later as
-- an opaque PostgREST 400, which every read path in this app swallows into
-- an empty array — so the symptom is silently missing data, not an error.
--
-- creative_version_id is deliberately NOT a foreign key. creative_versions
-- rows are the unit of iteration and get pruned; a post that outlives the
-- version it was made from should keep the id as a record rather than have
-- the reference nulled out or block the delete.

do $$
declare t text;
begin
  foreach t in array array[
    'instagram_generated_posts',
    'linkedin_generated_posts',
    'generated_posts'
  ] loop
    execute format($f$
      alter table public.%I
        add column if not exists creative_session_id uuid references public.creative_sessions(id) on delete set null,
        add column if not exists creative_version_id uuid;
    $f$, t);

    -- source: widen to include 'studio' — a post whose media was made by
    -- hand in Creative Studio rather than by the plan-generation workflow.
    -- List copied from 20260702_allow_plan_source.sql and extended.
    execute format($f$
      alter table public.%I drop constraint if exists %I;
    $f$, t, t || '_source_check');

    execute format($f$
      alter table public.%I add constraint %I
        check (source in ('scheduled', 'manual', 'plan', 'generated', 'studio'));
    $f$, t, t || '_source_check');

    execute format($f$
      create index if not exists %I on public.%I(creative_session_id)
        where creative_session_id is not null;
    $f$, t || '_creative_session_idx', t);
  end loop;
end $$;
