-- ─── Catalog: the database's rules, tested (LOCAL v2 database only) ────────
-- 2026-10-30. Who may read and change what, company separation, and the
-- rules of 20261130_catalog_*.sql, checked the way the browser reaches them:
-- role `authenticated` with a login in request.jwt.claims. Runs on the live
-- local database AFTER seed.sql, inside one transaction that is rolled back,
-- so it leaves nothing behind.
--
--   dev/erp-pilot/catalog/run-tests.sh
--
-- Logins of the local copy used here (their Catalog grants are made in the test):
--   staff.admin@arak-sa.com     access admin: Manage everywhere
--   staff.dev@arak-sa.com     member of every company; Catalog Work in Arak Lighting
--   staff.marketing@arak-sa.com     member of Arak Lighting and Ghusn; Catalog View in Arak
--                          Lighting only
--   outside.two@example.com member of Aqeeq and Alo Kheyatah only

\set ON_ERROR_STOP 1
set client_min_messages = warning;
begin;

create temp table t (n serial, name text, ok boolean, detail text);
grant all on t to public;
grant all on sequence t_n_seq to public;
\o /dev/null

-- Run one query as a login (null = signed out) and return its single value as text.
create function pg_temp.q(p_email text, p_sql text) returns text as $$
declare v text;
begin
  perform set_config('request.jwt.claims',
    case when p_email is null then '' else json_build_object('sub', (select id from auth.users where email = p_email), 'role', 'authenticated')::text end, true);
  execute case when p_email is null then 'set local role anon' else 'set local role authenticated' end;
  execute p_sql into v;
  reset role;
  return v;
end $$ language plpgsql;

-- Run as a login; the error it raised, or 'no error'.
create function pg_temp.err(p_email text, p_sql text) returns text as $$
begin
  begin
    perform pg_temp.q(p_email, p_sql);
  exception when others then
    reset role;
    return sqlerrm;
  end;
  reset role;
  return 'no error';
end $$ language plpgsql;

create function pg_temp.eq(p_name text, p_actual anyelement, p_expected anyelement) returns void as $$
  insert into t (name, ok, detail) values (p_name, p_actual is not distinct from p_expected, format('actual=%s expected=%s', p_actual, p_expected));
$$ language sql;

create function pg_temp.refused(p_name text, p_email text, p_sql text, p_needle text) returns void as $$
declare e text := pg_temp.err(p_email, p_sql);
begin
  insert into t (name, ok, detail) values (p_name, position(p_needle in e) > 0, e);
end $$ language plpgsql;

create function pg_temp.uid(p_email text) returns uuid as $$ select id from auth.users where email = p_email $$ language sql;

\set arak '''00000000-0000-0000-0000-000000000001'''
select set_config('cat.ghusn', (select id::text from public.workspaces where name = 'Ghusn'), true);
select set_config('cat.item', (select id::text from public.catalog_items where code = 'T-1001'), true);
select set_config('cat.field', (select id::text from public.catalog_spec_fields where name_en = 'Power (test)'), true);

-- Grants for this test only (rolled back).
insert into public.section_access (workspace_id, user_id, section, level) values
  (:arak, pg_temp.uid('staff.dev@arak-sa.com'), 'catalog', 'work'),
  (:arak, pg_temp.uid('staff.marketing@arak-sa.com'), 'catalog', 'view')
on conflict (workspace_id, user_id, section) do update set level = excluded.level;

-- ══ Reading: access levels and company separation ══
select pg_temp.eq('read: signed out reads nothing (no privilege at all)',
  pg_temp.err(null, 'select count(*) from public.catalog_items') like '%permission denied%', true);
select pg_temp.eq('read: View sees the six items',
  pg_temp.q('staff.marketing@arak-sa.com', 'select count(*) from public.catalog_items'), '6');
select pg_temp.eq('read: View sees the fields, the specs and the history',
  pg_temp.q('staff.marketing@arak-sa.com', 'select (select count(*) from public.catalog_spec_fields) || ''/'' || (select count(*) from public.catalog_item_specs) || ''/'' || (select count(*) > 0 from public.catalog_audit)'), '5/11/true');
select pg_temp.eq('read: Work reads the same as View',
  pg_temp.q('staff.dev@arak-sa.com', 'select count(*) from public.catalog_items'), '6');
select pg_temp.eq('read: a login outside the company sees nothing',
  pg_temp.q('outside.two@example.com', 'select (select count(*) from public.catalog_items) + (select count(*) from public.catalog_spec_fields) + (select count(*) from public.catalog_item_specs) + (select count(*) from public.catalog_audit)'), '0');
select pg_temp.eq('read: a member with no Catalog grant sees nothing (Ghusn: View is Arak Lighting only)',
  pg_temp.q('staff.marketing@arak-sa.com', format('select count(*) from public.catalog_items where workspace_id = %L', current_setting('cat.ghusn'))), '0');

-- ══ Writing: only Manage ══
select pg_temp.refused('write: View cannot add an item', 'staff.marketing@arak-sa.com',
  format($s$insert into public.catalog_items (workspace_id, code, name, unit) values (%L, 'X-1 (test)', 'X (test)', 'pcs') returning id$s$, :arak), 'row-level security');
select pg_temp.refused('write: Work cannot add an item', 'staff.dev@arak-sa.com',
  format($s$insert into public.catalog_items (workspace_id, code, name, unit) values (%L, 'X-1 (test)', 'X (test)', 'pcs') returning id$s$, :arak), 'row-level security');
select pg_temp.eq('write: Work cannot change an item (no row updated)',
  pg_temp.q('staff.dev@arak-sa.com', $s$with u as (update public.catalog_items set name = 'Hacked (test)' where code = 'T-1001' returning 1) select count(*) from u$s$), '0');
select pg_temp.eq('write: View cannot switch an item off',
  pg_temp.q('staff.marketing@arak-sa.com', $s$with u as (update public.catalog_items set active = false where code = 'T-1001' returning 1) select count(*) from u$s$), '0');
select pg_temp.refused('write: Work cannot add a field', 'staff.dev@arak-sa.com',
  format($s$insert into public.catalog_spec_fields (workspace_id, name) values (%L, 'X (test)') returning id$s$, :arak), 'row-level security');
select pg_temp.refused('write: Work cannot add a spec value', 'staff.dev@arak-sa.com',
  format($s$insert into public.catalog_item_specs (workspace_id, item_id, field_id, value) values (%L, %L, (select id from public.catalog_spec_fields where name_en = 'Colour temperature (test)'), 'x')$s$, :arak, current_setting('cat.item')), 'row-level security');
select pg_temp.eq('write: View cannot delete a spec value',
  pg_temp.q('staff.marketing@arak-sa.com', $s$with d as (delete from public.catalog_item_specs returning 1) select count(*) from d$s$), '0');
select pg_temp.eq('write: Manage adds an item',
  pg_temp.q('staff.admin@arak-sa.com', format($s$insert into public.catalog_items (workspace_id, code, name, unit, created_by) values (%L, 'T-5000', 'Added (test)', 'pcs', %L) returning code$s$, :arak, pg_temp.uid('staff.admin@arak-sa.com'))), 'T-5000');
select pg_temp.eq('write: Manage changes an item and switches it off',
  pg_temp.q('staff.admin@arak-sa.com', $s$with u as (update public.catalog_items set active = false, brand = 'B (test)' where code = 'T-5000' returning 1) select count(*) from u$s$), '1');
select pg_temp.eq('write: Manage adds a field',
  pg_temp.q('staff.admin@arak-sa.com', format($s$insert into public.catalog_spec_fields (workspace_id, name, name_en, unit, sequence) values (%L, 'الجهد (test)', 'Voltage (test)', 'V', 60) returning name_en$s$, :arak)), 'Voltage (test)');
select pg_temp.eq('write: Manage adds a spec value',
  pg_temp.q('staff.admin@arak-sa.com', format($s$insert into public.catalog_item_specs (workspace_id, item_id, field_id, value)
               values (%L, (select id from public.catalog_items where code = 'T-5000'), (select id from public.catalog_spec_fields where name_en = 'Voltage (test)'), '24') returning value$s$, :arak)), '24');
select pg_temp.eq('write: Manage changes a spec value',
  pg_temp.q('staff.admin@arak-sa.com', $s$with u as (update public.catalog_item_specs set value = '48' where value = '24' and item_id = (select id from public.catalog_items where code = 'T-5000') returning 1) select count(*) from u$s$), '1');
select pg_temp.eq('write: Manage removes a spec value (a blank one is a deleted row)',
  pg_temp.q('staff.admin@arak-sa.com', $s$with d as (delete from public.catalog_item_specs where value = '48' returning 1) select count(*) from d$s$), '1');

-- ══ Rules on the rows ══
select pg_temp.refused('code: unique within a company', 'staff.admin@arak-sa.com',
  format($s$insert into public.catalog_items (workspace_id, code, name, unit) values (%L, 'T-1001', 'Again (test)', 'pcs')$s$, :arak), 'catalog_items_code_uq');
select pg_temp.eq('code: another company can use the same code',
  pg_temp.q('staff.admin@arak-sa.com', format($s$insert into public.catalog_items (workspace_id, code, name, unit) values (%L, 'T-1001', 'Same code elsewhere (test)', 'pcs') returning code$s$, current_setting('cat.ghusn'))), 'T-1001');
select pg_temp.refused('code: no leading or trailing spaces', 'staff.admin@arak-sa.com',
  format($s$insert into public.catalog_items (workspace_id, code, name, unit) values (%L, ' T-7000', 'Spaced (test)', 'pcs')$s$, :arak), 'catalog_items_code_check');
select pg_temp.refused('code: not empty', 'staff.admin@arak-sa.com',
  format($s$insert into public.catalog_items (workspace_id, code, name, unit) values (%L, '', 'Empty (test)', 'pcs')$s$, :arak), 'catalog_items_code_check');
select pg_temp.refused('item: a name is needed', 'staff.admin@arak-sa.com',
  format($s$insert into public.catalog_items (workspace_id, code, name, unit) values (%L, 'T-7001', '  ', 'pcs')$s$, :arak), 'catalog_items_name_check');
select pg_temp.refused('item: a unit is needed', 'staff.admin@arak-sa.com',
  format($s$insert into public.catalog_items (workspace_id, code, name, unit) values (%L, 'T-7002', 'No unit (test)', ' ')$s$, :arak), 'catalog_items_unit_check');
select pg_temp.refused('item: an optional text is null or not empty', 'staff.admin@arak-sa.com',
  format($s$insert into public.catalog_items (workspace_id, code, name, unit, brand) values (%L, 'T-7003', 'Blank brand (test)', 'pcs', '  ')$s$, :arak), 'catalog_items_brand_check');
select pg_temp.refused('field: names are unique in a company, case aside', 'staff.admin@arak-sa.com',
  format($s$insert into public.catalog_spec_fields (workspace_id, name) values (%L, '  الجهد (TEST)  ')$s$, :arak), 'catalog_spec_fields_name_uq');
select pg_temp.refused('field: a name is needed', 'staff.admin@arak-sa.com',
  format($s$insert into public.catalog_spec_fields (workspace_id, name) values (%L, ' ')$s$, :arak), 'catalog_spec_fields_name_check');
select pg_temp.refused('field: an optional unit is null or not empty', 'staff.admin@arak-sa.com',
  format($s$insert into public.catalog_spec_fields (workspace_id, name, unit) values (%L, 'Z (test)', '')$s$, :arak), 'catalog_spec_fields_unit_check');
select pg_temp.refused('spec: a blank value is refused', 'staff.admin@arak-sa.com',
  format($s$insert into public.catalog_item_specs (workspace_id, item_id, field_id, value) values (%L, %L, (select id from public.catalog_spec_fields where name_en = 'IP rating (test)'), '   ')$s$, :arak, current_setting('cat.item')), 'catalog_item_specs_value_check');
select pg_temp.refused('spec: one value per item and field', 'staff.admin@arak-sa.com',
  format($s$insert into public.catalog_item_specs (workspace_id, item_id, field_id, value) values (%L, %L, %L, '99')$s$, :arak, current_setting('cat.item'), current_setting('cat.field')), 'catalog_item_specs_uq');
do $$
declare ghusn_field uuid; e text;
begin
  insert into public.catalog_spec_fields (workspace_id, name) values (current_setting('cat.ghusn')::uuid, 'Foreign (test)') returning id into ghusn_field;
  e := pg_temp.err('staff.admin@arak-sa.com', format($s$insert into public.catalog_item_specs (workspace_id, item_id, field_id, value) values ('00000000-0000-0000-0000-000000000001', %L, %L, 'x')$s$, current_setting('cat.item'), ghusn_field));
  insert into t (name, ok, detail) values ('spec: a field of another company is refused (composite key)', position('catalog_item_specs_field_fk' in e) > 0, e);
  e := pg_temp.err('staff.admin@arak-sa.com', format($s$update public.catalog_items set workspace_id = %L where code = 'T-1002'$s$, current_setting('cat.ghusn')));
  insert into t (name, ok, detail) values ('item: cannot move to another company', position('CATALOG_WORKSPACE_FIXED' in e) > 0 or position('catalog_item_specs' in e) > 0, e);
end $$;
select pg_temp.refused('item: a file path must sit in its own folder', 'staff.admin@arak-sa.com',
  format($s$update public.catalog_items set image_path = 'elsewhere/x.png' where code = 'T-1001' and workspace_id = %L$s$, :arak), 'catalog_items_image_place');

-- ══ No deleting items or fields ══
select pg_temp.eq('delete: Manage cannot delete an item (no policy, no grant)',
  pg_temp.err('staff.admin@arak-sa.com', $s$delete from public.catalog_items where code = 'T-5000'$s$) like '%permission denied%', true);
select pg_temp.eq('delete: Manage cannot delete a field',
  pg_temp.err('staff.admin@arak-sa.com', $s$delete from public.catalog_spec_fields where name_en = 'Voltage (test)'$s$) like '%permission denied%', true);
select pg_temp.eq('delete: nor the history',
  pg_temp.err('staff.admin@arak-sa.com', $s$delete from public.catalog_audit$s$) like '%permission denied%', true);
select pg_temp.eq('delete: the history cannot be written by hand',
  pg_temp.err('staff.admin@arak-sa.com', format($s$insert into public.catalog_audit (workspace_id, table_name, row_id, action) values (%L, 'x', gen_random_uuid(), 'insert')$s$, :arak)) like '%permission denied%', true);

-- ══ The history ══
select pg_temp.eq('history: an item added is written, with who',
  (select count(*) from public.catalog_audit a join public.catalog_items i on i.id = a.row_id
    where i.code = 'T-5000' and a.table_name = 'catalog_items' and a.action = 'insert' and a.changed_by = pg_temp.uid('staff.admin@arak-sa.com')), 1::bigint);
select pg_temp.eq('history: its change (switched off) is written with old and new',
  (select count(*) from public.catalog_audit a join public.catalog_items i on i.id = a.row_id
    where i.code = 'T-5000' and a.action = 'update' and (a.old_data->>'active')::boolean and not (a.new_data->>'active')::boolean), 1::bigint);
select pg_temp.eq('history: its spec value (added, changed, removed) is kept under the item',
  (select string_agg(a.action, ',' order by a.id) from public.catalog_audit a join public.catalog_items i on i.id = a.item_id
    where i.code = 'T-5000' and a.table_name = 'catalog_item_specs'), 'insert,update,delete');
select pg_temp.eq('history: a field added is written, under no item',
  (select count(*) from public.catalog_audit where table_name = 'catalog_spec_fields' and new_data->>'name_en' = 'Voltage (test)' and item_id is null), 1::bigint);
select pg_temp.eq('history: updated_at is the database''s clock (a hand-set value is overwritten)',
  pg_temp.q('staff.admin@arak-sa.com', $s$update public.catalog_items set updated_at = '2000-01-01', unit = 'box' where code = 'T-5000' returning (updated_at > '2020-01-01')::text$s$), 'true');

-- ══ Deleting a company still works with catalog rows in it ══
do $$
declare ws uuid; it uuid; fd uuid;
begin
  insert into public.workspaces (name) values ('Catalog delete test (test)') returning id into ws;
  insert into public.catalog_spec_fields (workspace_id, name) values (ws, 'F (test)') returning id into fd;
  insert into public.catalog_items (workspace_id, code, name, unit) values (ws, 'D-1', 'D (test)', 'pcs') returning id into it;
  insert into public.catalog_item_specs (workspace_id, item_id, field_id, value) values (ws, it, fd, 'v');
  update public.catalog_items set brand = 'B' where id = it;
  delete from public.workspaces where id = ws;
  insert into t (name, ok, detail) values ('company delete: cascades through every catalog table, the history included',
    not exists (select 1 from public.catalog_items where workspace_id = ws) and not exists (select 1 from public.catalog_spec_fields where workspace_id = ws)
    and not exists (select 1 from public.catalog_item_specs where workspace_id = ws) and not exists (select 1 from public.catalog_audit where workspace_id = ws), '');
exception when others then
  insert into t (name, ok, detail) values ('company delete: cascades through every catalog table, the history included', false, sqlerrm);
end $$;

-- ══ Search ══
select pg_temp.eq('search: finds by code, name, brand, model and category',
  pg_temp.q('staff.marketing@arak-sa.com', format($s$select (select count(*) from public.shell_search_catalog(%1$L, 'T-1001'))::text || (select count(*) from public.shell_search_catalog(%1$L, 'downlight'))::text || (select count(*) from public.shell_search_catalog(%1$L, 'brightfield'))::text || (select count(*) from public.shell_search_catalog(%1$L, 'fl-100'))::text || (select count(*) from public.shell_search_catalog(%1$L, 'outdoor'))::text$s$, '00000000-0000-0000-0000-000000000001')), '11212');
select pg_temp.eq('search: a stopped item ranks after active ones',
  pg_temp.q('staff.marketing@arak-sa.com', format($s$select code from (select i.code, s.rank from public.shell_search_catalog(%L, 'test', 20) s join public.catalog_items i on i.id = s.id order by s.rank desc, i.code desc limit 1) x$s$, '00000000-0000-0000-0000-000000000001')) in ('T-3001', 'T-5000'), true);
select pg_temp.eq('search: another company''s items never come back',
  pg_temp.q('staff.marketing@arak-sa.com', format($s$select count(*) from public.shell_search_catalog(%L, 'same code elsewhere')$s$, current_setting('cat.ghusn'))), '0');
select pg_temp.eq('search: signed out gets nothing',
  pg_temp.err(null, format($s$select count(*) from public.shell_search_catalog(%L, 'test')$s$, '00000000-0000-0000-0000-000000000001')) like '%permission denied%', true);

-- ══ Files ══
select pg_temp.eq('files: the bucket is private, 20 MB, PDF and images only',
  (select (not public)::text || ':' || file_size_limit::text || ':' || array_length(allowed_mime_types, 1) from storage.buckets where id = 'catalog-files'), 'true:20971520:4');
select pg_temp.eq('files: Manage uploads into its own company''s item folder',
  pg_temp.err('staff.admin@arak-sa.com', format($s$insert into storage.objects (bucket_id, name, owner_id) values ('catalog-files', %L, %L) returning name$s$, '00000000-0000-0000-0000-000000000001/' || current_setting('cat.item') || '/sheet.pdf', pg_temp.uid('staff.admin@arak-sa.com'))), 'no error');
select pg_temp.refused('files: View cannot upload', 'staff.marketing@arak-sa.com',
  format($s$insert into storage.objects (bucket_id, name, owner_id) values ('catalog-files', %L, %L) returning name$s$, '00000000-0000-0000-0000-000000000001/' || current_setting('cat.item') || '/view.pdf', pg_temp.uid('staff.marketing@arak-sa.com')), 'row-level security');
select pg_temp.refused('files: a login outside the company cannot upload into it', 'outside.two@example.com',
  format($s$insert into storage.objects (bucket_id, name, owner_id) values ('catalog-files', %L, %L) returning name$s$, '00000000-0000-0000-0000-000000000001/' || current_setting('cat.item') || '/x.pdf', pg_temp.uid('outside.two@example.com')), 'row-level security');
select pg_temp.refused('files: Manage cannot upload into another company''s folder (Ghusn''s item path in Arak''s folder)', 'staff.dev@arak-sa.com',
  format($s$insert into storage.objects (bucket_id, name, owner_id) values ('catalog-files', %L, %L) returning name$s$, current_setting('cat.ghusn') || '/' || current_setting('cat.item') || '/x.pdf', pg_temp.uid('staff.dev@arak-sa.com')), 'row-level security');
select pg_temp.refused('files: a folder of an item that does not exist is refused', 'staff.admin@arak-sa.com',
  format($s$insert into storage.objects (bucket_id, name, owner_id) values ('catalog-files', %L, %L) returning name$s$, '00000000-0000-0000-0000-000000000001/' || gen_random_uuid() || '/x.pdf', pg_temp.uid('staff.admin@arak-sa.com')), 'row-level security');
select pg_temp.refused('files: a path that is not two ids reaches nobody', 'staff.admin@arak-sa.com',
  $s$insert into storage.objects (bucket_id, name) values ('catalog-files', 'loose.pdf') returning name$s$, 'row-level security');
select pg_temp.eq('files: View reads the file; a login outside the company does not',
  pg_temp.q('staff.marketing@arak-sa.com', 'select count(*) from storage.objects where bucket_id = ''catalog-files''') || '/' ||
  pg_temp.q('outside.two@example.com', 'select count(*) from storage.objects where bucket_id = ''catalog-files'''), '1/0');
-- (Storage refuses a direct DELETE from SQL; the delete policy is tested through its rule.)
select pg_temp.eq('files: nobody deletes a file of a live company, not even the admin (the old file stays)',
  pg_temp.q('staff.admin@arak-sa.com', format($s$select public.catalog_orphan_ok(%L)::text$s$, '00000000-0000-0000-0000-000000000001/' || current_setting('cat.item') || '/sheet.pdf')), 'false');
select pg_temp.eq('files: only a deleted company''s files can be cleaned up, and only by the admin',
  pg_temp.q('staff.admin@arak-sa.com', format($s$select public.catalog_orphan_ok(%L)::text$s$, gen_random_uuid() || '/x/y.pdf')) || '/' ||
  pg_temp.q('staff.dev@arak-sa.com', format($s$select public.catalog_orphan_ok(%L)::text$s$, gen_random_uuid() || '/x/y.pdf')), 'true/false');
select pg_temp.eq('files: a file is never overwritten (no update policy)',
  pg_temp.q('staff.admin@arak-sa.com', $s$with u as (update storage.objects set name = name || 'x' where bucket_id = 'catalog-files' returning 1) select count(*) from u$s$), '0');

-- ══ Every catalog_ table has RLS on ══
select pg_temp.eq('rls: on for every catalog_ table',
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname like 'catalog\_%' and not relrowsecurity), 0::bigint);
select pg_temp.eq('rls: four catalog_ tables',
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname like 'catalog\_%'), 4::bigint);
select pg_temp.eq('section: the key catalog is allowed in section_access, tasks and meetings',
  (select count(*) from pg_constraint where conname in ('section_access_section_check', 'tasks_section_check', 'meetings_section_check') and pg_get_constraintdef(oid) like '%catalog%'), 3::bigint);

-- ── Report ──
\o
select case when ok then 'PASS' else 'FAIL' end as result, name, case when ok then '' else detail end as detail from t order by n;
select format('%s passed, %s failed', count(*) filter (where ok), count(*) filter (where not ok)) as summary from t;
do $$ begin
  if exists (select 1 from t where not ok) then raise exception 'Catalog tests failed'; end if;
end $$;
rollback;
