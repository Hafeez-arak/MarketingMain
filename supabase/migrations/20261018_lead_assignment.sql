-- ─── Who works a lead (2026-10-13) ────────────────────────────────────────
-- The owner's decisions:
--   · A lead is assigned to one salesperson (Faisal, Khaled…), at any time.
--     Approving needs one: Odoo shows an unassigned lead to every salesperson
--     whose access is "Own Documents Only", so a lead never goes in without.
--   · Assigning forwards the customer's original email to that person, from
--     the info@ mailbox it arrived in (a real forward, attachments and all),
--     so they reply from their own mailbox.
--   · A salesperson sees only the leads assigned to them, here as in Odoo.
--     A sales admin (and the access admin) sees them all. One switch per
--     seat lets a person also see every website enquiry (Faisal, today).
--   · Only a sales admin or the access admin assigns.

-- ── 1. The owner, and the forward of the email ────────────────────────────
alter table public.leads add column if not exists assigned_to uuid references auth.users(id) on delete set null;
alter table public.leads add column if not exists assigned_at timestamptz;
alter table public.leads add column if not exists assigned_by uuid references auth.users(id) on delete set null;
-- sending: being forwarded now · sent: in their inbox · failed: forward_error says why; retry.
alter table public.leads add column if not exists forward_status text check (forward_status in ('sending', 'sent', 'failed'));
alter table public.leads add column if not exists forward_to     text not null default '';
alter table public.leads add column if not exists forward_error  text not null default '';
alter table public.leads add column if not exists forwarded_at   timestamptz;
create index if not exists leads_assigned on public.leads (workspace_id, assigned_to);

-- ── 2. Per seat: website enquiries, and who they are in Odoo ──────────────
-- odoo_login: the Odoo login when it is not their email here; empty = their
-- email. odoo_user_id: found in Odoo by that login and kept, cleared when
-- the login changes.
alter table public.sales_seats add column if not exists all_website_leads boolean not null default false;
alter table public.sales_seats add column if not exists odoo_login   text not null default '';
alter table public.sales_seats add column if not exists odoo_user_id integer;

-- ── 3. May the agent forward from this mailbox? ───────────────────────────
-- Read only until someone signs in to it again choosing "Allow forwarding"
-- (Mail.Send). Renewals ask for exactly what was granted, never more: a
-- renewal asking for a permission the mailbox never gave fails, and the
-- reading would stop with it.
alter table public.lead_mailboxes add column if not exists can_send boolean not null default false;

-- ── 4. Which leads a sales seat sees ──────────────────────────────────────
create or replace function public.can_see_lead(ws uuid, owner uuid, src text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_sales_member(ws) and (
       owner = auth.uid()
    or exists (select 1 from public.user_access ua
                where ua.user_id = auth.uid() and ua.status = 'approved' and ua.leads_approver)
    or (src = 'website_form' and exists (
          select 1 from public.sales_seats s
           where s.user_id = auth.uid() and s.workspace_id = ws and s.all_website_leads))
  );
$$;
grant execute on function public.can_see_lead(uuid, uuid, text) to authenticated;

-- ALTER, not drop + create: the policies exist (20261013_sales_seats,
-- 20261016_lead_cards), and Supabase's SQL tool refuses a DROP unless a
-- person confirms it at the moment it runs.
alter policy leads_sales_read on public.leads
  using (public.can_see_lead(workspace_id, assigned_to, source));

-- A battle card goes with its lead: readable when the lead is (the leads
-- policy answers inside the sub-select).
alter policy lead_cards_sales_read on public.lead_cards
  using (
    public.is_sales_member(workspace_id)
    and exists (select 1 from public.leads l where l.id = lead_cards.lead_id)
  );

-- ── 5. The sales team of a company, by name ───────────────────────────────
-- For the Owner column and the Assign choice. Anyone on the team (or the
-- access admin in the company) may read it: names and work addresses only.
create or replace function public.sales_team(ws_id uuid)
returns table (user_id uuid, email text, full_name text, approver boolean, all_website_leads boolean)
language sql
stable
security definer
set search_path = public
as $$
  select ua.user_id, ua.email, coalesce(ua.full_name, ''), ua.leads_approver, s.all_website_leads
    from public.sales_seats s join public.user_access ua on ua.user_id = s.user_id
   where s.workspace_id = ws_id and ua.status = 'approved' and ua.role = 'sales'
     and (public.is_sales_member(ws_id) or (public.is_access_admin() and public.is_workspace_member(ws_id)))
   order by coalesce(nullif(ua.full_name, ''), ua.email);
$$;
grant execute on function public.sales_team(uuid) to authenticated;
