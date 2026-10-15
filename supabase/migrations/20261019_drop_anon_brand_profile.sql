-- 20261019_drop_anon_brand_profile.sql — applied by hand 2026-10-15.
--
-- brand_profile_anon_legacy_only let the publishable anon key (shipped in the
-- browser bundle) read AND write Arak's brand profile — command ALL, scoped to
-- the Arak workspace. Found 2026-09-10; it protected nothing: n8n reads with
-- the service-role key, and so do api/leads and api/agent, which bypass RLS.
-- Signed-in members keep access through brand_profile_members_only.
drop policy if exists brand_profile_anon_legacy_only on public.brand_profile;
