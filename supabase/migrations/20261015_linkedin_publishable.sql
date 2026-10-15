-- ─── ARAK Lighting's LinkedIn page becomes publishable ─────────────────────
--
-- 20260914_protected_accounts.sql set is_protected = true on every LinkedIn
-- account, because the page was connected for reporting only. For the
-- production handover (2026-10-14) the owner decided that plans publish to
-- the LinkedIn page like Instagram, and PROTECTED_PLATFORMS in
-- src/lib/platformSafety.js and the n8n Publish Post node were emptied in the
-- same change. This clears the per-account flag to match.
--
-- The column stays: marking any single account protected again is still a
-- one-row update, with no deploy.
--
-- Applied by hand on 2026-10-15 (owner present).

update public.social_accounts
   set is_protected = false
 where platform = 'linkedin'
   and is_protected;
