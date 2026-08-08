-- ════════════════════════════════════════════════════════════════════════
-- generated_posts — one shared table for platforms without their own
-- dedicated one (TikTok, Snapchat today). Specced as a SUPERSET of
-- instagram_generated_posts / linkedin_generated_posts's columns (incl.
-- format/media_type/video fields from the 2026-08-08 format-orientation
-- and video-fields migrations) rather than a narrower TikTok/Snapchat-only
-- shape — so if IG/LI are ever folded into this table later, no column
-- needs adding at that point. Not done now: merging IG/LI (which already
-- have real data + workflows depending on their own tables) is a separate,
-- higher-risk decision, not something to bundle into onboarding two new
-- platforms.
--
-- `platform` is a real column here (unlike the per-platform tables, where
-- it's implicit in the table name) since one table now serves several.
--
-- status/source CHECKs copied verbatim from 20260702_allow_plan_source.sql
-- (the widened set both existing tables already use) so this table is
-- compatible with the exact same review/approval lifecycle from day one.
-- RLS policy copied verbatim from plan_ideas_rw (20260701_content_plans.sql).
--
-- Run ONCE in the Supabase SQL editor. Idempotent + additive.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.generated_posts (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  platform              text not null check (platform in ('tiktok', 'snapchat')),

  -- Copy
  caption               text default '',
  caption_ar            text default '',
  caption_en            text default '',
  hashtags              text default '',
  first_comment         text default '',
  topic                 text default '',

  -- Media
  format                text default '',          -- postFormats.js catalog id (video/photo_carousel/story/spotlight)
  media_type            text default 'image' check (media_type in ('image','video','none')),
  aspect_ratio          text default '',
  style                 text default '',
  image_url             text default '',
  image_urls            text[] default '{}',       -- carousel slides
  image_prompt          text default '',
  video_url             text default '',
  cover_image_url       text default '',
  motion_prompt         text default '',
  post_kind             text default 'caption_image',

  -- Scheduling / lifecycle
  scheduled_date        date,
  publish_time          text default '',
  status                text not null default 'pending_review'
                        check (status in ('pending_review', 'pending_publish', 'approved', 'scheduled', 'published', 'rejected', 'draft')),
  source                text not null default 'manual'
                        check (source in ('scheduled', 'manual', 'plan', 'generated')),

  -- Plan linkage (mirrors instagram_generated_posts.plan_id/plan_idea_id)
  plan_id               uuid,
  plan_idea_id          uuid,
  campaign_id           uuid,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists generated_posts_ws_idx       on public.generated_posts(workspace_id);
create index if not exists generated_posts_platform_idx on public.generated_posts(platform);
create index if not exists generated_posts_plan_idea_idx on public.generated_posts(plan_idea_id) where plan_idea_id is not null;

alter table public.generated_posts enable row level security;

drop policy if exists generated_posts_rw on public.generated_posts;
create policy generated_posts_rw on public.generated_posts
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
