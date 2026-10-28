-- ─── Remove the HR TEST data from the LOCAL v2 database ───────────────────
-- 2026-10-28. Deletes every HR row of every company (the hr_* tables hold
-- nothing else locally: the only data in them is seed.sql's invented
-- people). The tables, rules and functions stay. LOCAL ONLY.
--
--   docker exec -i supabase_db_arak-v2 psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < dev/erp-pilot/hr/unseed.sql

\set ON_ERROR_STOP 1
begin;
-- Refuse if anything that is not test data has appeared.
do $$ begin
  if exists (select 1 from public.hr_employees where name_en not like '%(test)%' and name_ar not like '%(تجربة)%') then
    raise exception 'hr_employees holds rows that are not test data: not removing anything';
  end if;
end $$;
delete from public.hr_attendance_changes;
delete from public.hr_attendance;
delete from public.hr_leave_requests;
delete from public.hr_leave_balances;
delete from public.hr_leave_types;
delete from public.hr_documents;
delete from public.hr_contracts;
update public.hr_departments set head_id = null;
update public.hr_employees set manager_id = null;
delete from public.hr_employees;
delete from public.hr_departments;
delete from public.hr_settings;
commit;
