-- ─── A salesperson loses access: their open leads come back (2026-10-19) ───
-- The owner: removing someone's access unassigns their open leads, for the
-- sales admin to give out again. Before this, revoking a person deleted their
-- seat and left their leads assigned to no one who could see them.
--
-- On the seat itself, so every way a seat goes is covered: access revoked,
-- the company taken off them, their role changed. Each lead keeps its stage,
-- battle card, next step and notes; only the owner (and the forward of the
-- email, which was theirs) is cleared. Won and Lost stay with the person who
-- handled them, so the record of who won what stays true. Every sales admin
-- on the company gets one notification saying how many came back.
--
-- Odoo is not changed here: a lead already there keeps its old salesperson
-- until it is reassigned in the app.

create or replace function public.unassign_on_seat_removed() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  n integer;
  who text;
begin
  update public.leads
     set assigned_to = null, assigned_at = null, assigned_by = null,
         forward_status = null, forward_to = '', forward_error = '', forwarded_at = null,
         updated_at = now()
   where workspace_id = old.workspace_id
     and assigned_to = old.user_id
     and coalesce(stage, '') not in ('won', 'lost');
  get diagnostics n = row_count;
  if n > 0 then
    select coalesce(nullif(full_name, ''), email) into who from public.user_access where user_id = old.user_id;
    insert into public.notifications (user_id, workspace_id, kind, title, body, link)
    select ua.user_id, old.workspace_id, 'lead',
           n || case when n = 1 then ' lead is' else ' leads are' end || ' unassigned: ' || coalesce(who, 'a salesperson') || ' no longer has access',
           'They keep their stage and battle card. Give them to someone in the Pipeline (Owner: Unassigned).',
           '/leads?view=pipeline'
      from public.sales_seats s join public.user_access ua on ua.user_id = s.user_id
     where s.workspace_id = old.workspace_id and s.user_id <> old.user_id
       and ua.leads_approver and ua.status = 'approved';
  end if;
  return null;
end $$;

drop trigger if exists unassign_on_seat_removed on public.sales_seats;
create trigger unassign_on_seat_removed
  after delete on public.sales_seats
  for each row execute function public.unassign_on_seat_removed();

revoke all on function public.unassign_on_seat_removed() from public, anon, authenticated;
