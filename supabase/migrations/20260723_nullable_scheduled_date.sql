-- A plan idea can reach Generate Post before it has a scheduled_date (e.g. a
-- manually-typed idea added without picking a date). The frontend already
-- treats scheduled_date as optional everywhere (Approvals.jsx, InstagramPage,
-- LinkedInPage, CampaignPlanner all use `r.scheduled_date || null`) — the
-- actual scheduling step happens later, separately, via instagram_schedule /
-- linkedin_schedule. The generated-post tables' NOT NULL was stricter than
-- every consumer of the column, and broke inserts for date-less ideas.
alter table public.instagram_generated_posts alter column scheduled_date drop not null;
alter table public.linkedin_generated_posts  alter column scheduled_date drop not null;
