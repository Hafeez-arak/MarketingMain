-- ─── v2: Pricing, the rules ────────────────────────────────────────────────
-- 2026-12-01. Musa's pricing rules, read from his app and written here again
-- as Postgres functions and triggers on our tables (20261201_pricing_1_tables.sql).
-- His statuses are lowercase here (draft, submitted, approved, cancelled;
-- requested, received, declined).
--
--   numbering          PS-2026-000001 / SQ-2026-000001, per company and year
--   the sheet          draft → submitted → approved, back to draft, or cancelled
--                      with a reason; locks; deleted as a draft only
--   lines and quotes   change only while the sheet is a draft; one main offer
--                      per line plus alternatives; the chosen offer must be a
--                      priced offer of a received quote, for that line
--   costs              computed, never typed: charges spread by value, unknown
--                      stays unknown, a total only when every line is known
--   issues             what blocks a submission or an approval, what only warns
--   transitions        the only way status changes (security definer functions
--                      that check the section grant themselves)
--   working functions  save the BOQ, import it, save prices, choose offers,
--                      ask a supplier, save a quote, link a catalog item
--   lookups            the opportunities, suppliers and catalog items a pricing
--                      user may pick from without holding CRM, Contacts or Catalog
--
-- Refusals are raised as P0001 with a code as the message (PRICING_…); the
-- browser words them in lib/pricing/client.js. The guards are security
-- definer so they can see the opportunity, the supplier and the numbers
-- whatever the caller's other grants are; they never read the caller's
-- identity from anywhere but auth.uid().
--
-- Left for later modules: the AI review, the technical offers panel and the
-- reply alert (Tech offers), the financial offer from an approved sheet
-- (Quotations), exchange-rate suggestions (accounting), the project's use of
-- the approved sheet (Projects).
--
-- v2 ONLY: the local v2 database (dev/v2db). Safe to re-run.

-- ── Numbers ──
-- The counter row is updated in the same transaction as the insert, so a
-- refused insert gives its number back, and two people saving at once wait
-- for each other on the row instead of sharing a number.
create or replace function public.pricing_next_no(ws uuid, k text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  y integer := extract(year from public.crm_today())::integer;
  n integer;
begin
  insert into public.pricing_counters as c (workspace_id, kind, year, last) values (ws, k, y, 1)
  on conflict (workspace_id, kind, year) do update set last = c.last + 1
  returning last into n;
  return k || '-' || y || '-' || lpad(n::text, 6, '0');
end $$;
revoke all on function public.pricing_next_no(uuid, text) from public, anon, authenticated;

-- Lines, quotes and their lines change only while the sheet is a draft.
create or replace function public.pricing_require_draft(p_sheet uuid, p_what text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.pricing_sheets where id = p_sheet and status <> 'draft') then
    raise exception 'PRICING_NOT_DRAFT' using errcode = 'P0001', detail = p_what;
  end if;
end $$;
revoke all on function public.pricing_require_draft(uuid, text) from public, anon, authenticated;

-- Is this an active organisation of the company with the role supplier?
-- (Contacts' own contacts_org_is_active runs as the caller, so for someone
-- with Pricing but not Contacts it would always say no.)
create or replace function public.pricing_supplier_ok(org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.contacts_org_is_active(org)
         and exists (select 1 from public.contacts_orgs o where o.id = org and 'supplier' = any(o.roles));
$$;
revoke all on function public.pricing_supplier_ok(uuid) from public, anon, authenticated;

-- ── Costs (computed, never typed) ──
-- Landed charges are spread over the quote by value: ratio = charges / value of
-- the quote's main (non-alternative) priced lines; an alternative carries the
-- same ratio. Landed unit cost (SAR) = unit price × (1 + ratio) × exchange rate.
-- Any unknown (rate, a charge, the price) leaves the cost unknown.
create or replace view public.pricing_supplier_quote_line_cost with (security_invoker = true) as
with q as (
  select sq.id, sq.fx_rate, sq.valid_until, sq.status,
         sq.freight_amount + sq.customs_amount + sq.other_charges as charges,
         (select sum(l.quantity * l.unit_price) from public.supplier_quote_lines l
           where l.quote_id = sq.id and not l.is_alternative and l.unit_price is not null) as main_value
    from public.supplier_quotes sq
), r as (
  select q.*, case when q.charges is null then null
                   when q.charges = 0 then 0
                   when coalesce(q.main_value, 0) = 0 then null
                   else q.charges / q.main_value end as charges_ratio
    from q
)
select l.id as quote_line_id, l.workspace_id, l.quote_id, l.pricing_line_id, l.quantity, l.unit_price, l.is_alternative,
       r.status as quote_status, r.valid_until, r.fx_rate, r.charges, r.main_value, r.charges_ratio,
       round(l.unit_price * (1 + r.charges_ratio) * r.fx_rate, 4) as landed_unit_cost
  from public.supplier_quote_lines l
  join r on r.id = l.quote_id;

create or replace view public.pricing_line_cost with (security_invoker = true) as
select pl.id as pricing_line_id, pl.workspace_id, pl.sheet_id, pl.line_no, pl.quantity, pl.unit_price,
       pl.selected_quote_line_id, c.quote_id as selected_quote_id, c.valid_until as quote_valid_until,
       c.quantity as quoted_quantity,
       c.landed_unit_cost as unit_cost,
       round(c.landed_unit_cost * pl.quantity, 2) as cost_total,
       round(pl.unit_price * pl.quantity, 2) as sell_total,
       case when pl.unit_price is null or c.landed_unit_cost is null or pl.unit_price = 0 then null
            else round((pl.unit_price - c.landed_unit_cost) / pl.unit_price * 100, 2) end as margin_pct
  from public.pricing_lines pl
  left join public.pricing_supplier_quote_line_cost c on c.quote_line_id = pl.selected_quote_line_id;

-- A total is shown only when every line is known (otherwise null, with the count of unknowns).
create or replace view public.pricing_sheet_totals with (security_invoker = true) as
select s.id as sheet_id, s.workspace_id,
       count(c.pricing_line_id) as line_count,
       count(c.pricing_line_id) filter (where c.unit_price is null) as unpriced_count,
       count(c.pricing_line_id) filter (where c.unit_cost is null) as uncosted_count,
       case when count(c.pricing_line_id) > 0 and count(c.pricing_line_id) filter (where c.unit_price is null) = 0
            then sum(c.sell_total) end as sell_total,
       case when count(c.pricing_line_id) > 0 and count(c.pricing_line_id) filter (where c.unit_cost is null) = 0
            then sum(c.cost_total) end as cost_total
  from public.pricing_sheets s
  left join public.pricing_line_cost c on c.sheet_id = s.id
 group by s.id, s.workspace_id;

grant select on public.pricing_supplier_quote_line_cost, public.pricing_line_cost, public.pricing_sheet_totals to authenticated;

-- ── Issues: what stands between a sheet and its submission / approval ──
-- blocking = refuses submit and approve; otherwise a warning shown to the approver.
create or replace function public.pricing_sheet_issues(p_sheet uuid)
returns table (code text, line_no integer, blocking boolean)
language plpgsql
stable
set search_path = public
as $$
declare
  v_min  numeric;
  v_note text;
begin
  select s.margin_note, (select st.min_margin_pct from public.pricing_settings st where st.workspace_id = s.workspace_id)
    into v_note, v_min from public.pricing_sheets s where s.id = p_sheet;
  if not exists (select 1 from public.pricing_lines where sheet_id = p_sheet) then
    return query select 'NO_LINES'::text, null::integer, true;
    return;
  end if;
  if v_min is null then
    return query select 'MIN_MARGIN_UNSET'::text, null::integer, false;
  end if;
  return query
  select x.code, x.line_no, x.blocking from (
    select 'UNPRICED'::text as code, c.line_no, true as blocking, 1 as o from public.pricing_line_cost c
     where c.sheet_id = p_sheet and c.unit_price is null
    union all
    select 'NO_SUPPLIER', c.line_no, true, 2 from public.pricing_line_cost c
     where c.sheet_id = p_sheet and c.selected_quote_line_id is null
    union all
    select 'COST_UNKNOWN', c.line_no, true, 3 from public.pricing_line_cost c
     where c.sheet_id = p_sheet and c.selected_quote_line_id is not null and c.unit_cost is null
    union all
    select 'QUOTE_EXPIRED', c.line_no, true, 4 from public.pricing_line_cost c
     where c.sheet_id = p_sheet and c.quote_valid_until < public.crm_today()
    union all
    select 'QUOTE_VALIDITY_UNKNOWN', c.line_no, false, 5 from public.pricing_line_cost c
     where c.sheet_id = p_sheet and c.selected_quote_line_id is not null and c.quote_valid_until is null
    union all
    select 'QTY_SHORT', c.line_no, false, 6 from public.pricing_line_cost c
     where c.sheet_id = p_sheet and c.quoted_quantity < c.quantity
    union all
    select 'BELOW_COST', c.line_no, v_note is null, 7 from public.pricing_line_cost c
     where c.sheet_id = p_sheet and c.unit_cost is not null and c.unit_price is not null and c.unit_price < c.unit_cost
    union all
    select 'BELOW_MIN_MARGIN', c.line_no, v_note is null, 8 from public.pricing_line_cost c
     where c.sheet_id = p_sheet and v_min is not null and c.margin_pct is not null and c.margin_pct < v_min
       and c.unit_price >= c.unit_cost
  ) x order by x.o, x.line_no;
end $$;
grant execute on function public.pricing_sheet_issues(uuid) to authenticated;

-- ── The sheet's guard ──
-- draft is edited; submitted goes to approved, back to draft or cancelled;
-- approved only to cancelled (with a reason); cancelled is final. Submit and
-- approve pass only without blocking issues; the minimum margin in force is
-- recorded at each step. Status changes are written only by the transition
-- functions below (the client has no update grant on those columns).
create or replace function public.pricing_sheets_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cancel_cols constant text[] := array['status', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'updated_at'];
  flow_cols   constant text[] := array['status', 'submitted_at', 'submitted_by', 'approved_at', 'approved_by', 'min_margin_pct', 'updated_at'];
  user_cols   constant text[] := array['created_by', 'submitted_by', 'approved_by', 'cancelled_by'];
  v_issue text;
begin
  if tg_op = 'DELETE' then
    if public.crm_company_gone(old.workspace_id) then
      return old;
    end if;
    if old.status <> 'draft' then
      raise exception 'PRICING_DELETE_NOT_DRAFT' using errcode = 'P0001';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'PRICING_TRANSITION' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.crm_leads where id = new.lead_id and workspace_id = new.workspace_id and status = 'open') then
      raise exception 'PRICING_LEAD_CLOSED' using errcode = 'P0001';
    end if;
    new.title := btrim(new.title);
    new.notes := nullif(btrim(new.notes), '');
    new.margin_note := nullif(btrim(new.margin_note), '');
    new.sheet_no := public.pricing_next_no(new.workspace_id, 'PS');
    new.min_margin_pct := null;
    new.submitted_at := null; new.submitted_by := null; new.approved_at := null; new.approved_by := null;
    new.cancelled_at := null; new.cancelled_by := null; new.cancel_reason := null;
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  -- A login removed from the company empties the person's columns (set null):
  -- nothing else changes, and the sheet's lock does not stand in the way.
  if (to_jsonb(new) - 'updated_at' - user_cols) = (to_jsonb(old) - 'updated_at' - user_cols)
     and (new.created_by is null or new.created_by = old.created_by)
     and (new.submitted_by is null or new.submitted_by = old.submitted_by)
     and (new.approved_by is null or new.approved_by = old.approved_by)
     and (new.cancelled_by is null or new.cancelled_by = old.cancelled_by) then
    return new;
  end if;

  if new.workspace_id is distinct from old.workspace_id or new.sheet_no is distinct from old.sheet_no
     or new.lead_id is distinct from old.lead_id or new.created_by is distinct from old.created_by then
    raise exception 'PRICING_LOCKED' using errcode = 'P0001';
  end if;

  if old.status = 'cancelled' then
    raise exception 'PRICING_LOCKED' using errcode = 'P0001';
  end if;

  if new.status = 'cancelled' then
    if (to_jsonb(new) - cancel_cols) is distinct from (to_jsonb(old) - cancel_cols) then
      raise exception 'PRICING_LOCKED' using errcode = 'P0001';
    end if;
    new.updated_at := now();
    return new;
  end if;

  if old.status = 'approved' then
    raise exception 'PRICING_LOCKED' using errcode = 'P0001';
  end if;

  if old.status = 'submitted' then
    if new.status not in ('submitted', 'approved', 'draft') or (to_jsonb(new) - flow_cols) is distinct from (to_jsonb(old) - flow_cols) then
      raise exception 'PRICING_LOCKED' using errcode = 'P0001';
    end if;
    if new.status = 'draft' then
      new.submitted_at := null; new.submitted_by := null; new.min_margin_pct := null;
      new.updated_at := now();
      return new;
    end if;
  elsif new.status not in ('draft', 'submitted') then
    raise exception 'PRICING_TRANSITION' using errcode = 'P0001';
  end if;

  if new.status is distinct from old.status and new.status in ('submitted', 'approved') then
    select i.code into v_issue from public.pricing_sheet_issues(old.id) i where i.blocking limit 1;
    if v_issue is not null then
      raise exception 'PRICING_BLOCKED' using errcode = 'P0001', detail = v_issue;
    end if;
    new.min_margin_pct := (select st.min_margin_pct from public.pricing_settings st where st.workspace_id = old.workspace_id);
  end if;
  new.title := btrim(new.title);
  new.notes := nullif(btrim(new.notes), '');
  new.margin_note := nullif(btrim(new.margin_note), '');
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists pricing_sheets_guard on public.pricing_sheets;
create trigger pricing_sheets_guard before insert or update or delete on public.pricing_sheets
  for each row execute function public.pricing_sheets_guard();

-- A new sheet moves its open opportunity to the stage the company tied to
-- "pricing started" (crm_stages.auto_event = 'pricing'), if it tied one.
create or replace function public.pricing_sheets_stage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.crm_auto_stage(new.lead_id, 'pricing');
  return null;
end $$;
drop trigger if exists pricing_sheets_stage on public.pricing_sheets;
create trigger pricing_sheets_stage after insert on public.pricing_sheets
  for each row execute function public.pricing_sheets_stage();

-- ── Lines ──
create or replace function public.pricing_lines_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sel record;
begin
  if tg_op = 'DELETE' then
    if public.crm_company_gone(old.workspace_id) then
      return old;
    end if;
    perform public.pricing_require_draft(old.sheet_id, 'a line');
    return old;
  end if;
  perform public.pricing_require_draft(new.sheet_id, 'a line');
  if tg_op = 'UPDATE' then
    perform public.pricing_require_draft(old.sheet_id, 'a line');
    if new.sheet_id is distinct from old.sheet_id or new.workspace_id is distinct from old.workspace_id then
      raise exception 'PRICING_LOCKED' using errcode = 'P0001';
    end if;
  end if;
  new.boq_ref := nullif(btrim(new.boq_ref), '');
  new.description := btrim(new.description);
  new.unit := btrim(new.unit);
  new.notes := nullif(btrim(new.notes), '');
  if new.selected_quote_line_id is not null and (tg_op = 'INSERT' or new.selected_quote_line_id is distinct from old.selected_quote_line_id) then
    select l.pricing_line_id, l.unit_price, q.status into v_sel
      from public.supplier_quote_lines l join public.supplier_quotes q on q.id = l.quote_id
     where l.id = new.selected_quote_line_id;
    if v_sel.pricing_line_id is distinct from new.id or v_sel.status <> 'received' or v_sel.unit_price is null then
      raise exception 'PRICING_SELECTION' using errcode = 'P0001';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists pricing_lines_guard on public.pricing_lines;
create trigger pricing_lines_guard before insert or update or delete on public.pricing_lines
  for each row execute function public.pricing_lines_guard();

-- ── Supplier quotes ──
create or replace function public.supplier_quotes_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if public.crm_company_gone(old.workspace_id) then
      return old;
    end if;
    perform public.pricing_require_draft(old.sheet_id, 'a supplier quote');
    return old;
  end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'updated_at' - 'created_by') = (to_jsonb(old) - 'updated_at' - 'created_by')
     and new.created_by is null then
    return new;  -- the creator's login was removed (set null)
  end if;
  perform public.pricing_require_draft(new.sheet_id, 'a supplier quote');
  if tg_op = 'INSERT' then
    if not public.pricing_supplier_ok(new.supplier_id) then
      raise exception 'PRICING_SUPPLIER' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.currencies c where c.code = new.currency and c.active) then
      raise exception 'PRICING_CURRENCY' using errcode = 'P0001';
    end if;
    new.quote_no := public.pricing_next_no(new.workspace_id, 'SQ');
    new.created_by := auth.uid();
    new.created_at := now();
  else
    if new.sheet_id is distinct from old.sheet_id or new.quote_no is distinct from old.quote_no
       or new.supplier_id is distinct from old.supplier_id or new.workspace_id is distinct from old.workspace_id then
      raise exception 'PRICING_LOCKED' using errcode = 'P0001';
    end if;
    if new.currency is distinct from old.currency and not exists (select 1 from public.currencies c where c.code = new.currency) then
      raise exception 'PRICING_CURRENCY' using errcode = 'P0001';
    end if;
    -- A quote chosen for a line stays received (unselect the line first).
    if old.status = 'received' and new.status <> 'received' and exists (
         select 1 from public.pricing_lines pl join public.supplier_quote_lines l on l.id = pl.selected_quote_line_id where l.quote_id = old.id) then
      raise exception 'PRICING_QUOTE_SELECTED' using errcode = 'P0001';
    end if;
    -- A rate belongs to its currency: a changed currency keeps no old rate.
    if new.currency is distinct from old.currency and new.fx_rate is not distinct from old.fx_rate then
      new.fx_rate := null;
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.supplier_ref := nullif(btrim(new.supplier_ref), '');
  new.notes := nullif(btrim(new.notes), '');
  -- A quote in the base currency (SAR) has rate 1: set here, never typed.
  if new.currency = 'SAR' then
    new.fx_rate := 1;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists supplier_quotes_guard on public.supplier_quotes;
create trigger supplier_quotes_guard before insert or update or delete on public.supplier_quotes
  for each row execute function public.supplier_quotes_guard();

create or replace function public.supplier_quote_lines_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sheet uuid;
begin
  if tg_op = 'DELETE' then
    if public.crm_company_gone(old.workspace_id) then
      return old;
    end if;
    select sheet_id into v_sheet from public.supplier_quotes where id = old.quote_id;
    if v_sheet is not null then
      perform public.pricing_require_draft(v_sheet, 'a supplier quote line');
    end if;
    return old;
  end if;
  select sheet_id into v_sheet from public.supplier_quotes where id = new.quote_id;
  perform public.pricing_require_draft(v_sheet, 'a supplier quote line');
  if not exists (select 1 from public.pricing_lines where id = new.pricing_line_id and sheet_id = v_sheet) then
    raise exception 'PRICING_QUOTE_LINE' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' then
    if new.quote_id is distinct from old.quote_id or new.pricing_line_id is distinct from old.pricing_line_id
       or new.is_alternative is distinct from old.is_alternative or new.workspace_id is distinct from old.workspace_id then
      raise exception 'PRICING_QUOTE_LINE' using errcode = 'P0001';
    end if;
    if new.unit_price is null and exists (select 1 from public.pricing_lines where selected_quote_line_id = old.id) then
      raise exception 'PRICING_QUOTE_SELECTED' using errcode = 'P0001';
    end if;
  end if;
  new.offered_description := nullif(btrim(new.offered_description), '');
  new.brand := nullif(btrim(new.brand), '');
  new.model_no := nullif(btrim(new.model_no), '');
  new.notes := nullif(btrim(new.notes), '');
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists supplier_quote_lines_guard on public.supplier_quote_lines;
create trigger supplier_quote_lines_guard before insert or update or delete on public.supplier_quote_lines
  for each row execute function public.supplier_quote_lines_guard();

create or replace function public.pricing_settings_touch()
returns trigger
language plpgsql
as $$
begin
  if new.workspace_id is distinct from old.workspace_id then
    raise exception 'PRICING_LOCKED' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists pricing_settings_touch on public.pricing_settings;
create trigger pricing_settings_touch before update on public.pricing_settings
  for each row execute function public.pricing_settings_touch();

-- ── The history ──
create or replace function public.pricing_audit_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare r jsonb; sheet uuid;
begin
  r := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  -- Deleting a whole company deletes its history with it, not into it.
  if public.crm_company_gone((r->>'workspace_id')::uuid) then
    return null;
  end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'updated_at') = (to_jsonb(old) - 'updated_at') then
    return null;
  end if;
  sheet := case tg_table_name
    when 'pricing_sheets' then (r->>'id')::uuid
    when 'pricing_lines' then (r->>'sheet_id')::uuid
    when 'supplier_quotes' then (r->>'sheet_id')::uuid
    when 'supplier_quote_lines' then (select q.sheet_id from public.supplier_quotes q where q.id = (r->>'quote_id')::uuid)
  end;
  insert into public.pricing_audit (workspace_id, table_name, row_id, sheet_id, action, changed_by, old_data, new_data)
  values ((r->>'workspace_id')::uuid, tg_table_name, coalesce(r->>'id', r->>'workspace_id'), sheet, lower(tg_op), auth.uid(),
          case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['pricing_settings', 'pricing_sheets', 'pricing_lines', 'supplier_quotes', 'supplier_quote_lines'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.pricing_audit_row()', t || '_audit', t);
  end loop;
end $$;

-- ── Transitions: the only way a sheet's status changes ──
-- Each checks the caller's section grant itself (the function owns the rights,
-- the guard owns the rules).
create or replace function public.pricing_sheet_move(p_sheet uuid, p_to text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.pricing_sheets;
  need text;
begin
  select * into s from public.pricing_sheets where id = p_sheet for update;
  if not found or not public.has_section(s.workspace_id, 'pricing', 'view') then
    raise exception 'PRICING_NOT_FOUND' using errcode = 'P0001';
  end if;
  -- submit / return: work (his pricing.manage); approve: manage (pricing.approve);
  -- cancel: a draft by its preparer (work), a submitted or approved sheet by an approver (manage).
  need := case when p_to = 'approved' then 'manage'
               when p_to = 'cancelled' and s.status <> 'draft' then 'manage'
               else 'work' end;
  if not public.has_section(s.workspace_id, 'pricing', need) then
    raise exception 'PRICING_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  if p_to = 'submitted' then
    if s.status <> 'draft' then raise exception 'PRICING_TRANSITION' using errcode = 'P0001'; end if;
    update public.pricing_sheets set status = 'submitted', submitted_at = now(), submitted_by = auth.uid() where id = s.id;
  elsif p_to = 'draft' then
    if s.status <> 'submitted' then raise exception 'PRICING_TRANSITION' using errcode = 'P0001'; end if;
    update public.pricing_sheets set status = 'draft' where id = s.id;
  elsif p_to = 'approved' then
    if s.status <> 'submitted' then raise exception 'PRICING_TRANSITION' using errcode = 'P0001'; end if;
    update public.pricing_sheets set status = 'approved', approved_at = now(), approved_by = auth.uid() where id = s.id;
  elsif p_to = 'cancelled' then
    if s.status = 'cancelled' then raise exception 'PRICING_LOCKED' using errcode = 'P0001'; end if;
    if length(btrim(coalesce(p_reason, ''))) = 0 then raise exception 'PRICING_REASON' using errcode = 'P0001'; end if;
    update public.pricing_sheets set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = btrim(p_reason) where id = s.id;
  else
    raise exception 'PRICING_TRANSITION' using errcode = 'P0001';
  end if;
end $$;
revoke all on function public.pricing_sheet_move(uuid, text, text) from public, anon, authenticated;

create or replace function public.pricing_sheet_submit(p_sheet uuid) returns void language sql security definer set search_path = public
as $$ select public.pricing_sheet_move(p_sheet, 'submitted'); $$;
create or replace function public.pricing_sheet_return(p_sheet uuid) returns void language sql security definer set search_path = public
as $$ select public.pricing_sheet_move(p_sheet, 'draft'); $$;
create or replace function public.pricing_sheet_approve(p_sheet uuid) returns void language sql security definer set search_path = public
as $$ select public.pricing_sheet_move(p_sheet, 'approved'); $$;
create or replace function public.pricing_sheet_cancel(p_sheet uuid, p_reason text) returns void language sql security definer set search_path = public
as $$ select public.pricing_sheet_move(p_sheet, 'cancelled', p_reason); $$;

revoke all on function public.pricing_sheet_submit(uuid), public.pricing_sheet_return(uuid), public.pricing_sheet_approve(uuid),
  public.pricing_sheet_cancel(uuid, text) from public, anon;
grant execute on function public.pricing_sheet_submit(uuid), public.pricing_sheet_return(uuid), public.pricing_sheet_approve(uuid),
  public.pricing_sheet_cancel(uuid, text) to authenticated;
