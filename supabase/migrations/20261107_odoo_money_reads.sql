-- ─── Finance's Odoo reads, done in the database (v2, 2026-10-25) ───────────
-- Finance and Technical read every invoice and every analytic line into the
-- browser, a thousand rows a request. On Arak's real Odoo that is 23,562
-- invoices and 56,230 analytic lines: ~25 MB, and each request slower than
-- the last (offset paging under a per-row policy: 0.15 s for the first
-- thousand, 5.9 s at forty thousand). The pages never finished loading.
--
-- What Finance's math (src/lib/finance/finance.js) actually uses:
--   · posted invoices still unpaid, those dated this month, and those whose
--     origin names a project's sales order (about 900 rows);
--   · per analytic account, the income and the cost (a sum, not the lines).
-- These two functions return exactly that. The money is visible to a whole
-- company or not at all (odoo_record_visible: CEO or Finance), so the check
-- is made once, here, and not once per row.

create or replace function public.odoo_finance_moves(ws uuid, month_start text, origins text[] default '{}')
returns setof jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_any_section(ws, '{ceo,finance}') then return; end if;
  return query
    select r.data from public.odoo_records r
    where r.workspace_id = ws and r.model = 'account.move' and r.data->>'state' = 'posted'
      and (
        (jsonb_typeof(r.data->'amount_residual') = 'number' and (r.data->>'amount_residual')::numeric > 0)
        or coalesce(r.data->>'invoice_date', '') >= month_start
        or exists (select 1 from unnest(origins) o where o <> '' and position(o in coalesce(r.data->>'invoice_origin', '')) > 0)
      )
    order by r.odoo_id;
end;
$$;

create or replace function public.odoo_analytic_totals(ws uuid)
returns table (account_id integer, income numeric, cost numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_any_section(ws, '{ceo,finance}') then return; end if;
  return query
    select (r.data->'account_id'->>0)::integer,
           sum(greatest(a.amt, 0)), sum(greatest(-a.amt, 0))
    from public.odoo_records r
    cross join lateral (select case when jsonb_typeof(r.data->'amount') = 'number' then (r.data->>'amount')::numeric else 0 end as amt) a
    where r.workspace_id = ws and r.model = 'account.analytic.line'
      and jsonb_typeof(r.data->'account_id') = 'array'
    group by 1
    order by 1;
end;
$$;

revoke all on function public.odoo_finance_moves(uuid, text, text[]) from public, anon;
revoke all on function public.odoo_analytic_totals(uuid) from public, anon;
grant execute on function public.odoo_finance_moves(uuid, text, text[]) to authenticated;
grant execute on function public.odoo_analytic_totals(uuid) to authenticated;
