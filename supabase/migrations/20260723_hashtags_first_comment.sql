-- Hashtags + first-comment as real planning-time fields, not something that
-- only appears after generation. plan_ideas.hashtags lets a human override
-- the AI's hashtag choice before a single Anthropic call is made; carried
-- through into the generated post row (both platforms) either way.
alter table public.plan_ideas add column if not exists hashtags text;
alter table public.plan_ideas add column if not exists first_comment text;
alter table public.instagram_generated_posts add column if not exists first_comment text;
alter table public.linkedin_generated_posts add column if not exists first_comment text;
