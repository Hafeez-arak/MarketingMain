-- Planning finalization, part 1: real scheduling + purpose per post.
--
-- Adds:
--   content_plans.posting_days   — which weekdays the brand actually posts on
--                                   (e.g. {sun,tue,thu}). Empty = AI decides freely.
--   content_plans.default_time   — the default publish time (HH:MM, 24h) for
--                                   Instagram posts. LinkedIn is biased toward
--                                   business hours by the planner regardless.
--   plan_ideas.publish_time      — the actual assigned time for this post.
--   plan_ideas.objective         — what this post is FOR (Awareness, Engagement,
--                                   Sales/Leads, Trust/Credibility, Community).
--   plan_ideas.cta               — the specific call-to-action for this post.
--
-- Idempotent + additive. Run once in the Supabase SQL editor.

alter table public.content_plans
  add column if not exists posting_days text[] default '{}',
  add column if not exists default_time text default '19:00';

alter table public.plan_ideas
  add column if not exists publish_time text default '',
  add column if not exists objective    text default '',
  add column if not exists cta          text default '';
