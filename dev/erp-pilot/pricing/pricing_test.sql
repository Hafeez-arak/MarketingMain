-- ─── Pricing: the database's rules, tested (LOCAL v2 database only) ────────
-- 2026-12-01. Who may read and change what, company separation, and the rules
-- of 20261201_pricing_*.sql, checked the way the browser reaches them: role
-- `authenticated` with a login in request.jwt.claims. Runs inside one
-- transaction that is rolled back, so it leaves nothing behind. It builds its
-- own opportunities, suppliers and catalog items first, so it does not depend
-- on live data (seed.sql is not needed).
--
--   dev/erp-pilot/pricing/run-tests.sh
--
-- Logins of the local copy used here (their Pricing grants are made in the test):
--   staff.admin@arak-sa.com     access admin: Manage everywhere
--   staff.dev@arak-sa.com       member of Arak Lighting; Pricing Work (made here)
--   staff.marketing@arak-sa.com member of Arak Lighting; Pricing View (made here)
--   outside.two@example.com     member of Aqeeq and Alo Kheyatah only

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
  if p_sql ~* '^\s*(select|with)' or p_sql ~* ' returning ' then
    execute p_sql into v;
  else
    execute p_sql;
  end if;
  reset role;
  return v;
end $$ language plpgsql;

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

create function pg_temp.passes(p_name text, p_email text, p_sql text) returns void as $$
declare e text := pg_temp.err(p_email, p_sql);
begin
  insert into t (name, ok, detail) values (p_name, e = 'no error', e);
end $$ language plpgsql;

create function pg_temp.uid(p_email text) returns uuid as $$ select id from auth.users where email = p_email $$ language sql;
-- A value kept for later queries (custom settings last for the transaction).
create function pg_temp.setv(k text, v text) returns text as $$ select set_config('pt.' || k, v, true) $$ language sql;
create function pg_temp.v(k text) returns text as $$ select current_setting('pt.' || k) $$ language sql;
-- The issues of a sheet as 'CODE[:line][!]' joined (! = blocking), as the database computes them.
create function pg_temp.issues(p_sheet text) returns text as $$
  select coalesce(string_agg(code || coalesce(':' || line_no, '') || case when blocking then '!' else '' end, ',' order by code, line_no), '')
    from public.pricing_sheet_issues(p_sheet::uuid)
$$ language sql;
create function pg_temp.has_issue(p_sheet text, p_code text, p_blocking boolean) returns boolean as $$
  select exists (select 1 from public.pricing_sheet_issues(p_sheet::uuid) where code = p_code and blocking = p_blocking)
$$ language sql;

\set arak '''00000000-0000-0000-0000-000000000001'''
\set admin '''staff.admin@arak-sa.com'''
\set dev '''staff.dev@arak-sa.com'''
\set mkt '''staff.marketing@arak-sa.com'''
\set outsider '''outside.two@example.com'''

-- ══ Fixtures (as the database owner; all rolled back) ══
select pg_temp.setv('ghusn', (select id::text from public.workspaces where name = 'Ghusn'));
update public.crm_stages set auto_event = null where workspace_id = :arak and auto_event = 'pricing';
select pg_temp.setv('st_new', (select id::text from (select id from public.crm_stages where workspace_id = :arak and is_active order by sequence limit 1) s));
insert into public.crm_stages (workspace_id, name, sequence, auto_event) values (:arak, 'PT pricing stage', 50, 'pricing');
select pg_temp.setv('st_pricing', (select id::text from public.crm_stages where workspace_id = :arak and name = 'PT pricing stage'));
insert into public.crm_leads (workspace_id, title, contact_name, stage_id) values (:arak, 'PT lead one', 'PT', pg_temp.v('st_new')::uuid);
insert into public.crm_leads (workspace_id, title, contact_name, stage_id) values (:arak, 'PT lead two', 'PT', pg_temp.v('st_new')::uuid);
insert into public.crm_leads (workspace_id, title, contact_name, stage_id) values (:arak, 'PT lead closed', 'PT', pg_temp.v('st_new')::uuid);
select pg_temp.setv('l1', (select id::text from public.crm_leads where workspace_id = :arak and title = 'PT lead one'));
select pg_temp.setv('l2', (select id::text from public.crm_leads where workspace_id = :arak and title = 'PT lead two'));
select pg_temp.setv('lc', (select id::text from public.crm_leads where workspace_id = :arak and title = 'PT lead closed'));
insert into public.crm_lost_reasons (workspace_id, name) values (:arak, 'PT reason');
update public.crm_leads set status = 'lost', lost_reason_id = (select id from public.crm_lost_reasons where workspace_id = :arak and name = 'PT reason') where id = pg_temp.v('lc')::uuid;
-- Another company: a stage, a lead.
insert into public.crm_stages (workspace_id, name, sequence) values (pg_temp.v('ghusn')::uuid, 'PT stage', 10);
insert into public.crm_leads (workspace_id, title, contact_name, stage_id)
  select pg_temp.v('ghusn')::uuid, 'PT ghusn lead', 'PT', id from public.crm_stages where workspace_id = pg_temp.v('ghusn')::uuid and name = 'PT stage';
select pg_temp.setv('lg', (select id::text from public.crm_leads where title = 'PT ghusn lead'));
-- Organisations.
insert into public.contacts_orgs (workspace_id, name, roles) values
  (:arak, 'PT supplier sar', '{supplier}'), (:arak, 'PT supplier usd', '{supplier}'), (:arak, 'PT client only', '{client}');
insert into public.contacts_orgs (workspace_id, name, roles, status, archived_at) values (:arak, 'PT supplier archived', '{supplier}', 'archived', now());
select pg_temp.setv('s_sar', (select id::text from public.contacts_orgs where name = 'PT supplier sar'));
select pg_temp.setv('s_usd', (select id::text from public.contacts_orgs where name = 'PT supplier usd'));
select pg_temp.setv('s_client', (select id::text from public.contacts_orgs where name = 'PT client only'));
select pg_temp.setv('s_arch', (select id::text from public.contacts_orgs where name = 'PT supplier archived'));
-- Catalog items.
insert into public.catalog_items (workspace_id, code, name, unit) values (:arak, 'PT-1', 'PT item on', 'pcs');
insert into public.catalog_items (workspace_id, code, name, unit, active) values (:arak, 'PT-2', 'PT item stopped', 'pcs', false);
select pg_temp.setv('ci_on', (select id::text from public.catalog_items where code = 'PT-1'));
select pg_temp.setv('ci_off', (select id::text from public.catalog_items where code = 'PT-2'));
-- Start clean: no settings row, so the minimum margin is unset.
delete from public.pricing_settings where workspace_id = :arak;

-- Grants for this test only (rolled back).
insert into public.section_access (workspace_id, user_id, section, level) values
  (:arak, pg_temp.uid('staff.dev@arak-sa.com'), 'pricing', 'work'),
  (:arak, pg_temp.uid('staff.marketing@arak-sa.com'), 'pricing', 'view')
on conflict (workspace_id, user_id, section) do update set level = excluded.level;

-- ══ Work: creating a sheet ══
select pg_temp.eq('work: creates a sheet on an open opportunity',
  pg_temp.setv('s1', pg_temp.q(:dev, format('insert into public.pricing_sheets (workspace_id, lead_id, title) values (%L, %L, %L) returning id', '00000000-0000-0000-0000-000000000001', pg_temp.v('l1'), 'PT sheet one'))) is not null, true);
select pg_temp.eq('number: PS-YYYY-NNNNNN', pg_temp.q(:dev, format('select sheet_no ~ ''^PS-[0-9]{4}-[0-9]{6}$'' from public.pricing_sheets where id = %L', pg_temp.v('s1'))), 'true');
select pg_temp.eq('new sheet is a draft made by the creator',
  pg_temp.q(:dev, format('select status || ''/'' || (created_by = auth.uid())::text from public.pricing_sheets where id = %L', pg_temp.v('s1'))), 'draft/true');
select pg_temp.eq('creating a sheet moves the opportunity to the pricing stage',
  (select stage_id::text from public.crm_leads where id = pg_temp.v('l1')::uuid), pg_temp.v('st_pricing'));
select pg_temp.setv('s2', pg_temp.q(:dev, format('insert into public.pricing_sheets (workspace_id, lead_id, title) values (%L, %L, %L) returning id', '00000000-0000-0000-0000-000000000001', pg_temp.v('l2'), 'PT sheet two')));
select pg_temp.eq('a second sheet takes the next number',
  (select substr(b.sheet_no, 9)::int - substr(a.sheet_no, 9)::int from public.pricing_sheets a, public.pricing_sheets b where a.id = pg_temp.v('s1')::uuid and b.id = pg_temp.v('s2')::uuid), 1);
select pg_temp.refused('a closed opportunity takes no sheet', :dev,
  format('insert into public.pricing_sheets (workspace_id, lead_id, title) values (%L, %L, ''x'') returning id', '00000000-0000-0000-0000-000000000001', pg_temp.v('lc')), 'PRICING_LEAD_CLOSED');
select pg_temp.refused('another company''s opportunity is refused', :dev,
  format('insert into public.pricing_sheets (workspace_id, lead_id, title) values (%L, %L, ''x'') returning id', '00000000-0000-0000-0000-000000000001', pg_temp.v('lg')), 'PRICING_LEAD_CLOSED');
select pg_temp.refused('status cannot be written directly', :dev,
  format('update public.pricing_sheets set status = ''approved'' where id = %L returning 1', pg_temp.v('s1')), 'permission denied');
select pg_temp.refused('a status cannot be set on insert', :dev,
  format('insert into public.pricing_sheets (workspace_id, lead_id, title, status) values (%L, %L, ''x'', ''approved'') returning id', '00000000-0000-0000-0000-000000000001', pg_temp.v('l2')), 'permission denied');
select pg_temp.eq('the number cannot be edited',
  pg_temp.err(:dev, format('update public.pricing_sheets set sheet_no = ''PS-1'' where id = %L returning 1', pg_temp.v('s1'))) like '%permission denied%', true);
select pg_temp.passes('draft title, notes and margin note can be edited', :dev,
  format('update public.pricing_sheets set title = ''PT sheet one'', notes = ''n'', margin_note = null where id = %L returning 1', pg_temp.v('s1')));

-- ══ View: reads, cannot write ══
select pg_temp.eq('view: reads the sheet', pg_temp.q(:mkt, format('select title from public.pricing_sheets where id = %L', pg_temp.v('s1'))), 'PT sheet one');
select pg_temp.eq('view: reads cost and totals', pg_temp.q(:mkt, format('select line_count::text from public.pricing_sheet_totals where sheet_id = %L', pg_temp.v('s1'))), '0');
select pg_temp.eq('view: reads the history', pg_temp.q(:mkt, format('select count(*) > 0 from public.pricing_audit where sheet_id = %L', pg_temp.v('s1'))), 'true');
select pg_temp.eq('view: cannot create a sheet', pg_temp.err(:mkt, format('insert into public.pricing_sheets (workspace_id, lead_id, title) values (%L, %L, ''x'') returning id', '00000000-0000-0000-0000-000000000001', pg_temp.v('l2'))) like '%row-level security%', true);
select pg_temp.eq('view: cannot edit a draft', pg_temp.q(:mkt, format('with u as (update public.pricing_sheets set title = ''x'' where id = %L returning 1) select count(*) from u', pg_temp.v('s1'))), '0');
select pg_temp.eq('view: cannot delete a draft', pg_temp.q(:mkt, format('with u as (delete from public.pricing_sheets where id = %L returning 1) select count(*) from u', pg_temp.v('s1'))), '0');
select pg_temp.refused('view: cannot submit', :mkt, format('select public.pricing_sheet_submit(%L)', pg_temp.v('s1')), 'PRICING_NOT_ALLOWED');
select pg_temp.refused('view: cannot save lines', :mkt, format('select public.pricing_save_lines(%L, ''[{"description":"x","quantity":1,"unit":"u"}]'')', pg_temp.v('s1')), 'PRICING_NOT_ALLOWED');
select pg_temp.refused('view: cannot set the minimum margin', :mkt, format('insert into public.pricing_settings (workspace_id, min_margin_pct) values (%L, 10)', '00000000-0000-0000-0000-000000000001'), 'row-level security');
select pg_temp.eq('view: the lookups work', pg_temp.q(:mkt, format('select count(*) filter (where title = ''PT lead one'') || ''/'' || (select count(*) from public.pricing_suppliers(%1$L) where name = ''PT supplier sar'') || ''/'' || (select count(*) from public.pricing_catalog_items(%1$L) where code = ''PT-1'') from public.pricing_leads(%1$L)', '00000000-0000-0000-0000-000000000001')), '1/1/1');

-- ══ Company separation ══
select pg_temp.eq('outsider: reads no sheet', pg_temp.q(:outsider, 'select count(*) from public.pricing_sheets'), '0');
select pg_temp.eq('outsider: reads no history', pg_temp.q(:outsider, 'select count(*) from public.pricing_audit'), '0');
select pg_temp.eq('outsider: the lookups are empty', pg_temp.q(:outsider, format('select count(*) from public.pricing_leads(%L)', '00000000-0000-0000-0000-000000000001')), '0');
select pg_temp.refused('outsider: cannot create a sheet', :outsider,
  format('insert into public.pricing_sheets (workspace_id, lead_id, title) values (%L, %L, ''x'') returning id', '00000000-0000-0000-0000-000000000001', pg_temp.v('l2')), 'row-level security');
select pg_temp.refused('outsider: cannot submit', :outsider, format('select public.pricing_sheet_submit(%L)', pg_temp.v('s1')), 'PRICING_NOT_FOUND');
select pg_temp.eq('signed out: no privilege at all', pg_temp.err(null, 'select count(*) from public.pricing_sheets') like '%permission denied%', true);
select pg_temp.eq('the currencies are readable by any login', pg_temp.q(:outsider, 'select count(*) from public.currencies'), '8');
select pg_temp.refused('the app cannot write currencies', :admin, 'insert into public.currencies (code, name_en, name_ar) values (''XXX'', ''x'', ''x'')', 'permission denied');

-- ══ Lines ══
select pg_temp.eq('lines: saved in order, numbered 1..n',
  pg_temp.q(:dev, format($f$select public.pricing_save_lines(%L, '[
    {"boq_ref":"E-01","description":"PT downlight","quantity":100,"unit":"pc","cost_category":"goods"},
    {"boq_ref":"E-02","description":"PT strip","quantity":50,"unit":"m"},
    {"description":"PT extra","quantity":1,"unit":"lot"}]'::jsonb)$f$, pg_temp.v('s1'))), '3');
select pg_temp.setv('p1', (select id::text from public.pricing_lines where sheet_id = pg_temp.v('s1')::uuid and line_no = 1));
select pg_temp.setv('p2', (select id::text from public.pricing_lines where sheet_id = pg_temp.v('s1')::uuid and line_no = 2));
select pg_temp.setv('p3', (select id::text from public.pricing_lines where sheet_id = pg_temp.v('s1')::uuid and line_no = 3));
select pg_temp.eq('lines: a line starts unpriced and unclassified except as given',
  (select unit_price is null and cost_category = 'goods' from public.pricing_lines where id = pg_temp.v('p1')::uuid), true);
select pg_temp.eq('lines: swapping two lines renumbers without a clash',
  pg_temp.q(:dev, format($f$select public.pricing_save_lines(%1$L, jsonb_build_array(
    jsonb_build_object('id', %3$L, 'description', 'PT strip', 'quantity', 50, 'unit', 'm'),
    jsonb_build_object('id', %2$L, 'description', 'PT downlight', 'quantity', 100, 'unit', 'pc', 'cost_category', 'goods'),
    jsonb_build_object('id', %4$L, 'description', 'PT extra', 'quantity', 1, 'unit', 'lot')))$f$, pg_temp.v('s1'), pg_temp.v('p1'), pg_temp.v('p2'), pg_temp.v('p3'))), '3');
select pg_temp.eq('lines: the swap changed the numbers', (select line_no::text from public.pricing_lines where id = pg_temp.v('p1')::uuid), '2');
select pg_temp.passes('lines: back to the first order', :dev,
  format($f$select public.pricing_save_lines(%1$L, jsonb_build_array(
    jsonb_build_object('id', %2$L, 'boq_ref', 'E-01', 'description', 'PT downlight', 'quantity', 100, 'unit', 'pc', 'cost_category', 'goods'),
    jsonb_build_object('id', %3$L, 'boq_ref', 'E-02', 'description', 'PT strip', 'quantity', 50, 'unit', 'm'),
    jsonb_build_object('id', %4$L, 'description', 'PT extra', 'quantity', 1, 'unit', 'lot')))$f$, pg_temp.v('s1'), pg_temp.v('p1'), pg_temp.v('p2'), pg_temp.v('p3')));
select pg_temp.refused('lines: a quantity of zero is refused', :dev,
  format($f$select public.pricing_save_lines(%L, '[{"description":"x","quantity":0,"unit":"u"}]'::jsonb)$f$, pg_temp.v('s1')), 'pricing_lines_quantity_check');
select pg_temp.refused('lines: a blank unit is refused (none is assumed)', :dev,
  format($f$select public.pricing_save_lines(%L, '[{"description":"x","quantity":1,"unit":" "}]'::jsonb)$f$, pg_temp.v('s1')), 'pricing_lines_unit_check');
select pg_temp.refused('lines: an unknown category is refused', :dev,
  format($f$select public.pricing_save_lines(%L, '[{"description":"x","quantity":1,"unit":"u","cost_category":"GOODS"}]'::jsonb)$f$, pg_temp.v('s1')), 'pricing_lines_cost_category_check');
select pg_temp.refused('lines: another sheet''s line cannot be listed', :dev,
  format($f$select public.pricing_save_lines(%L, jsonb_build_array(jsonb_build_object('id', %L, 'description', 'x', 'quantity', 1, 'unit', 'u')))$f$, pg_temp.v('s2'), pg_temp.v('p1')), 'PRICING_LINE_MISSING');
select pg_temp.eq('lines: nothing of the failed saves stuck', (select count(*)::text from public.pricing_lines where sheet_id = pg_temp.v('s1')::uuid), '3');
select pg_temp.eq('import: appends after the existing lines',
  pg_temp.q(:dev, format($f$select public.pricing_import_lines(%L, '[{"boq_ref":"I-1","description":"PT imported","quantity":2.5,"unit":"set","cost_category":"installation"}]'::jsonb)$f$, pg_temp.v('s1'))), '1');
select pg_temp.eq('import: numbered after the last', (select line_no::text from public.pricing_lines where sheet_id = pg_temp.v('s1')::uuid and description = 'PT imported'), '4');
select pg_temp.passes('removing a line removes it', :dev,
  format($f$select public.pricing_save_lines(%1$L, jsonb_build_array(
    jsonb_build_object('id', %2$L, 'boq_ref', 'E-01', 'description', 'PT downlight', 'quantity', 100, 'unit', 'pc', 'cost_category', 'goods'),
    jsonb_build_object('id', %3$L, 'boq_ref', 'E-02', 'description', 'PT strip', 'quantity', 50, 'unit', 'm')))$f$, pg_temp.v('s1'), pg_temp.v('p1'), pg_temp.v('p2')));
select pg_temp.eq('lines: two remain', (select count(*)::text from public.pricing_lines where sheet_id = pg_temp.v('s1')::uuid), '2');
-- catalog link
select pg_temp.passes('catalog: an active item can be linked to a line', :dev, format('select public.pricing_apply_catalog(%L, %L)', pg_temp.v('p1'), pg_temp.v('ci_on')));
select pg_temp.eq('catalog: the link is stored', (select catalog_item_id::text from public.pricing_lines where id = pg_temp.v('p1')::uuid), pg_temp.v('ci_on'));
select pg_temp.refused('catalog: a stopped item is refused', :dev, format('select public.pricing_apply_catalog(%L, %L)', pg_temp.v('p2'), pg_temp.v('ci_off')), 'PRICING_ITEM');
select pg_temp.refused('catalog: view cannot link', :mkt, format('select public.pricing_apply_catalog(%L, %L)', pg_temp.v('p2'), pg_temp.v('ci_on')), 'PRICING_NOT_ALLOWED');
select pg_temp.refused('lines: a line cannot move to another sheet', :dev,
  format('update public.pricing_lines set sheet_id = %L where id = %L', pg_temp.v('s2'), pg_temp.v('p1')), 'permission denied');
-- cost category: draft only (checked again under the workflow below)
select pg_temp.passes('category: changes with the line in a draft', :dev, format('update public.pricing_lines set cost_category = ''subcontract'' where id = %L returning 1', pg_temp.v('p2')));

-- ══ Supplier quotes ══
select pg_temp.refused('quote: a sheet without lines takes no request', :dev,
  format('select public.pricing_request_quote(%L, %L, ''SAR'', current_date)', pg_temp.v('s2'), pg_temp.v('s_sar')), 'PRICING_NO_LINES');
select pg_temp.refused('quote: a non-supplier organisation is refused', :dev,
  format('select public.pricing_request_quote(%L, %L, ''SAR'', current_date)', pg_temp.v('s1'), pg_temp.v('s_client')), 'PRICING_SUPPLIER');
select pg_temp.refused('quote: an archived supplier is refused', :dev,
  format('select public.pricing_request_quote(%L, %L, ''SAR'', current_date)', pg_temp.v('s1'), pg_temp.v('s_arch')), 'PRICING_SUPPLIER');
update public.currencies set active = false where code = 'JPY';
select pg_temp.refused('quote: a switched-off currency is refused', :dev,
  format('select public.pricing_request_quote(%L, %L, ''JPY'', current_date)', pg_temp.v('s1'), pg_temp.v('s_sar')), 'PRICING_CURRENCY');
select pg_temp.refused('quote: an unknown currency is refused', :dev,
  format('select public.pricing_request_quote(%L, %L, ''ZZZ'', current_date)', pg_temp.v('s1'), pg_temp.v('s_sar')), 'PRICING_CURRENCY');
select pg_temp.eq('quote: a request is made',
  pg_temp.setv('qa', pg_temp.q(:dev, format('select public.pricing_request_quote(%L, %L, ''SAR'', current_date, ''PT note'')', pg_temp.v('s1'), pg_temp.v('s_sar')))) is not null, true);
select pg_temp.setv('qb', pg_temp.q(:dev, format('select public.pricing_request_quote(%L, %L, ''USD'', current_date)', pg_temp.v('s1'), pg_temp.v('s_usd'))));
select pg_temp.eq('quote: number SQ-YYYY-NNNNNN', (select quote_no ~ '^SQ-[0-9]{4}-[0-9]{6}$' from public.supplier_quotes where id = pg_temp.v('qa')::uuid), true);
select pg_temp.eq('quote: starts as requested', (select status from public.supplier_quotes where id = pg_temp.v('qa')::uuid), 'requested');
select pg_temp.eq('quote: one offer per BOQ line, with the quantities', (select count(*)::text || '/' || sum(quantity)::text from public.supplier_quote_lines where quote_id = pg_temp.v('qa')::uuid), '2/150.000');
select pg_temp.eq('quote: SAR is forced to rate 1', (select fx_rate::text from public.supplier_quotes where id = pg_temp.v('qa')::uuid), '1.00000000');
select pg_temp.eq('quote: USD starts with the rate unknown', (select fx_rate is null from public.supplier_quotes where id = pg_temp.v('qb')::uuid), true);
select pg_temp.setv('qa1', (select l.id::text from public.supplier_quote_lines l where l.quote_id = pg_temp.v('qa')::uuid and l.pricing_line_id = pg_temp.v('p1')::uuid));
select pg_temp.setv('qa2', (select l.id::text from public.supplier_quote_lines l where l.quote_id = pg_temp.v('qa')::uuid and l.pricing_line_id = pg_temp.v('p2')::uuid));
select pg_temp.setv('qb1', (select l.id::text from public.supplier_quote_lines l where l.quote_id = pg_temp.v('qb')::uuid and l.pricing_line_id = pg_temp.v('p1')::uuid));
select pg_temp.setv('qb2', (select l.id::text from public.supplier_quote_lines l where l.quote_id = pg_temp.v('qb')::uuid and l.pricing_line_id = pg_temp.v('p2')::uuid));
select pg_temp.refused('quote: received needs its date', :dev,
  format($f$select public.pricing_save_quote(%L, jsonb_build_object('status','received','currency','SAR','requested_on',current_date::text))$f$, pg_temp.v('qa')), 'supplier_quotes_received');
select pg_temp.refused('quote: valid-until cannot precede the received date', :dev,
  format($f$select public.pricing_save_quote(%L, jsonb_build_object('status','received','currency','SAR','requested_on',current_date::text,'received_on',current_date::text,'valid_until',(current_date - 1)::text))$f$, pg_temp.v('qa')), 'supplier_quotes_validity');
select pg_temp.refused('quote: the supplier cannot change', :dev, format('update public.supplier_quotes set supplier_id = %L where id = %L', pg_temp.v('s_usd'), pg_temp.v('qa')), 'permission denied');
-- Local quote: prices known, charges unknown for now; one alternative.
select pg_temp.passes('quote: prices saved, an alternative added', :dev,
  format($f$select public.pricing_save_quote(%1$L,
    jsonb_build_object('status','received','currency','SAR','requested_on',current_date::text,'received_on',current_date::text,'valid_until',(current_date + 30)::text,'fx_rate','3.75'),
    jsonb_build_array(jsonb_build_object('id', %2$L, 'quantity', 100, 'unit_price', 40), jsonb_build_object('id', %3$L, 'quantity', 50, 'unit_price', 20)),
    jsonb_build_array(jsonb_build_object('pricing_line_id', %4$L, 'unit_price', 35, 'brand', 'PT alt'), jsonb_build_object('pricing_line_id', %4$L)))$f$,
    pg_temp.v('qa'), pg_temp.v('qa1'), pg_temp.v('qa2'), pg_temp.v('p1')));
select pg_temp.eq('quote: SAR stays at rate 1 even when 3.75 is typed', (select fx_rate::text from public.supplier_quotes where id = pg_temp.v('qa')::uuid), '1.00000000');
select pg_temp.eq('quote: an empty alternative is not added', (select count(*)::text from public.supplier_quote_lines where quote_id = pg_temp.v('qa')::uuid and is_alternative), '1');
select pg_temp.setv('qaalt', (select id::text from public.supplier_quote_lines where quote_id = pg_temp.v('qa')::uuid and is_alternative));
select pg_temp.eq('quote: the alternative took the line''s quantity', (select quantity::text from public.supplier_quote_lines where id = pg_temp.v('qaalt')::uuid), '100.000');
select pg_temp.refused('quote: a second main offer for a line is refused', :dev,
  format('insert into public.supplier_quote_lines (workspace_id, quote_id, pricing_line_id, quantity) values (%L, %L, %L, 1)', '00000000-0000-0000-0000-000000000001', pg_temp.v('qa'), pg_temp.v('p1')), 'supplier_quote_lines_main_uq');
select pg_temp.passes('quote: more alternatives for the same line are fine', :dev,
  format('insert into public.supplier_quote_lines (workspace_id, quote_id, pricing_line_id, quantity, is_alternative) values (%L, %L, %L, 1, true)', '00000000-0000-0000-0000-000000000001', pg_temp.v('qa'), pg_temp.v('p1')));
delete from public.supplier_quote_lines where quote_id = pg_temp.v('qa')::uuid and is_alternative and unit_price is null;
select pg_temp.passes('quote: the USD rate is typed', :dev, format($f$select public.pricing_save_quote(%L, jsonb_build_object('status','requested','currency','USD','requested_on',current_date::text,'fx_rate','3.75'))$f$, pg_temp.v('qb')));
select pg_temp.eq('quote: USD keeps the typed rate', (select fx_rate::text from public.supplier_quotes where id = pg_temp.v('qb')::uuid), '3.75000000');
select pg_temp.passes('quote: change USD to EUR with the same rate', :dev, format($f$select public.pricing_save_quote(%L, jsonb_build_object('status','requested','currency','EUR','requested_on',current_date::text,'fx_rate','3.75'))$f$, pg_temp.v('qb')));
select pg_temp.eq('quote: the old rate is dropped with the currency', (select fx_rate is null from public.supplier_quotes where id = pg_temp.v('qb')::uuid), true);

-- ══ The cost math ══
-- Local (SAR) quote A: 100 × 40 and 50 × 20 = 5000. Charges unknown → cost unknown.
select pg_temp.passes('select: the local offers are chosen', :dev,
  format($f$select public.pricing_select_offers(%L, jsonb_build_object(%L, %L, %L, %L))$f$, pg_temp.v('s1'), pg_temp.v('p1'), pg_temp.v('qa1'), pg_temp.v('p2'), pg_temp.v('qa2')));
select pg_temp.eq('cost: unknown charges leave the cost unknown (never zero)',
  (select unit_cost is null from public.pricing_line_cost where pricing_line_id = pg_temp.v('p1')::uuid), true);
select pg_temp.eq('cost: the landed cost shows as unknown on the totals', (select cost_total is null from public.pricing_sheet_totals where sheet_id = pg_temp.v('s1')::uuid), true);
select pg_temp.eq('cost: COST_UNKNOWN blocks', pg_temp.has_issue(pg_temp.v('s1'), 'COST_UNKNOWN', true), true);
-- Charges: freight 300 + customs 0 + other 200 = 500 on 5000 = +10%.
select pg_temp.passes('quote: charges entered', :dev,
  format($f$select public.pricing_save_quote(%1$L,
    jsonb_build_object('status','received','currency','SAR','requested_on',current_date::text,'received_on',current_date::text,'valid_until',(current_date + 30)::text,
      'freight_amount','300','customs_amount','0','other_charges','200'),
    jsonb_build_array(jsonb_build_object('id', %2$L, 'quantity', 100, 'unit_price', 40), jsonb_build_object('id', %3$L, 'quantity', 50, 'unit_price', 20)))$f$,
    pg_temp.v('qa'), pg_temp.v('qa1'), pg_temp.v('qa2')));
select pg_temp.eq('cost: landed cost spread by value (40 → 44)', (select unit_cost::text from public.pricing_line_cost where pricing_line_id = pg_temp.v('p1')::uuid), '44.0000');
select pg_temp.eq('cost: the second line carries the same ratio (20 → 22)', (select unit_cost::text from public.pricing_line_cost where pricing_line_id = pg_temp.v('p2')::uuid), '22.0000');
select pg_temp.eq('cost: an alternative carries the same ratio (35 → 38.5)', (select landed_unit_cost::text from public.pricing_supplier_quote_line_cost where quote_line_id = pg_temp.v('qaalt')::uuid), '38.5000');
select pg_temp.eq('cost: the alternative does not enter the spread value', (select main_value = 5000 from public.pricing_supplier_quote_line_cost where quote_line_id = pg_temp.v('qa1')::uuid), true);
select pg_temp.eq('cost: totals are unknown while a price is missing',
  (select sell_total is null and unpriced_count = 2 and cost_total = 5500 from public.pricing_sheet_totals where sheet_id = pg_temp.v('s1')::uuid), true);
select pg_temp.passes('prices: saved', :dev, format($f$select public.pricing_save_prices(%L, jsonb_build_object(%L, 55, %L, 25))$f$, pg_temp.v('s1'), pg_temp.v('p1'), pg_temp.v('p2')));
select pg_temp.eq('margin: (55 − 44) / 55 = 20%', (select margin_pct::text from public.pricing_line_cost where pricing_line_id = pg_temp.v('p1')::uuid), '20.00');
select pg_temp.eq('margin: (25 − 22) / 25 = 12%', (select margin_pct::text from public.pricing_line_cost where pricing_line_id = pg_temp.v('p2')::uuid), '12.00');
select pg_temp.eq('totals: sell 6750, cost 5500, all known',
  (select sell_total::text || '/' || cost_total::text || '/' || uncosted_count::text from public.pricing_sheet_totals where sheet_id = pg_temp.v('s1')::uuid), '6750.00/5500.00/0');
select pg_temp.passes('prices: a price can be cleared back to unknown', :dev, format($f$select public.pricing_save_prices(%L, jsonb_build_object(%L, null::text))$f$, pg_temp.v('s1'), pg_temp.v('p2')));
select pg_temp.eq('prices: cleared', (select unit_price is null from public.pricing_lines where id = pg_temp.v('p2')::uuid), true);
select pg_temp.eq('totals: one line unpriced → no sell total', (select sell_total is null and unpriced_count = 1 from public.pricing_sheet_totals where sheet_id = pg_temp.v('s1')::uuid), true);
select pg_temp.passes('prices: set again', :dev, format($f$select public.pricing_save_prices(%L, jsonb_build_object(%L, 25))$f$, pg_temp.v('s1'), pg_temp.v('p2')));
select pg_temp.refused('prices: a line of another sheet is refused', :dev, format($f$select public.pricing_save_prices(%L, jsonb_build_object(%L, 25))$f$, pg_temp.v('s2'), pg_temp.v('p2')), 'PRICING_LINE_MISSING');
select pg_temp.refused('prices: negative is refused', :dev, format($f$select public.pricing_save_prices(%L, jsonb_build_object(%L, -1))$f$, pg_temp.v('s1'), pg_temp.v('p2')), 'pricing_lines_unit_price_check');
-- Foreign quote B: USD, price known, rate unknown, charges known to be none.
select pg_temp.passes('quote B: priced in USD, charges none, rate unknown', :dev,
  format($f$select public.pricing_save_quote(%1$L,
    jsonb_build_object('status','received','currency','USD','requested_on',current_date::text,'received_on',current_date::text,'valid_until',(current_date + 30)::text,
      'freight_amount','0','customs_amount','0','other_charges','0'),
    jsonb_build_array(jsonb_build_object('id', %2$L, 'quantity', 100, 'unit_price', 8), jsonb_build_object('id', %3$L, 'quantity', 50)))$f$,
    pg_temp.v('qb'), pg_temp.v('qb1'), pg_temp.v('qb2')));
select pg_temp.eq('cost: an unknown rate leaves the cost unknown', (select landed_unit_cost is null from public.pricing_supplier_quote_line_cost where quote_line_id = pg_temp.v('qb1')::uuid), true);
select pg_temp.passes('quote B: the rate typed', :dev,
  format($f$select public.pricing_save_quote(%1$L,
    jsonb_build_object('status','received','currency','USD','requested_on',current_date::text,'received_on',current_date::text,'valid_until',(current_date + 30)::text,'fx_rate','3.75',
      'freight_amount','0','customs_amount','0','other_charges','0'),
    jsonb_build_array(jsonb_build_object('id', %2$L, 'quantity', 100, 'unit_price', 8), jsonb_build_object('id', %3$L, 'quantity', 50)))$f$,
    pg_temp.v('qb'), pg_temp.v('qb1'), pg_temp.v('qb2')));
select pg_temp.eq('cost: charges known to be none → price × rate (8 × 3.75 = 30)', (select landed_unit_cost::text from public.pricing_supplier_quote_line_cost where quote_line_id = pg_temp.v('qb1')::uuid), '30.0000');
select pg_temp.eq('cost: an unpriced offer has no cost', (select landed_unit_cost is null from public.pricing_supplier_quote_line_cost where quote_line_id = pg_temp.v('qb2')::uuid), true);

-- ══ Selection rules ══
select pg_temp.refused('select: an unpriced offer is refused', :dev,
  format($f$select public.pricing_select_offers(%L, jsonb_build_object(%L, %L))$f$, pg_temp.v('s1'), pg_temp.v('p2'), pg_temp.v('qb2')), 'PRICING_SELECTION');
select pg_temp.refused('select: an offer for another line is refused', :dev,
  format($f$select public.pricing_select_offers(%L, jsonb_build_object(%L, %L))$f$, pg_temp.v('s1'), pg_temp.v('p1'), pg_temp.v('qa2')), 'PRICING_SELECTION');
select pg_temp.refused('select: a direct write of another line''s offer is refused', :dev,
  format('update public.pricing_lines set selected_quote_line_id = %L where id = %L', pg_temp.v('qa2'), pg_temp.v('p1')), 'PRICING_SELECTION');
select pg_temp.passes('select: the USD offer for line 1', :dev, format($f$select public.pricing_select_offers(%L, jsonb_build_object(%L, %L))$f$, pg_temp.v('s1'), pg_temp.v('p1'), pg_temp.v('qb1')));
select pg_temp.eq('select: the cost follows the chosen offer', (select unit_cost::text from public.pricing_line_cost where pricing_line_id = pg_temp.v('p1')::uuid), '30.0000');
select pg_temp.refused('select: a received quote cannot go back while chosen', :dev,
  format($f$select public.pricing_save_quote(%L, jsonb_build_object('status','requested','currency','USD','requested_on',current_date::text,'fx_rate','3.75'))$f$, pg_temp.v('qb')), 'PRICING_QUOTE_SELECTED');
select pg_temp.refused('select: a chosen offer''s price cannot be removed', :dev,
  format($f$select public.pricing_save_quote(%L, jsonb_build_object('status','received','currency','USD','requested_on',current_date::text,'received_on',current_date::text,'fx_rate','3.75'), jsonb_build_array(jsonb_build_object('id', %L, 'quantity', 100)))$f$, pg_temp.v('qb'), pg_temp.v('qb1')), 'PRICING_QUOTE_SELECTED');
select pg_temp.passes('select: unselect with null', :dev, format($f$select public.pricing_select_offers(%L, jsonb_build_object(%L, null::text))$f$, pg_temp.v('s1'), pg_temp.v('p1')));
select pg_temp.eq('select: unselected line has no supplier', (select selected_quote_line_id is null from public.pricing_lines where id = pg_temp.v('p1')::uuid), true);
select pg_temp.passes('select: the local offer again', :dev, format($f$select public.pricing_select_offers(%L, jsonb_build_object(%L, %L))$f$, pg_temp.v('s1'), pg_temp.v('p1'), pg_temp.v('qa1')));
-- A requested (not received) quote cannot supply the line, even with a price on it.
select pg_temp.setv('qc', pg_temp.q(:dev, format('select public.pricing_request_quote(%L, %L, ''USD'', current_date)', pg_temp.v('s1'), pg_temp.v('s_usd'))));
select pg_temp.setv('qc2', (select id::text from public.supplier_quote_lines where quote_id = pg_temp.v('qc')::uuid and pricing_line_id = pg_temp.v('p2')::uuid));
select pg_temp.passes('a requested quote can carry a price', :dev, format($f$select public.pricing_save_quote(%L, jsonb_build_object('status','requested','currency','USD','requested_on',current_date::text), jsonb_build_array(jsonb_build_object('id', %L, 'quantity', 50, 'unit_price', 5)))$f$, pg_temp.v('qc'), pg_temp.v('qc2')));
select pg_temp.refused('select: an offer of a quote not yet received is refused', :dev,
  format($f$select public.pricing_select_offers(%L, jsonb_build_object(%L, %L))$f$, pg_temp.v('s1'), pg_temp.v('p2'), pg_temp.v('qc2')), 'PRICING_SELECTION');

-- ══ Issues ══
select pg_temp.eq('issues: a sheet with no lines', pg_temp.issues(pg_temp.v('s2')), 'NO_LINES!');
select pg_temp.eq('issues: the minimum margin unset is a warning', pg_temp.has_issue(pg_temp.v('s1'), 'MIN_MARGIN_UNSET', false), true);
-- Line 2 now: price 25, chosen local offer cost 22 → ok. Build the cases on line 2 and 1.
select pg_temp.passes('minimum margin: manage sets 15', :admin,
  format('insert into public.pricing_settings (workspace_id, min_margin_pct) values (%L, 15) on conflict (workspace_id) do update set min_margin_pct = 15', '00000000-0000-0000-0000-000000000001'));
select pg_temp.eq('issues: line 2 at 12% is below the 15% minimum (blocks)', pg_temp.has_issue(pg_temp.v('s1'), 'BELOW_MIN_MARGIN', true), true);
select pg_temp.eq('issues: not below cost (price 25 ≥ cost 22)', pg_temp.has_issue(pg_temp.v('s1'), 'BELOW_COST', true) or pg_temp.has_issue(pg_temp.v('s1'), 'BELOW_COST', false), false);
select pg_temp.eq('issues: the unset warning is gone', pg_temp.has_issue(pg_temp.v('s1'), 'MIN_MARGIN_UNSET', false), false);
select pg_temp.passes('sheet: a margin note is written', :dev, format('update public.pricing_sheets set margin_note = ''PT strategic client'' where id = %L returning 1', pg_temp.v('s1')));
select pg_temp.eq('issues: the margin note lets it pass (a warning)', pg_temp.has_issue(pg_temp.v('s1'), 'BELOW_MIN_MARGIN', false) and not pg_temp.has_issue(pg_temp.v('s1'), 'BELOW_MIN_MARGIN', true), true);
select pg_temp.passes('prices: line 2 below cost', :dev, format($f$select public.pricing_save_prices(%L, jsonb_build_object(%L, 20))$f$, pg_temp.v('s1'), pg_temp.v('p2')));
select pg_temp.eq('issues: below cost with a note is a warning', pg_temp.has_issue(pg_temp.v('s1'), 'BELOW_COST', false) and not pg_temp.has_issue(pg_temp.v('s1'), 'BELOW_COST', true), true);
select pg_temp.eq('issues: below cost is not also below the margin line', pg_temp.has_issue(pg_temp.v('s1'), 'BELOW_MIN_MARGIN', false) or pg_temp.has_issue(pg_temp.v('s1'), 'BELOW_MIN_MARGIN', true), false);
select pg_temp.passes('sheet: the margin note is removed', :dev, format('update public.pricing_sheets set margin_note = null where id = %L returning 1', pg_temp.v('s1')));
select pg_temp.eq('issues: below cost without a note blocks', pg_temp.has_issue(pg_temp.v('s1'), 'BELOW_COST', true), true);
select pg_temp.refused('submit: refused while below cost without a note', :dev, format('select public.pricing_sheet_submit(%L)', pg_temp.v('s1')), 'PRICING_BLOCKED');
select pg_temp.passes('prices: line 2 back to 25', :dev, format($f$select public.pricing_save_prices(%L, jsonb_build_object(%L, 25))$f$, pg_temp.v('s1'), pg_temp.v('p2')));
-- QTY_SHORT (warning): the supplier quoted fewer than the client asked.
select pg_temp.passes('quote: the supplier quantity is short on line 1', :dev,
  format($f$select public.pricing_save_quote(%1$L,
    jsonb_build_object('status','received','currency','SAR','requested_on',current_date::text,'received_on',current_date::text,'valid_until',(current_date + 30)::text,
      'freight_amount','300','customs_amount','0','other_charges','200'),
    jsonb_build_array(jsonb_build_object('id', %2$L, 'quantity', 60, 'unit_price', 40), jsonb_build_object('id', %3$L, 'quantity', 50, 'unit_price', 20)))$f$,
    pg_temp.v('qa'), pg_temp.v('qa1'), pg_temp.v('qa2')));
select pg_temp.eq('issues: QTY_SHORT is a warning on line 1', pg_temp.has_issue(pg_temp.v('s1'), 'QTY_SHORT', false) and not pg_temp.has_issue(pg_temp.v('s1'), 'QTY_SHORT', true), true);
-- UNPRICED and NO_SUPPLIER on a fresh line; QUOTE_VALIDITY_UNKNOWN; QUOTE_EXPIRED.
select pg_temp.passes('quote: no validity date', :dev,
  format($f$select public.pricing_save_quote(%1$L,
    jsonb_build_object('status','received','currency','SAR','requested_on',current_date::text,'received_on',current_date::text,
      'freight_amount','300','customs_amount','0','other_charges','200'),
    jsonb_build_array(jsonb_build_object('id', %2$L, 'quantity', 100, 'unit_price', 40), jsonb_build_object('id', %3$L, 'quantity', 50, 'unit_price', 20)))$f$,
    pg_temp.v('qa'), pg_temp.v('qa1'), pg_temp.v('qa2')));
select pg_temp.eq('issues: an unknown validity is a warning', pg_temp.has_issue(pg_temp.v('s1'), 'QUOTE_VALIDITY_UNKNOWN', false) and not pg_temp.has_issue(pg_temp.v('s1'), 'QUOTE_VALIDITY_UNKNOWN', true), true);
select pg_temp.passes('quote: expired a day ago', :dev,
  format($f$select public.pricing_save_quote(%1$L,
    jsonb_build_object('status','received','currency','SAR','requested_on',(current_date - 40)::text,'received_on',(current_date - 40)::text,'valid_until',(public.crm_today() - 1)::text,
      'freight_amount','300','customs_amount','0','other_charges','200'),
    jsonb_build_array(jsonb_build_object('id', %2$L, 'quantity', 100, 'unit_price', 40), jsonb_build_object('id', %3$L, 'quantity', 50, 'unit_price', 20)))$f$,
    pg_temp.v('qa'), pg_temp.v('qa1'), pg_temp.v('qa2')));
select pg_temp.eq('issues: an expired quote blocks', pg_temp.has_issue(pg_temp.v('s1'), 'QUOTE_EXPIRED', true), true);
select pg_temp.passes('quote: valid again (30 days)', :dev,
  format($f$select public.pricing_save_quote(%1$L,
    jsonb_build_object('status','received','currency','SAR','requested_on',current_date::text,'received_on',current_date::text,'valid_until',(current_date + 30)::text,
      'freight_amount','300','customs_amount','0','other_charges','200'),
    jsonb_build_array(jsonb_build_object('id', %2$L, 'quantity', 100, 'unit_price', 40), jsonb_build_object('id', %3$L, 'quantity', 50, 'unit_price', 20)))$f$,
    pg_temp.v('qa'), pg_temp.v('qa1'), pg_temp.v('qa2')));
select pg_temp.passes('line: a third line, unpriced and without a supplier', :dev,
  format($f$select public.pricing_import_lines(%L, '[{"description":"PT third","quantity":1,"unit":"lot"}]')$f$, pg_temp.v('s1')));
select pg_temp.eq('issues: UNPRICED and NO_SUPPLIER block, per line', pg_temp.has_issue(pg_temp.v('s1'), 'UNPRICED', true) and pg_temp.has_issue(pg_temp.v('s1'), 'NO_SUPPLIER', true), true);
select pg_temp.eq('issues: the line numbers are reported',
  (select string_agg(code || ':' || line_no, ',' order by code) from public.pricing_sheet_issues(pg_temp.v('s1')::uuid) where code in ('UNPRICED', 'NO_SUPPLIER')), 'NO_SUPPLIER:3,UNPRICED:3');
select pg_temp.refused('submit: refused while a line has no supplier', :dev, format('select public.pricing_sheet_submit(%L)', pg_temp.v('s1')), 'PRICING_BLOCKED');
select pg_temp.refused('submit: refused for a sheet with no lines', :dev, format('select public.pricing_sheet_submit(%L)', pg_temp.v('s2')), 'PRICING_BLOCKED');
select pg_temp.passes('line: the third line is removed again', :dev,
  format($f$select public.pricing_save_lines(%1$L, jsonb_build_array(
    jsonb_build_object('id', %2$L, 'boq_ref', 'E-01', 'description', 'PT downlight', 'quantity', 100, 'unit', 'pc', 'cost_category', 'goods', 'catalog_item_id', %4$L),
    jsonb_build_object('id', %3$L, 'boq_ref', 'E-02', 'description', 'PT strip', 'quantity', 50, 'unit', 'm', 'cost_category', 'subcontract')))$f$, pg_temp.v('s1'), pg_temp.v('p1'), pg_temp.v('p2'), pg_temp.v('ci_on')));
select pg_temp.passes('select: line 2 takes the local offer', :dev, format($f$select public.pricing_select_offers(%L, jsonb_build_object(%L, %L, %L, %L))$f$, pg_temp.v('s1'), pg_temp.v('p1'), pg_temp.v('qa1'), pg_temp.v('p2'), pg_temp.v('qa2')));
select pg_temp.passes('quote: back to full quantity', :dev,
  format($f$select public.pricing_save_quote(%1$L,
    jsonb_build_object('status','received','currency','SAR','requested_on',current_date::text,'received_on',current_date::text,'valid_until',(current_date + 30)::text,
      'freight_amount','300','customs_amount','0','other_charges','200'),
    jsonb_build_array(jsonb_build_object('id', %2$L, 'quantity', 100, 'unit_price', 40), jsonb_build_object('id', %3$L, 'quantity', 50, 'unit_price', 20)))$f$,
    pg_temp.v('qa'), pg_temp.v('qa1'), pg_temp.v('qa2')));

-- ══ The workflow ══
-- Line 2 sits at 12% below the 15% minimum with no note: blocked. A note lets it through.
select pg_temp.refused('submit: blocked below the minimum margin without a note', :dev, format('select public.pricing_sheet_submit(%L)', pg_temp.v('s1')), 'PRICING_BLOCKED');
select pg_temp.passes('sheet: the reason is written', :dev, format('update public.pricing_sheets set margin_note = ''PT strategic client'' where id = %L returning 1', pg_temp.v('s1')));
select pg_temp.passes('work submits', :dev, format('select public.pricing_sheet_submit(%L)', pg_temp.v('s1')));
select pg_temp.eq('submitted: stamped by the submitter, with the minimum in force',
  (select status || '/' || (submitted_by = pg_temp.uid('staff.dev@arak-sa.com'))::text || '/' || min_margin_pct::text from public.pricing_sheets where id = pg_temp.v('s1')::uuid), 'submitted/true/15.00');
-- Frozen.
select pg_temp.refused('frozen: lines cannot be saved', :dev, format($f$select public.pricing_save_lines(%L, '[{"description":"x","quantity":1,"unit":"u"}]')$f$, pg_temp.v('s1')), 'PRICING_NOT_DRAFT');
select pg_temp.refused('frozen: prices cannot be saved', :dev, format($f$select public.pricing_save_prices(%L, jsonb_build_object(%L, 60))$f$, pg_temp.v('s1'), pg_temp.v('p1')), 'PRICING_NOT_DRAFT');
select pg_temp.refused('frozen: offers cannot be chosen', :dev, format($f$select public.pricing_select_offers(%L, jsonb_build_object(%L, null::text))$f$, pg_temp.v('s1'), pg_temp.v('p1')), 'PRICING_NOT_DRAFT');
select pg_temp.refused('frozen: a category cannot change', :dev, format('update public.pricing_lines set cost_category = ''other'' where id = %L', pg_temp.v('p1')), 'PRICING_NOT_DRAFT');
select pg_temp.refused('frozen: a quote cannot be saved', :dev, format($f$select public.pricing_save_quote(%L, jsonb_build_object('status','received','currency','SAR','requested_on',current_date::text,'received_on',current_date::text))$f$, pg_temp.v('qa')), 'PRICING_NOT_DRAFT');
select pg_temp.refused('frozen: no new request', :dev, format('select public.pricing_request_quote(%L, %L, ''SAR'', current_date)', pg_temp.v('s1'), pg_temp.v('s_sar')), 'PRICING_NOT_DRAFT');
select pg_temp.refused('frozen: a quote cannot be deleted', :dev, format('delete from public.supplier_quotes where id = %L', pg_temp.v('qa')), 'PRICING_NOT_DRAFT');
select pg_temp.refused('frozen: the title cannot change', :dev, format('update public.pricing_sheets set title = ''x'' where id = %L', pg_temp.v('s1')), 'PRICING_LOCKED');
select pg_temp.refused('frozen: a submitted sheet is not deleted', :dev, format('delete from public.pricing_sheets where id = %L', pg_temp.v('s1')), 'PRICING_DELETE_NOT_DRAFT');
select pg_temp.refused('submit twice is refused', :dev, format('select public.pricing_sheet_submit(%L)', pg_temp.v('s1')), 'PRICING_TRANSITION');
select pg_temp.refused('work cannot approve', :dev, format('select public.pricing_sheet_approve(%L)', pg_temp.v('s1')), 'PRICING_NOT_ALLOWED');
select pg_temp.refused('view cannot approve', :mkt, format('select public.pricing_sheet_approve(%L)', pg_temp.v('s1')), 'PRICING_NOT_ALLOWED');
select pg_temp.refused('work cannot cancel a submitted sheet', :dev, format('select public.pricing_sheet_cancel(%L, ''PT reason'')', pg_temp.v('s1')), 'PRICING_NOT_ALLOWED');
select pg_temp.refused('view cannot return', :mkt, format('select public.pricing_sheet_return(%L)', pg_temp.v('s1')), 'PRICING_NOT_ALLOWED');
-- Return to draft: work. The stamps are cleared and the sheet is editable again.
select pg_temp.passes('work returns a submitted sheet to draft', :dev, format('select public.pricing_sheet_return(%L)', pg_temp.v('s1')));
select pg_temp.eq('returned: the stamps are cleared',
  (select status || '/' || (submitted_at is null and submitted_by is null and min_margin_pct is null)::text from public.pricing_sheets where id = pg_temp.v('s1')::uuid), 'draft/true');
select pg_temp.refused('return of a draft is refused', :dev, format('select public.pricing_sheet_return(%L)', pg_temp.v('s1')), 'PRICING_TRANSITION');
select pg_temp.refused('approve of a draft is refused (submit first)', :admin, format('select public.pricing_sheet_approve(%L)', pg_temp.v('s1')), 'PRICING_TRANSITION');
select pg_temp.passes('the draft is editable again', :dev, format($f$select public.pricing_save_prices(%L, jsonb_build_object(%L, 55))$f$, pg_temp.v('s1'), pg_temp.v('p1')));
select pg_temp.passes('resubmitted', :dev, format('select public.pricing_sheet_submit(%L)', pg_temp.v('s1')));
-- The minimum margin changes later: the one in force at submission is kept.
select pg_temp.passes('manage changes the minimum to 5', :admin, format('update public.pricing_settings set min_margin_pct = 5 where workspace_id = %L', '00000000-0000-0000-0000-000000000001'));
select pg_temp.eq('work cannot change the minimum (no row is touched)', pg_temp.q(:dev, format('with u as (update public.pricing_settings set min_margin_pct = 1 where workspace_id = %L returning 1) select count(*) from u', '00000000-0000-0000-0000-000000000001')), '0');
select pg_temp.eq('the minimum stays at 5', (select min_margin_pct::text from public.pricing_settings where workspace_id = :arak), '5.00');
select pg_temp.eq('the sheet keeps the minimum of its submission', (select min_margin_pct::text from public.pricing_sheets where id = pg_temp.v('s1')::uuid), '15.00');
select pg_temp.refused('the minimum must stay under 100', :admin, format('update public.pricing_settings set min_margin_pct = 100 where workspace_id = %L', '00000000-0000-0000-0000-000000000001'), 'pricing_settings_min_margin_pct_check');
-- Approve: manage only.
select pg_temp.passes('manage approves', :admin, format('select public.pricing_sheet_approve(%L)', pg_temp.v('s1')));
select pg_temp.eq('approved: stamped', (select status || '/' || (approved_by = pg_temp.uid('staff.admin@arak-sa.com'))::text from public.pricing_sheets where id = pg_temp.v('s1')::uuid), 'approved/true');
select pg_temp.refused('approved: not editable', :dev, format($f$select public.pricing_save_prices(%L, jsonb_build_object(%L, 99))$f$, pg_temp.v('s1'), pg_temp.v('p1')), 'PRICING_NOT_DRAFT');
select pg_temp.refused('approved: not returned', :admin, format('select public.pricing_sheet_return(%L)', pg_temp.v('s1')), 'PRICING_TRANSITION');
select pg_temp.refused('approved: not deleted', :admin, format('delete from public.pricing_sheets where id = %L', pg_temp.v('s1')), 'PRICING_DELETE_NOT_DRAFT');
select pg_temp.refused('approved: work cannot cancel it', :dev, format('select public.pricing_sheet_cancel(%L, ''PT reason'')', pg_temp.v('s1')), 'PRICING_NOT_ALLOWED');
select pg_temp.refused('approved: cancelling needs a reason', :admin, format('select public.pricing_sheet_cancel(%L, ''  '')', pg_temp.v('s1')), 'PRICING_REASON');
select pg_temp.passes('approved: manage cancels with a reason', :admin, format('select public.pricing_sheet_cancel(%L, ''PT scope changed'')', pg_temp.v('s1')));
select pg_temp.eq('cancelled: stamped with the reason', (select status || '/' || cancel_reason from public.pricing_sheets where id = pg_temp.v('s1')::uuid), 'cancelled/PT scope changed');
select pg_temp.refused('cancelled is final: no return', :admin, format('select public.pricing_sheet_return(%L)', pg_temp.v('s1')), 'PRICING_TRANSITION');
select pg_temp.refused('cancelled is final: no second cancel', :admin, format('select public.pricing_sheet_cancel(%L, ''x'')', pg_temp.v('s1')), 'PRICING_LOCKED');
select pg_temp.refused('cancelled is final: no edit', :dev, format($f$select public.pricing_save_prices(%L, jsonb_build_object(%L, 99))$f$, pg_temp.v('s1'), pg_temp.v('p1')), 'PRICING_NOT_DRAFT');
select pg_temp.refused('cancelled is not deleted', :admin, format('delete from public.pricing_sheets where id = %L', pg_temp.v('s1')), 'PRICING_DELETE_NOT_DRAFT');
-- A draft is cancelled by its preparer; a submitted sheet by an approver.
select pg_temp.refused('a draft cannot be cancelled by view', :mkt, format('select public.pricing_sheet_cancel(%L, ''x'')', pg_temp.v('s2')), 'PRICING_NOT_ALLOWED');
select pg_temp.refused('cancelling a draft needs a reason', :dev, format('select public.pricing_sheet_cancel(%L, '''')', pg_temp.v('s2')), 'PRICING_REASON');
select pg_temp.passes('work cancels a draft', :dev, format('select public.pricing_sheet_cancel(%L, ''PT not needed'')', pg_temp.v('s2')));
-- Self-approval is allowed (the sheet shows a badge): manage who submitted may approve.
select pg_temp.setv('s3', pg_temp.q(:admin, format('insert into public.pricing_sheets (workspace_id, lead_id, title) values (%L, %L, ''PT sheet three'') returning id', '00000000-0000-0000-0000-000000000001', pg_temp.v('l2'))));
select pg_temp.passes('a sheet is created by manage', :admin, format('select public.pricing_import_lines(%L, ''[{"description":"PT only line","quantity":2,"unit":"pc"}]'')', pg_temp.v('s3')));
select pg_temp.passes('manage can request a quote', :admin, format('select public.pricing_request_quote(%L, %L, ''SAR'', current_date)', pg_temp.v('s3'), pg_temp.v('s_sar')));

-- ══ Deleting a draft only ══
select pg_temp.eq('work deletes a draft, with its lines and quotes',
  pg_temp.q(:dev, format('with u as (delete from public.pricing_sheets where id = %L returning 1) select count(*) from u', pg_temp.v('s3'))), '1');
select pg_temp.eq('the draft''s lines and quotes went with it',
  (select (select count(*) from public.pricing_lines where sheet_id = pg_temp.v('s3')::uuid) + (select count(*) from public.supplier_quotes where sheet_id = pg_temp.v('s3')::uuid) + (select count(*) from public.supplier_quote_lines where quote_id in (select id from public.supplier_quotes where sheet_id = pg_temp.v('s3')::uuid)))::text, '0');
select pg_temp.eq('a deleted draft''s history stays', (select count(*) > 0 from public.pricing_audit where sheet_id = pg_temp.v('s3')::uuid), true);
-- Deleting a quote unselects its lines and the offer lines go.
select pg_temp.setv('s4', pg_temp.q(:dev, format('insert into public.pricing_sheets (workspace_id, lead_id, title) values (%L, %L, ''PT sheet four'') returning id', '00000000-0000-0000-0000-000000000001', pg_temp.v('l2'))));
select pg_temp.passes('sheet four has a line', :dev, format('select public.pricing_import_lines(%L, ''[{"description":"PT l","quantity":2,"unit":"pc"}]'')', pg_temp.v('s4')));
select pg_temp.setv('q4', pg_temp.q(:dev, format('select public.pricing_request_quote(%L, %L, ''SAR'', current_date)', pg_temp.v('s4'), pg_temp.v('s_sar'))));
select pg_temp.passes('sheet four quote received', :dev, format($f$select public.pricing_save_quote(%L, jsonb_build_object('status','received','currency','SAR','requested_on',current_date::text,'received_on',current_date::text), jsonb_build_array(jsonb_build_object('id', (select id::text from public.supplier_quote_lines where quote_id = %L), 'quantity', 2, 'unit_price', 10)))$f$, pg_temp.v('q4'), pg_temp.v('q4')));
select pg_temp.passes('sheet four chooses it', :dev, format($f$select public.pricing_select_offers(%L, jsonb_build_object((select id::text from public.pricing_lines where sheet_id = %L), (select id::text from public.supplier_quote_lines where quote_id = %L)))$f$, pg_temp.v('s4'), pg_temp.v('s4'), pg_temp.v('q4')));
select pg_temp.refused('quote: an offer cannot answer a line of another sheet', :dev,
  format($f$select public.pricing_save_quote(%L, jsonb_build_object('status','received','currency','SAR','requested_on',current_date::text,'received_on',current_date::text), '[]', jsonb_build_array(jsonb_build_object('pricing_line_id', %L, 'unit_price', 5)))$f$, pg_temp.v('q4'), pg_temp.v('p1')), 'PRICING_QUOTE_LINE');
select pg_temp.passes('a draft''s quote can be deleted', :dev, format('delete from public.supplier_quotes where id = %L', pg_temp.v('q4')));
select pg_temp.eq('deleting the quote unselected the line', (select selected_quote_line_id is null from public.pricing_lines where sheet_id = pg_temp.v('s4')::uuid), true);

-- ══ Company delete cascades ══
insert into public.workspaces (name) values ('PT doomed company');
select pg_temp.setv('wd', (select id::text from public.workspaces where name = 'PT doomed company'));
insert into public.crm_stages (workspace_id, name, sequence) values (pg_temp.v('wd')::uuid, 'PT d', 10);
insert into public.crm_leads (workspace_id, title, contact_name, stage_id) select workspace_id, 'PT doomed lead', 'PT', id from public.crm_stages where workspace_id = pg_temp.v('wd')::uuid;
insert into public.contacts_orgs (workspace_id, name, roles) values (pg_temp.v('wd')::uuid, 'PT doomed supplier', '{supplier}');
insert into public.pricing_sheets (workspace_id, lead_id, title) select workspace_id, id, 'PT doomed sheet' from public.crm_leads where workspace_id = pg_temp.v('wd')::uuid;
insert into public.pricing_lines (workspace_id, sheet_id, line_no, description, quantity, unit) select workspace_id, id, 1, 'd', 1, 'u' from public.pricing_sheets where workspace_id = pg_temp.v('wd')::uuid;
insert into public.supplier_quotes (workspace_id, sheet_id, supplier_id, currency) select s.workspace_id, s.id, (select id from public.contacts_orgs where workspace_id = s.workspace_id), 'SAR' from public.pricing_sheets s where s.workspace_id = pg_temp.v('wd')::uuid;
insert into public.supplier_quote_lines (workspace_id, quote_id, pricing_line_id, quantity, unit_price) select q.workspace_id, q.id, (select id from public.pricing_lines where workspace_id = q.workspace_id), 1, 5 from public.supplier_quotes q where q.workspace_id = pg_temp.v('wd')::uuid;
insert into public.pricing_settings (workspace_id, min_margin_pct) values (pg_temp.v('wd')::uuid, 10);
update public.supplier_quotes set status = 'received', received_on = current_date, freight_amount = 0, customs_amount = 0, other_charges = 0 where workspace_id = pg_temp.v('wd')::uuid;
update public.pricing_lines set selected_quote_line_id = (select id from public.supplier_quote_lines where workspace_id = pg_temp.v('wd')::uuid), unit_price = 9 where workspace_id = pg_temp.v('wd')::uuid;
select pg_temp.setv('wd_sheet', (select id::text from public.pricing_sheets where workspace_id = pg_temp.v('wd')::uuid));
update public.pricing_sheets set status = 'submitted', submitted_at = now() where id = pg_temp.v('wd_sheet')::uuid;
delete from public.workspaces where id = pg_temp.v('wd')::uuid;
select pg_temp.eq('company delete: every pricing table is empty for it',
  (select ((select count(*) from public.pricing_sheets where workspace_id = pg_temp.v('wd')::uuid)
         + (select count(*) from public.pricing_lines where workspace_id = pg_temp.v('wd')::uuid)
         + (select count(*) from public.supplier_quotes where workspace_id = pg_temp.v('wd')::uuid)
         + (select count(*) from public.supplier_quote_lines where workspace_id = pg_temp.v('wd')::uuid)
         + (select count(*) from public.pricing_settings where workspace_id = pg_temp.v('wd')::uuid)
         + (select count(*) from public.pricing_counters where workspace_id = pg_temp.v('wd')::uuid)
         + (select count(*) from public.pricing_audit where workspace_id = pg_temp.v('wd')::uuid))::text), '0');

-- ══ Row-level security on every table ══
select pg_temp.eq('rls: every pricing table has RLS on',
  (select string_agg(relname, ',' order by relname) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'
      and relname in ('currencies', 'pricing_settings', 'pricing_sheets', 'pricing_lines', 'supplier_quotes', 'supplier_quote_lines', 'pricing_counters', 'pricing_audit') and not relrowsecurity), null::text);
select pg_temp.eq('rls: the five working tables have a read policy gated by the section',
  (select count(*)::text from pg_policies where schemaname = 'public' and cmd = 'SELECT' and tablename in ('pricing_settings', 'pricing_sheets', 'pricing_lines', 'supplier_quotes', 'supplier_quote_lines', 'pricing_audit') and qual like '%has_section%pricing%'), '6');
select pg_temp.eq('rls: the counters have no policy and no grant',
  (select count(*)::text from pg_policies where tablename = 'pricing_counters') || '/' || has_table_privilege('authenticated', 'public.pricing_counters', 'select')::text, '0/false');
select pg_temp.eq('rls: the history cannot be written by the app',
  has_table_privilege('authenticated', 'public.pricing_audit', 'insert')::text || has_table_privilege('authenticated', 'public.pricing_audit', 'update')::text || has_table_privilege('authenticated', 'public.pricing_audit', 'delete')::text, 'falsefalsefalse');
select pg_temp.eq('rls: anon has nothing', (has_table_privilege('anon', 'public.pricing_sheets', 'select') or has_table_privilege('anon', 'public.supplier_quotes', 'select') or has_table_privilege('anon', 'public.pricing_audit', 'select'))::text, 'false');
select pg_temp.eq('rls: every write policy of the sheet tables needs Work',
  (select count(*)::text from pg_policies where schemaname = 'public' and tablename in ('pricing_sheets', 'pricing_lines', 'supplier_quotes', 'supplier_quote_lines') and cmd in ('INSERT', 'UPDATE', 'DELETE') and coalesce(qual, with_check) like '%''work''%'), '12');
select pg_temp.eq('rls: the settings'' write policies need Manage',
  (select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'pricing_settings' and cmd in ('INSERT', 'UPDATE') and coalesce(qual, with_check) like '%''manage''%'), '2');
select pg_temp.eq('rls: the cost views run as the caller',
  (select count(*)::text from pg_class where relnamespace = 'public'::regnamespace and relname in ('pricing_supplier_quote_line_cost', 'pricing_line_cost', 'pricing_sheet_totals') and 'security_invoker=true' = any(reloptions)), '3');
select pg_temp.eq('rls: the outsider reads no cost', pg_temp.q(:outsider, 'select count(*) from public.pricing_line_cost') || '/' || pg_temp.q(:outsider, 'select count(*) from public.pricing_sheet_totals'), '0/0');

-- ══ The history ══
select pg_temp.eq('history: the sheet''s insert is written', (select count(*) from public.pricing_audit where sheet_id = pg_temp.v('s1')::uuid and table_name = 'pricing_sheets' and action = 'insert'), 1::bigint);
select pg_temp.eq('history: the status changes are written',
  (select string_agg(new_data->>'status', '>' order by id) from public.pricing_audit where sheet_id = pg_temp.v('s1')::uuid and table_name = 'pricing_sheets' and action = 'update' and old_data->>'status' is distinct from new_data->>'status'),
  'submitted>draft>submitted>approved>cancelled');
select pg_temp.eq('history: who changed it is written', (select bool_and(changed_by is not null) from public.pricing_audit where sheet_id = pg_temp.v('s1')::uuid and table_name = 'pricing_sheets'), true);
select pg_temp.eq('history: lines, quotes and offers are written',
  (select count(distinct table_name)::text from public.pricing_audit where sheet_id = pg_temp.v('s1')::uuid), '4');
select pg_temp.eq('history: the minimum margin is written', (select count(*) > 0 from public.pricing_audit where table_name = 'pricing_settings' and workspace_id = :arak and sheet_id is null), true);

-- ══ The search ══
select pg_temp.eq('search: finds a sheet by its title', pg_temp.q(:mkt, format('select count(*) from public.shell_search_pricing(%L, ''sheet four'')', '00000000-0000-0000-0000-000000000001')), '1');
select pg_temp.eq('search: the outsider finds nothing', pg_temp.q(:outsider, format('select count(*) from public.shell_search_pricing(%L, ''sheet four'')', '00000000-0000-0000-0000-000000000001')), '0');

\o
select format('%s  %s%s', case when ok then 'PASS' else 'FAIL' end, name, case when ok then '' else '   -- ' || detail end) as result from t order by n;
select format('%s checks, %s failed', count(*), count(*) filter (where not ok)) as summary from t;
select count(*) filter (where not ok) as failed from t \gset
rollback;
\if :failed
\quit 1
\endif
