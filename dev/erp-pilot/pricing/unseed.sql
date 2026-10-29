-- ─── Remove the pricing test data (LOCAL v2 database) ──────────────────────
-- Deletes the "(test)" sheets of Arak Lighting with their lines and supplier
-- quotes. A submitted or approved test sheet is sent back or cancelled first
-- by whoever tested it; this script returns drafts to nothing and cancels
-- nothing else, so run it after a draft-only seed. The history rows stay.
--
--   docker exec -i supabase_db_arak-v2 psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < dev/erp-pilot/pricing/unseed.sql
\set ON_ERROR_STOP 1
begin;
-- Test sheets that were moved on: put them back to draft first (database owner).
alter table public.pricing_sheets disable trigger pricing_sheets_guard;
update public.pricing_sheets set status = 'draft', submitted_at = null, submitted_by = null, approved_at = null, approved_by = null,
  cancelled_at = null, cancelled_by = null, cancel_reason = null, min_margin_pct = null
 where workspace_id = '00000000-0000-0000-0000-000000000001' and title like '%(test)';
alter table public.pricing_sheets enable trigger pricing_sheets_guard;
delete from public.pricing_sheets where workspace_id = '00000000-0000-0000-0000-000000000001' and title like '%(test)';
commit;
