-- ─── Pricing test data for the LOCAL v2 database (never production) ────────
-- 2026-12-01. Invented only: every title ends in "(test)". Arak Lighting only:
-- two sheets on existing test opportunities and three supplier quotes (one in
-- USD), so the list, the sheet page, the comparison and the quote page can be
-- seen. Needs the CRM, Contacts and Catalog test data (their seed.sql).
--
--   docker exec -i supabase_db_arak-v2 psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < dev/erp-pilot/pricing/seed.sql
--
-- Runs once: a company that already has "(test)" sheets is skipped.
-- To start again: dev/erp-pilot/pricing/unseed.sql first.

\set ON_ERROR_STOP 1
begin;

do $$
declare
  arak uuid := '00000000-0000-0000-0000-000000000001';
  l1 uuid; l2 uuid; sup_sar uuid; sup_usd uuid; ci1 uuid; ci2 uuid;
  sa uuid; sb uuid; a1 uuid; a2 uuid; a3 uuid; b1 uuid; b2 uuid;
  qa uuid; qu uuid; qb uuid;
begin
  if exists (select 1 from public.pricing_sheets where workspace_id = arak and title like '%(test)') then
    raise notice 'Arak Lighting already has pricing test sheets: skipped';
    return;
  end if;
  select id into l1 from public.crm_leads where workspace_id = arak and status = 'open' and title = 'Office tower lobby lighting (test)';
  select id into l2 from public.crm_leads where workspace_id = arak and status = 'open' and title = 'Mall car park lighting retrofit (test)';
  select id into sup_sar from public.contacts_orgs where workspace_id = arak and name = 'Red Sea Lighting Supply (test)';
  select id into sup_usd from public.contacts_orgs where workspace_id = arak and name = 'Luce Italia S.r.l. (test)';
  select id into ci1 from public.catalog_items where workspace_id = arak and code = 'T-1001';
  select id into ci2 from public.catalog_items where workspace_id = arak and code = 'T-1002';
  if l1 is null or l2 is null or sup_sar is null or sup_usd is null then
    raise exception 'The CRM and Contacts test data are missing (their seed.sql files)';
  end if;

  -- Sheet A: priced, two quotes received, ready to read.
  insert into public.pricing_sheets (workspace_id, lead_id, title, notes) values (arak, l1, 'Lobby lighting package (test)', 'Invented for the screens.') returning id into sa;
  insert into public.pricing_lines (workspace_id, sheet_id, line_no, boq_ref, description, quantity, unit, catalog_item_id, cost_category) values
    (arak, sa, 1, 'E-01', 'Recessed downlight 12W (test)', 120, 'pcs', ci1, 'goods') returning id into a1;
  insert into public.pricing_lines (workspace_id, sheet_id, line_no, boq_ref, description, quantity, unit, catalog_item_id, cost_category) values
    (arak, sa, 2, 'E-02', 'Linear LED profile 1m (test)', 80, 'm', ci2, 'goods') returning id into a2;
  insert into public.pricing_lines (workspace_id, sheet_id, line_no, boq_ref, description, quantity, unit, cost_category) values
    (arak, sa, 3, 'E-03', 'Installation and commissioning (test)', 1, 'lot', 'installation') returning id into a3;

  insert into public.supplier_quotes (workspace_id, sheet_id, supplier_id, currency, status, requested_on, received_on, valid_until, supplier_ref, freight_amount, customs_amount, other_charges)
  values (arak, sa, sup_sar, 'SAR', 'received', current_date - 6, current_date - 3, current_date + 25, 'RS-1042 (test)', 600, 0, 150) returning id into qa;
  insert into public.supplier_quotes (workspace_id, sheet_id, supplier_id, currency, status, requested_on, received_on, valid_until, fx_rate, freight_amount, customs_amount, other_charges)
  values (arak, sa, sup_usd, 'USD', 'received', current_date - 6, current_date - 2, current_date + 20, 3.75, 400, 250, 0) returning id into qu;
  insert into public.supplier_quote_lines (workspace_id, quote_id, pricing_line_id, quantity, unit_price, brand, model_no, lead_time_days) values
    (arak, qa, a1, 120, 38, 'Lumen Test', 'RD-12', 14),
    (arak, qa, a2, 80, 21.5, 'Lumen Test', 'LP-100', 21),
    (arak, qa, a3, 1, 1800, null, null, null),
    (arak, qu, a1, 120, 9.2, 'Luce', 'DL-12', 45),
    (arak, qu, a2, 80, 5.6, 'Luce', 'LN-100', 45),
    (arak, qu, a3, 1, null, null, null, null);
  insert into public.supplier_quote_lines (workspace_id, quote_id, pricing_line_id, quantity, unit_price, brand, model_no, is_alternative) values
    (arak, qa, a1, 120, 34, 'Budget Test', 'BD-10', true);
  update public.pricing_lines set selected_quote_line_id = (select id from public.supplier_quote_lines where quote_id = qa and pricing_line_id = a1 and not is_alternative), unit_price = 52 where id = a1;
  update public.pricing_lines set selected_quote_line_id = (select id from public.supplier_quote_lines where quote_id = qu and pricing_line_id = a2), unit_price = 36 where id = a2;
  update public.pricing_lines set selected_quote_line_id = (select id from public.supplier_quote_lines where quote_id = qa and pricing_line_id = a3), unit_price = 2300 where id = a3;

  -- Sheet B: just started, a request out, nothing priced.
  insert into public.pricing_sheets (workspace_id, lead_id, title) values (arak, l2, 'Car park retrofit (test)') returning id into sb;
  insert into public.pricing_lines (workspace_id, sheet_id, line_no, boq_ref, description, quantity, unit) values
    (arak, sb, 1, '1.1', 'LED tube replacement (test)', 300, 'pcs') returning id into b1;
  insert into public.pricing_lines (workspace_id, sheet_id, line_no, boq_ref, description, quantity, unit) values
    (arak, sb, 2, '1.2', 'Emergency lighting (test)', 40, 'pcs') returning id into b2;
  insert into public.supplier_quotes (workspace_id, sheet_id, supplier_id, currency, status) values (arak, sb, sup_sar, 'SAR', 'requested') returning id into qb;
  insert into public.supplier_quote_lines (workspace_id, quote_id, pricing_line_id, quantity) values (arak, qb, b1, 300), (arak, qb, b2, 40);
end $$;

commit;
