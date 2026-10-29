-- ─── v2: Pricing, the working functions and lookups ────────────────────────
-- 2026-12-01. What Musa's controllers do in one request, done in one
-- transaction here, so a half-saved BOQ or a quote without its offers cannot
-- exist. The save functions are SECURITY INVOKER: RLS and the guards of
-- 20261201_pricing_2_rules.sql decide what goes through, as for a plain write.
-- The lookups are SECURITY DEFINER and check the Pricing grant themselves:
-- they let a pricing user pick an opportunity, a supplier or a catalog item
-- without holding CRM, Contacts or Catalog (the CRM's crm_clients is the model).
--
-- v2 ONLY: the local v2 database (dev/v2db). Safe to re-run.

-- ── The BOQ ──
-- Save the whole BOQ of a draft: p_lines is the lines in their new order,
-- [{id?, boq_ref, description, quantity, unit, catalog_item_id, cost_category}].
-- A line with an id is updated; one without is added; a line of the sheet that
-- is not listed is deleted (with its supplier offers). Numbers are 1..n.
create or replace function public.pricing_save_lines(p_sheet uuid, p_lines jsonb)
returns integer
language plpgsql
set search_path = public
as $$
declare
  s public.pricing_sheets;
  e jsonb; n integer := 0; keep uuid[];
begin
  select * into s from public.pricing_sheets where id = p_sheet for update;
  if not found then raise exception 'PRICING_NOT_FOUND' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'PRICING_NO_ROWS' using errcode = 'P0001';
  end if;
  perform public.pricing_require_draft(p_sheet, 'a line');
  select coalesce(array_agg((x->>'id')::uuid), '{}') into keep from jsonb_array_elements(p_lines) x where nullif(x->>'id', '') is not null;
  if exists (select 1 from unnest(keep) k where not exists (select 1 from public.pricing_lines l where l.id = k and l.sheet_id = p_sheet)) then
    raise exception 'PRICING_LINE_MISSING' using errcode = 'P0001';
  end if;
  delete from public.pricing_lines where sheet_id = p_sheet and id <> all (keep);
  set constraints public.pricing_lines_no_uq deferred;
  for e in select x from jsonb_array_elements(p_lines) x loop
    n := n + 1;
    if nullif(e->>'id', '') is not null then
      update public.pricing_lines set
        line_no = n, boq_ref = nullif(btrim(e->>'boq_ref'), ''), description = e->>'description',
        quantity = (e->>'quantity')::numeric, unit = e->>'unit',
        catalog_item_id = nullif(e->>'catalog_item_id', '')::uuid, cost_category = nullif(e->>'cost_category', '')
       where id = (e->>'id')::uuid and sheet_id = p_sheet
         and (line_no, boq_ref, description, quantity, unit, catalog_item_id, cost_category)
             is distinct from (n, nullif(btrim(e->>'boq_ref'), ''), btrim(e->>'description'), (e->>'quantity')::numeric, btrim(e->>'unit'),
                               nullif(e->>'catalog_item_id', '')::uuid, nullif(e->>'cost_category', ''));
    else
      insert into public.pricing_lines (workspace_id, sheet_id, line_no, boq_ref, description, quantity, unit, catalog_item_id, cost_category)
      values (s.workspace_id, p_sheet, n, nullif(btrim(e->>'boq_ref'), ''), e->>'description', (e->>'quantity')::numeric, e->>'unit',
              nullif(e->>'catalog_item_id', '')::uuid, nullif(e->>'cost_category', ''));
    end if;
  end loop;
  set constraints public.pricing_lines_no_uq immediate;
  return n;
end $$;

-- Append imported lines after the existing ones (same line shape, no ids).
create or replace function public.pricing_import_lines(p_sheet uuid, p_lines jsonb)
returns integer
language plpgsql
set search_path = public
as $$
declare
  s public.pricing_sheets;
  e jsonb; n integer; c integer := 0;
begin
  select * into s from public.pricing_sheets where id = p_sheet for update;
  if not found then raise exception 'PRICING_NOT_FOUND' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'PRICING_NO_ROWS' using errcode = 'P0001';
  end if;
  perform public.pricing_require_draft(p_sheet, 'a line');
  select coalesce(max(line_no), 0) into n from public.pricing_lines where sheet_id = p_sheet;
  for e in select x from jsonb_array_elements(p_lines) x loop
    n := n + 1; c := c + 1;
    insert into public.pricing_lines (workspace_id, sheet_id, line_no, boq_ref, description, quantity, unit, cost_category)
    values (s.workspace_id, p_sheet, n, nullif(btrim(e->>'boq_ref'), ''), e->>'description', (e->>'quantity')::numeric, e->>'unit',
            nullif(e->>'cost_category', ''));
  end loop;
  return c;
end $$;

-- Selling prices, {lineId: price | null}; only changed ones are written.
create or replace function public.pricing_save_prices(p_sheet uuid, p_prices jsonb)
returns void
language plpgsql
set search_path = public
as $$
declare k text; v jsonb; l public.pricing_lines; np numeric;
begin
  perform public.pricing_require_draft(p_sheet, 'a line');
  for k, v in select * from jsonb_each(p_prices) loop
    select * into l from public.pricing_lines where id = k::uuid and sheet_id = p_sheet;
    if not found then raise exception 'PRICING_LINE_MISSING' using errcode = 'P0001'; end if;
    np := case when jsonb_typeof(v) = 'null' or v #>> '{}' = '' then null else round((v #>> '{}')::numeric, 2) end;
    if np is distinct from l.unit_price then
      update public.pricing_lines set unit_price = np where id = l.id;
    end if;
  end loop;
end $$;

-- The supplier offer chosen per line, {lineId: offerId | null}.
create or replace function public.pricing_select_offers(p_sheet uuid, p_sel jsonb)
returns void
language plpgsql
set search_path = public
as $$
declare k text; v jsonb; l public.pricing_lines; o uuid;
begin
  perform public.pricing_require_draft(p_sheet, 'a line');
  for k, v in select * from jsonb_each(p_sel) loop
    select * into l from public.pricing_lines where id = k::uuid and sheet_id = p_sheet;
    if not found then raise exception 'PRICING_LINE_MISSING' using errcode = 'P0001'; end if;
    o := case when jsonb_typeof(v) = 'null' or v #>> '{}' = '' then null else (v #>> '{}')::uuid end;
    if o is not null and not exists (select 1 from public.supplier_quote_lines q where q.id = o and q.pricing_line_id = l.id) then
      raise exception 'PRICING_SELECTION' using errcode = 'P0001';
    end if;
    if o is distinct from l.selected_quote_line_id then
      update public.pricing_lines set selected_quote_line_id = o where id = l.id;
    end if;
  end loop;
end $$;

-- Link a catalog item to a line: an active item of the same company.
create or replace function public.pricing_apply_catalog(p_line uuid, p_item uuid)
returns void
language plpgsql
set search_path = public
as $$
declare l public.pricing_lines;
begin
  select * into l from public.pricing_lines where id = p_line;
  if not found then raise exception 'PRICING_NOT_FOUND' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.pricing_catalog_items(l.workspace_id) i where i.id = p_item and i.active) then
    raise exception 'PRICING_ITEM' using errcode = 'P0001';
  end if;
  update public.pricing_lines set catalog_item_id = p_item where id = p_line;
end $$;

-- ── Supplier quotes ──
-- A request to one supplier for every line of the sheet (quantities from the
-- BOQ, prices empty). Returns the new quote's id.
create or replace function public.pricing_request_quote(p_sheet uuid, p_supplier uuid, p_currency text, p_requested_on date, p_notes text default null)
returns uuid
language plpgsql
set search_path = public
as $$
declare s public.pricing_sheets; q uuid;
begin
  select * into s from public.pricing_sheets where id = p_sheet;
  if not found then raise exception 'PRICING_NOT_FOUND' using errcode = 'P0001'; end if;
  perform public.pricing_require_draft(p_sheet, 'a supplier quote');
  if not exists (select 1 from public.pricing_lines where sheet_id = p_sheet) then
    raise exception 'PRICING_NO_LINES' using errcode = 'P0001';
  end if;
  insert into public.supplier_quotes (workspace_id, sheet_id, supplier_id, currency, requested_on, notes)
  values (s.workspace_id, p_sheet, p_supplier, p_currency, coalesce(p_requested_on, public.crm_today()), nullif(btrim(p_notes), ''))
  returning id into q;
  insert into public.supplier_quote_lines (workspace_id, quote_id, pricing_line_id, quantity)
  select s.workspace_id, q, l.id, l.quantity from public.pricing_lines l where l.sheet_id = p_sheet order by l.line_no;
  return q;
end $$;

-- Save a supplier quote: its header, the price of each main offer, and new alternatives.
--   p_header  {status, currency, fx_rate, requested_on, received_on, valid_until, supplier_ref,
--              freight_amount, customs_amount, other_charges, notes}   (empty = unknown / none)
--   p_offers  [{id, unit_price, quantity, brand, model_no, offered_description, lead_time_days}]
--   p_alts    [{pricing_line_id, unit_price, quantity, brand, model_no, offered_description}]
--             added only when it has a line and something offered
create or replace function public.pricing_save_quote(p_quote uuid, p_header jsonb, p_offers jsonb default '[]', p_alts jsonb default '[]')
returns void
language plpgsql
set search_path = public
as $$
declare q public.supplier_quotes; e jsonb; ql public.supplier_quote_lines; pl public.pricing_lines;
begin
  select * into q from public.supplier_quotes where id = p_quote for update;
  if not found then raise exception 'PRICING_NOT_FOUND' using errcode = 'P0001'; end if;
  perform public.pricing_require_draft(q.sheet_id, 'a supplier quote');
  update public.supplier_quotes set
    status = p_header->>'status',
    currency = p_header->>'currency',
    fx_rate = nullif(p_header->>'fx_rate', '')::numeric,
    requested_on = (p_header->>'requested_on')::date,
    received_on = nullif(p_header->>'received_on', '')::date,
    valid_until = nullif(p_header->>'valid_until', '')::date,
    supplier_ref = nullif(p_header->>'supplier_ref', ''),
    freight_amount = nullif(p_header->>'freight_amount', '')::numeric,
    customs_amount = nullif(p_header->>'customs_amount', '')::numeric,
    other_charges = nullif(p_header->>'other_charges', '')::numeric,
    notes = nullif(p_header->>'notes', '')
   where id = p_quote;
  for e in select x from jsonb_array_elements(coalesce(p_offers, '[]')) x loop
    select * into ql from public.supplier_quote_lines where id = (e->>'id')::uuid and quote_id = p_quote;
    if not found then raise exception 'PRICING_QUOTE_LINE' using errcode = 'P0001'; end if;
    update public.supplier_quote_lines set
      unit_price = nullif(e->>'unit_price', '')::numeric,
      quantity = (e->>'quantity')::numeric,
      brand = nullif(e->>'brand', ''), model_no = nullif(e->>'model_no', ''),
      offered_description = nullif(e->>'offered_description', ''),
      lead_time_days = nullif(e->>'lead_time_days', '')::integer
     where id = ql.id;
  end loop;
  for e in select x from jsonb_array_elements(coalesce(p_alts, '[]')) x loop
    continue when nullif(e->>'pricing_line_id', '') is null
      or (nullif(e->>'unit_price', '') is null and nullif(btrim(e->>'brand'), '') is null and nullif(btrim(e->>'model_no'), '') is null);
    select * into pl from public.pricing_lines where id = (e->>'pricing_line_id')::uuid and sheet_id = q.sheet_id;
    if not found then raise exception 'PRICING_QUOTE_LINE' using errcode = 'P0001'; end if;
    insert into public.supplier_quote_lines (workspace_id, quote_id, pricing_line_id, quantity, unit_price, brand, model_no, offered_description, is_alternative)
    values (q.workspace_id, p_quote, pl.id, coalesce(nullif(e->>'quantity', '')::numeric, pl.quantity), nullif(e->>'unit_price', '')::numeric,
            nullif(e->>'brand', ''), nullif(e->>'model_no', ''), nullif(e->>'offered_description', ''), true);
  end loop;
end $$;

-- ── Lookups ──

-- The company's opportunities as Pricing sees them (all, closed ones too, for
-- naming a sheet's opportunity; the browser offers only the open ones for a new sheet).
create or replace function public.pricing_leads(ws uuid)
returns table (id uuid, lead_no text, title text, party text, party_ar text, bid_due_date date, status text, consultant text)
language sql
stable
security definer
set search_path = public
as $$
  select l.id, l.lead_no, l.title, coalesce(o.name, l.organization, l.contact_name), coalesce(o.name_ar, o.name, l.organization, l.contact_name),
         l.bid_due_date, l.status, l.consultant
    from public.crm_leads l
    left join public.contacts_orgs o on o.id = l.client_org_id and o.workspace_id = l.workspace_id
   where l.workspace_id = ws and public.has_section(ws, 'pricing', 'view')
   order by l.bid_due_date nulls last, l.lead_no desc;
$$;

-- Organisations that are suppliers, plus any organisation a quote of the company names.
create or replace function public.pricing_suppliers(ws uuid)
returns table (id uuid, contact_no text, name text, name_ar text, status text, is_supplier boolean)
language sql
stable
security definer
set search_path = public
as $$
  select o.id, o.contact_no, o.name, o.name_ar, o.status, 'supplier' = any(o.roles)
    from public.contacts_orgs o
   where o.workspace_id = ws and public.has_section(ws, 'pricing', 'view')
     and ('supplier' = any(o.roles) or exists (select 1 from public.supplier_quotes q where q.supplier_id = o.id))
   order by o.name;
$$;

create or replace function public.pricing_catalog_items(ws uuid)
returns table (id uuid, code text, name text, unit text, brand text, model_no text, active boolean)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.code, i.name, i.unit, i.brand, i.model_no, i.active
    from public.catalog_items i
   where i.workspace_id = ws and public.has_section(ws, 'pricing', 'view')
   order by i.code;
$$;

-- Names for "changed by" and the workflow stamps: the company's approved logins.
create or replace function public.pricing_people(ws uuid)
returns table (user_id uuid, name text)
language sql
stable
security definer
set search_path = public
as $$
  select ua.user_id, coalesce(nullif(btrim(ua.full_name), ''), split_part(ua.email, '@', 1))
    from public.user_access ua
    join public.workspace_members m on m.user_id = ua.user_id and m.workspace_id = ws
   where public.has_section(ws, 'pricing', 'view');
$$;

-- ── Grants ──
revoke all on function
  public.pricing_save_lines(uuid, jsonb), public.pricing_import_lines(uuid, jsonb), public.pricing_save_prices(uuid, jsonb),
  public.pricing_select_offers(uuid, jsonb), public.pricing_apply_catalog(uuid, uuid),
  public.pricing_request_quote(uuid, uuid, text, date, text), public.pricing_save_quote(uuid, jsonb, jsonb, jsonb),
  public.pricing_leads(uuid), public.pricing_suppliers(uuid), public.pricing_catalog_items(uuid), public.pricing_people(uuid)
  from public, anon;
grant execute on function
  public.pricing_save_lines(uuid, jsonb), public.pricing_import_lines(uuid, jsonb), public.pricing_save_prices(uuid, jsonb),
  public.pricing_select_offers(uuid, jsonb), public.pricing_apply_catalog(uuid, uuid),
  public.pricing_request_quote(uuid, uuid, text, date, text), public.pricing_save_quote(uuid, jsonb, jsonb, jsonb),
  public.pricing_leads(uuid), public.pricing_suppliers(uuid), public.pricing_catalog_items(uuid), public.pricing_people(uuid)
  to authenticated;

-- ── The Ctrl/Cmd+K search (the shape of 20261130_catalog_3_search.sql) ──
-- SECURITY INVOKER: the pricing RLS decides what comes back. Matches the sheet
-- number, its title and the opportunity's number and title.
create or replace function public.shell_search_pricing(ws uuid, q text, lim integer default 5)
returns table (kind text, id uuid, title text, title_ar text, detail text, detail_ar text, meta jsonb, rank integer)
language sql
stable
security invoker
set search_path = public
as $$
  with a as (select public.shell_fold(q) as fq, least(greatest(coalesce(lim, 5), 1), 20) as n)
  select 'sheet'::text, s.id, s.title, null::text,
         concat_ws(' · ', s.sheet_no, s.status), concat_ws(' · ', s.sheet_no, s.status),
         jsonb_build_object('status', s.status),
         public.shell_rank(a.fq, array[s.title, s.sheet_no]) + case when s.status = 'cancelled' then 10 else 0 end as r
    from public.pricing_sheets s, a
   where s.workspace_id = ws
     and public.shell_hits(public.shell_fold(concat_ws(' ', s.sheet_no, s.title)), a.fq)
   order by r, s.title, s.id
   limit (select n from a);
$$;
revoke all on function public.shell_search_pricing(uuid, text, integer) from public, anon;
grant execute on function public.shell_search_pricing(uuid, text, integer) to authenticated;
