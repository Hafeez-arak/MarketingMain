-- One-time cleanup: remove the leftover TEST-ONE company.
--
-- Kept separate from the access-control migration on purpose. That one is
-- structural and safe to re-run; this one deletes a tenant, and destructive
-- data changes should never be buried inside a schema change where someone
-- re-running the file wouldn't expect them.
--
-- Verified empty before writing this: zero rows in content_plans, plan_ideas,
-- generated_posts, media_library, brand_profile, creative_sessions, and
-- instagram_schedule for this workspace. The only thing the cascade removes
-- is the workspace row itself and its single membership.
--
-- Matched by name + the absence of any content rather than by a pasted uuid,
-- so it cannot delete a real client's company if this is ever run against a
-- different database.

delete from public.workspaces w
where w.name = 'TEST-ONE'
  and not exists (select 1 from public.content_plans     t where t.workspace_id = w.id)
  and not exists (select 1 from public.generated_posts   t where t.workspace_id = w.id)
  and not exists (select 1 from public.media_library     t where t.workspace_id = w.id)
  and not exists (select 1 from public.brand_profile     t where t.workspace_id = w.id)
  and not exists (select 1 from public.creative_sessions t where t.workspace_id = w.id);
