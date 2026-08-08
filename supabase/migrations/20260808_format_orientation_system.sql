-- ════════════════════════════════════════════════════════════════════════
-- Format & orientation system — plan ideas get an explicit, human-editable
-- format (feed image / carousel / reel / story / video / text only) and
-- aspect ratio, instead of the orphaned `suggested_format` (never read by
-- generation) and AI-only `suggested_aspect_ratio` (never editable, 9:16
-- unreachable). See src/lib/postFormats.js for the catalog these columns
-- are validated against on the frontend.
--
-- `suggested_format` / `suggested_aspect_ratio` are left in place as AI
-- telemetry (what the planner originally proposed, for comparing against
-- what the human actually picked) — generation now reads `format` /
-- `aspect_ratio` instead.
--
-- `post_kind` stays as a DERIVED compatibility value for the existing v2
-- generation engine, computed by src/lib/postFormats.js#derivePostKind —
-- never set independently. Widened here to add 'video' and 'text_only' so
-- the new formats have somewhere valid to land until the engine itself is
-- upgraded (Step 4).
--
-- `group_id` links sibling ideas created by fanning one idea out to another
-- platform (same idea, different platform) — used to keep cross-platform
-- siblings out of each other's "don't repeat this" history and to collapse
-- them into one card once multi-platform boards exist (Step 5).
--
-- Run ONCE in the Supabase SQL editor. Idempotent + additive.
-- ════════════════════════════════════════════════════════════════════════

alter table public.plan_ideas
  add column if not exists format        text default '',
  add column if not exists aspect_ratio  text default '',
  add column if not exists media_type    text default 'image'
               check (media_type in ('image','video','none')),
  add column if not exists group_id      uuid,
  add column if not exists wants_caption boolean default true;

alter table public.plan_ideas
  drop constraint if exists plan_ideas_post_kind_check;
alter table public.plan_ideas
  add constraint plan_ideas_post_kind_check
  check (post_kind in ('caption_only','image_only','caption_image','carousel','text_image','video','text_only'));

-- Backfill existing rows from the old suggested_format / post_kind so
-- nothing already planned loses its format when this ships.
update public.plan_ideas
set
  format = case
    when post_kind = 'carousel' then 'carousel'
    when platform = 'instagram' and suggested_format = 'reel' then 'reel'
    when platform = 'linkedin' and post_kind = 'caption_only' then 'text_only'
    else 'feed_image'
  end,
  media_type = case
    when platform = 'instagram' and suggested_format = 'reel' then 'video'
    when post_kind = 'caption_only' then 'none'
    else 'image'
  end,
  wants_caption = (post_kind <> 'image_only')
where format = '' or format is null;

update public.plan_ideas
set aspect_ratio = coalesce(
  nullif(suggested_aspect_ratio, ''),
  case when format = 'reel' or format = 'story' then '9:16'
       when platform = 'linkedin' then '1.91:1'
       else '1:1' end
)
where aspect_ratio = '' or aspect_ratio is null;

create index if not exists plan_ideas_group_id_idx on public.plan_ideas(group_id) where group_id is not null;
