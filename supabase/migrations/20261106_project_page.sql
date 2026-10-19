-- ─── v2: the project page as the CEO specified it ──────────────────────────
-- 2026-10-19. His requirement 12 lists ten fields per project and 13 a
-- planned date per stage. The mirror now also reads Odoo's project
-- milestones (a stage's planned date) and the files on projects and their
-- tasks (names and links, never the files). This file:
--
--   · lets each be read by those who may see its project, as tasks are;
--   · adds the project manager's expected delivery date to the weekly
--     update (planned = Odoo's date; expected = the PM's word that week).
--
-- v2 ONLY: the local v2 database (dev/v2db). Safe to re-run.

alter table public.project_updates add column if not exists expected_delivery date;

create or replace function public.odoo_record_visible(ws uuid, mdl text, oid integer, d jsonb)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when mdl in ('crm.stage', 'crm.lead') then public.has_any_section(ws, '{ceo,sales}')
    when mdl = 'sale.order' then public.has_any_section(ws, '{ceo,sales,finance}')
    when mdl in ('account.move', 'account.payment', 'account.analytic.line') then public.has_any_section(ws, '{ceo,finance}')
    when mdl = 'project.project' then public.has_any_section(ws, '{ceo,finance}') or public.can_see_project(ws, oid)
    when mdl = 'project.project.stage' then public.has_any_section(ws, '{ceo,finance,technical}')
    when mdl in ('project.task', 'project.update', 'project.milestone') then
      jsonb_typeof(d->'project_id') = 'array' and public.can_see_project(ws, (d->'project_id'->>0)::int)
    when mdl = 'ir.attachment' then
      case d->>'res_model'
        when 'project.project' then public.can_see_project(ws, (d->>'res_id')::int)
        when 'project.task' then exists (
          select 1 from public.odoo_records t
           where t.workspace_id = ws and t.model = 'project.task' and t.odoo_id = (d->>'res_id')::int
             and jsonb_typeof(t.data->'project_id') = 'array'
             and public.can_see_project(ws, (t.data->'project_id'->>0)::int))
        else false
      end
    when mdl = 'res.users' then public.has_any_section(ws, '{ceo,sales,technical,finance}')
    else public.has_section(ws, 'ceo', 'view')
  end;
$$;
