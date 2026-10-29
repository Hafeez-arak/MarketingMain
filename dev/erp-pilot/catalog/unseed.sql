-- ─── Remove the Catalog TEST data from the LOCAL v2 database ───────────────
-- 2026-10-30. Deletes every catalog row of every company (the catalog_*
-- tables hold nothing else locally: the only data in them is seed.sql's
-- invented items). The tables and rules stay. LOCAL ONLY.
--
--   docker exec -i supabase_db_arak-v2 psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < dev/erp-pilot/catalog/unseed.sql

\set ON_ERROR_STOP 1
begin;
-- Refuse if anything that is not test data has appeared.
do $$ begin
  if exists (select 1 from public.catalog_items where name not like '%(test)%')
     or exists (select 1 from public.catalog_spec_fields where name not like '%(test)%') then
    raise exception 'the catalog holds rows that are not test data: not removing anything';
  end if;
end $$;
delete from public.catalog_item_specs;
delete from public.catalog_items;
delete from public.catalog_spec_fields;
delete from public.catalog_audit;
commit;
