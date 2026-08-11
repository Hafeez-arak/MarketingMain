-- ════════════════════════════════════════════════════════════════════════
-- Creative Studio — multi-clip video: one reel built from N generated clips.
--
-- Why this exists: no model here renders a long video affordably. Seedance
-- 2.5 is the only one that reaches 30s at all, at $0.4730/s @720p — $14.19
-- for a single 30s take. The same 30 seconds as 6×5s Kling 2.5 Turbo clips
-- is $2.10. Long video was either unaffordable or impossible; this makes it
-- a storyboard of short clips, chained for continuity and stitched by
-- ffmpeg afterwards (the Creative Stitch workflow).
--
-- Two things get stored, and the split is deliberate:
--
--  · The PLAN lives on the session (`storyboard`). Prompts typed but not yet
--    rendered, seam settings, the style bible, the shared reference set. It
--    has to survive a refresh before anything has been generated, and it has
--    to live somewhere n8n never writes — which rules out the obvious home,
--    `creative_versions.overlay_state`, because the video workflow REPLACES
--    that column wholesale when it records a fal request id. n8n touches
--    creative_versions constantly and creative_sessions never.
--
--  · The RESULT stays on creative_versions, one row per clip, exactly like
--    every other generated asset. `clip_index` says which shot it is;
--    `clip_attempt` says which try. The stitched reel is one more row with
--    `clip_role = 'stitch'` and no clip_index.
--
-- `parent_version_id` keeps the meaning it has everywhere else in this
-- schema — "this row supersedes that row" — so it chains re-render attempts
-- at the same clip_index, NOT the continuity chain between clips. Continuity
-- is a property of the seam and lives in the storyboard blob. Overloading
-- the parent link would have broken buildBranches(), which derives a whole
-- chat lane from it: six hard-cut clips would have rendered as six
-- side-by-side lanes.
--
-- Run ONCE in the Supabase SQL editor. Idempotent + additive.
--
-- APPLIED to the live project (vxjhfvehccftvajgtqtv) 2026-08-11, recorded as
-- migration 20260811151132 creative_multi_clip. Verified against the live
-- schema: all five columns, both indexes (with the partial predicate) and the
-- widened intent constraint are present and match this file. Kept here as the
-- repo's record of what the schema is, like every other file in this folder.
-- ════════════════════════════════════════════════════════════════════════

-- ── Sessions ───────────────────────────────────────────────────────────

-- A third mode beside image and video. 'image_video' stays allowed for the
-- sessions created under it before it was dropped from the picker.
alter table public.creative_sessions drop constraint if exists creative_sessions_intent_check;
alter table public.creative_sessions add constraint creative_sessions_intent_check
  check (intent in ('image', 'video', 'image_video', 'multi_video'));

-- The editable plan. jsonb rather than a clips table because nothing ever
-- queries INTO it — it is read and written whole, by one page, and a row per
-- unrendered clip would be five columns of nullable draft state plus an
-- ordering column to keep in sync with an array the UI already has.
alter table public.creative_sessions add column if not exists storyboard jsonb;

-- Whether a render run was still going when the tab last closed. Drives the
-- "this run stopped — Continue?" banner and NOTHING else. Deliberately not a
-- lock: it can't see a second tab, it has no lease and no TTL, and treating
-- it as one would mean a crashed tab wedges the session forever. The real
-- protection against a double render is the unique index below.
alter table public.creative_sessions add column if not exists clip_run_status text not null default '';


-- ── Versions ───────────────────────────────────────────────────────────

-- Which shot this row is, and which attempt at it. clip_attempt rather than
-- reusing `round`: round stays the session-global counter it is everywhere
-- else, and the unique index below needs a column that means exactly "nth
-- try at this clip" and nothing more.
alter table public.creative_versions add column if not exists clip_index   int;
alter table public.creative_versions add column if not exists clip_attempt int;
-- 'stitch' for the assembled reel; null for an ordinary clip. Not a check
-- constraint, matching model/duration/resolution on this table — the studio
-- gains roles more often than a constraint would be worth keeping in sync.
alter table public.creative_versions add column if not exists clip_role    text;

-- THE mutex, and the reason multi-clip can spend money safely.
--
-- Clips render one at a time, driven from the browser: the page notices clip
-- N went ready and inserts clip N+1. Two tabs open on the same session both
-- notice, and both insert — that is two paid renders of the same shot, and a
-- useRef guard inside one tab cannot see the other. Here they collide on the
-- index instead: one insert wins, the other gets 23505 and backs off. No
-- lease, no clock skew, no TTL, no way for a crashed tab to wedge anything.
--
-- Partial so it constrains only clip rows — every image, edit, overlay and
-- single-clip video row in this table has clip_index null, and unique
-- indexes in Postgres treat nulls as distinct anyway.
create unique index if not exists creative_versions_clip_attempt_uidx
  on public.creative_versions (session_id, clip_index, clip_attempt)
  where clip_index is not null;

-- Reading a storyboard means "latest attempt per clip, in shot order".
-- Ordered clip_attempt desc so that lookup is a straight index scan.
create index if not exists creative_versions_clip_idx
  on public.creative_versions (session_id, clip_index, clip_attempt desc)
  where clip_index is not null;
