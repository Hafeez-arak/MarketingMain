-- ─── Catalog test data for the LOCAL v2 database (never production) ────────
-- 2026-10-30. Invented items only: every name ends in "(test)", every code
-- starts with T-. Arak Lighting only: 5 specification fields and 6 items
-- with some specs, so the list, grouping, the form and the history can be
-- seen. Nothing here is a real product.
--
--   docker exec -i supabase_db_arak-v2 psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < dev/erp-pilot/catalog/seed.sql
--
-- Runs once: a company that already has catalog rows is skipped.
-- To start again: dev/erp-pilot/catalog/unseed.sql first.

\set ON_ERROR_STOP 1
begin;

do $$
declare
  arak uuid := '00000000-0000-0000-0000-000000000001';
  f_power uuid; f_ip uuid; f_cct uuid; f_beam uuid; f_colour uuid;
  i1 uuid; i2 uuid; i3 uuid; i4 uuid; i5 uuid;
begin
  if exists (select 1 from public.catalog_items where workspace_id = arak)
     or exists (select 1 from public.catalog_spec_fields where workspace_id = arak) then
    raise notice 'Arak Lighting already has catalog rows: skipped';
    return;
  end if;

  insert into public.catalog_spec_fields (workspace_id, name, name_en, unit, sequence) values (arak, 'القدرة (test)', 'Power (test)', 'W', 10) returning id into f_power;
  insert into public.catalog_spec_fields (workspace_id, name, name_en, unit, sequence) values (arak, 'درجة الحماية (test)', 'IP rating (test)', null, 20) returning id into f_ip;
  insert into public.catalog_spec_fields (workspace_id, name, name_en, unit, sequence) values (arak, 'حرارة اللون (test)', 'Colour temperature (test)', 'K', 30) returning id into f_cct;
  insert into public.catalog_spec_fields (workspace_id, name, name_en, unit, sequence) values (arak, 'زاوية الإضاءة (test)', 'Beam angle (test)', '°', 40) returning id into f_beam;
  insert into public.catalog_spec_fields (workspace_id, name, name_en, unit, sequence, active) values (arak, 'اللون (test)', 'Colour (test)', null, 50, false) returning id into f_colour;

  insert into public.catalog_items (workspace_id, code, name, brand, model_no, category, unit, description, stocked) values
    (arak, 'T-1001', 'Recessed downlight (test)', 'Lumen Test', 'RD-12', 'Indoor', 'pcs', 'A test downlight.', true) returning id into i1;
  insert into public.catalog_items (workspace_id, code, name, brand, model_no, category, unit) values
    (arak, 'T-1002', 'Linear profile 1m (test)', 'Lumen Test', 'LP-100', 'Indoor', 'm') returning id into i2;
  insert into public.catalog_items (workspace_id, code, name, brand, model_no, category, unit) values
    (arak, 'T-2001', 'Flood light 100W (test)', 'Brightfield (test)', 'FL-100', 'Outdoor', 'pcs') returning id into i3;
  insert into public.catalog_items (workspace_id, code, name, brand, model_no, category, unit) values
    (arak, 'T-2002', 'Bollard (test)', 'Brightfield (test)', null, 'Outdoor', 'pcs') returning id into i4;
  insert into public.catalog_items (workspace_id, code, name, brand, model_no, category, unit, active) values
    (arak, 'T-3001', 'Old driver (test)', null, 'DR-1', null, 'pcs', false) returning id into i5;
  insert into public.catalog_items (workspace_id, code, name, unit) values (arak, 'T-9000', 'Uncategorised accessory (test)', 'set');

  insert into public.catalog_item_specs (workspace_id, item_id, field_id, value) values
    (arak, i1, f_power, '12'), (arak, i1, f_ip, 'IP20'), (arak, i1, f_cct, '3000'), (arak, i1, f_beam, '60'),
    (arak, i2, f_power, '18'), (arak, i2, f_cct, '4000'),
    (arak, i3, f_power, '100'), (arak, i3, f_ip, 'IP65'), (arak, i3, f_beam, '120'),
    (arak, i4, f_ip, 'IP54'),
    (arak, i5, f_colour, 'Black');
end $$;

commit;
