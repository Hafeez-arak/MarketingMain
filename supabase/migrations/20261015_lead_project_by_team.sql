-- ─── The team sets JIH / Tender / Maintenance (2026-10-12) ─────────────────
-- The owner: the team should be able to set the project phase themselves,
-- whether the email stated one or not. The agent's reading (project_type,
-- '' when not stated) stays as it was read; the team's choice sits beside it
-- and wins everywhere: the list and its filter, the workbook, Odoo.
--   null           follow the agent
--   jih/tender/maintenance  the team's phase
--   none           the team says there is no phase (the agent was wrong)

alter table public.leads add column if not exists human_project_type text
  check (human_project_type in ('jih', 'tender', 'maintenance', 'none'));
alter table public.leads add column if not exists project_set_by uuid references auth.users(id) on delete set null;
alter table public.leads add column if not exists project_set_at timestamptz;

-- What everything reads and filters on: '' means not stated.
alter table public.leads add column if not exists project_final text
  generated always as (
    case
      when human_project_type is null then coalesce(project_type, '')
      when human_project_type = 'none' then ''
      else human_project_type
    end
  ) stored;
