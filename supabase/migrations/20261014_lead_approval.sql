-- ─── Approve a lead into Odoo, and the sales admin who may (2026-10-12) ────
-- The owner's plan: an Approve button beside every lead; it asks to confirm,
-- then the lead is pushed to Odoo CRM. Only a "sales admin" may approve (the
-- sales team has admins and others, for the leads only), plus the access
-- admin. Odoo's API key comes later, so an approved lead waits as 'queued'
-- until Odoo is connected, then goes. A lead is never pushed twice.
--
-- Also: an optional reason when a person says the agent was wrong, so the
-- weekly review can turn corrections into rules.

-- ── 1. Sales admin: a sales person who may approve ─────────────────────────
-- A flag rather than a fourth role, so every security check written on
-- role = 'sales' (has_app_access, is_sales_access, place_user_companies)
-- stays exactly as it is.
alter table public.user_access add column if not exists leads_approver boolean not null default false;

alter table public.access_invites drop constraint if exists access_invites_role_check;
alter table public.access_invites add constraint access_invites_role_check check (role in ('member', 'sales', 'sales_admin'));

-- ── 2. A lead's approval and its trip to the CRM ──────────────────────────
alter table public.leads add column if not exists human_reason text not null default '';
alter table public.leads add column if not exists approved_at  timestamptz;
alter table public.leads add column if not exists approved_by  uuid references auth.users(id) on delete set null;
-- queued: approved, Odoo not connected yet · sending: being pushed now ·
-- sent: in Odoo (crm_id, crm_url) · failed: Odoo refused (crm_error); retry.
alter table public.leads add column if not exists crm_status   text check (crm_status in ('queued', 'sending', 'sent', 'failed'));
alter table public.leads add column if not exists crm_id       text not null default '';
alter table public.leads add column if not exists crm_url      text not null default '';
alter table public.leads add column if not exists crm_error    text not null default '';
alter table public.leads add column if not exists crm_sent_at  timestamptz;
-- A person said the agent was wrong: the list's "Corrected by a person"
-- filter (PostgREST cannot compare two columns), for the weekly review.
alter table public.leads add column if not exists corrected boolean
  generated always as (human_verdict is not null and human_verdict is distinct from verdict) stored;
create index if not exists leads_crm_waiting on public.leads (workspace_id) where crm_status in ('queued', 'failed');

-- ── 3. The Odoo connection, per company ───────────────────────────────────
-- RLS on and no policy: only the server (service key) reads it, as with the
-- OpenRouter key. The API key is sealed (AES-GCM, api/email/_secrets.js).
create table if not exists public.lead_crm (
  workspace_id    uuid primary key references public.workspaces(id) on delete cascade,
  kind            text not null default 'odoo' check (kind in ('odoo')),
  url             text not null default '',
  db              text not null default '',
  login           text not null default '',
  api_key         text not null default '',
  odoo_uid        integer,
  server_version  text not null default '',
  last_checked_at timestamptz,
  last_error      text not null default '',
  updated_at      timestamptz not null default now()
);
alter table public.lead_crm enable row level security;

-- ── 4. Who may approve ────────────────────────────────────────────────────
create or replace function public.can_approve_leads(ws_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (public.is_access_admin() and public.is_workspace_member(ws_id))
      or (public.is_sales_member(ws_id) and exists (
            select 1 from public.user_access ua
             where ua.user_id = auth.uid() and ua.status = 'approved' and ua.leads_approver));
$$;
grant execute on function public.can_approve_leads(uuid) to authenticated;

-- ── 5. Adding and switching people, with the sales admin choice ───────────
-- as_role: 'member' | 'sales' | 'sales_admin'. A sales admin is stored as
-- role 'sales' with leads_approver on.
create or replace function public.invite_access(target_email text, ws_ids uuid[] default null, as_role text default 'member')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  norm    text := lower(trim(coalesce(target_email, '')));
  found   uuid;
  current_status text;
  wanted  uuid[];
  r       text := coalesce(nullif(as_role, ''), 'member');
begin
  if not public.is_access_admin() then
    raise exception 'Only the access admin can add people';
  end if;
  if r not in ('member', 'sales', 'sales_admin') then
    raise exception 'A person can be added as member, sales or sales admin';
  end if;
  if norm !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'That does not look like an email address';
  end if;

  select coalesce(array_agg(w.id), '{}'::uuid[]) into wanted
    from public.workspaces w
   where w.id = any (coalesce(ws_ids, '{}'::uuid[]));

  select u.id into found from auth.users u where lower(u.email) = norm;

  if found is null then
    insert into public.access_invites (email, invited_by, workspace_ids, role)
    values (norm, auth.uid(), wanted, r)
    on conflict (email) do update set workspace_ids = excluded.workspace_ids, role = excluded.role;
    return 'invited';
  end if;

  select ua.status into current_status from public.user_access ua where ua.user_id = found;
  if current_status = 'approved' then
    return 'already';
  end if;

  perform public.grant_access_to_user(found, auth.uid());
  update public.user_access
     set role = case when r = 'sales_admin' then 'sales' else r end,
         leads_approver = (r = 'sales_admin')
   where user_id = found and role <> 'admin';
  perform public.place_user_companies(found, wanted, false);

  return 'approved';
end;
$$;
grant execute on function public.invite_access(text, uuid[], text) to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invited_to  uuid[];
  invited_as  text;
  pre_cleared boolean;
begin
  select i.workspace_ids, i.role into invited_to, invited_as
    from public.access_invites i where i.email = lower(new.email);
  -- Copied out at once: FOUND is overwritten by the insert just below.
  pre_cleared := found;

  insert into public.user_access (user_id, email, full_name, status, role, leads_approver, decided_at)
  values (
    new.id,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), ''),
    case when pre_cleared then 'approved' else 'pending' end,
    case when pre_cleared and invited_as in ('sales', 'sales_admin') then 'sales' else 'member' end,
    pre_cleared and invited_as = 'sales_admin',
    case when pre_cleared then now() else null end
  )
  on conflict (user_id) do nothing;

  if pre_cleared then
    perform public.place_user_companies(new.id, invited_to, false);
    delete from public.access_invites where email = lower(new.email);
  end if;

  return new;
end;
$$;

create or replace function public.set_user_role(target_user uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  held uuid[];
begin
  if not public.is_access_admin() then
    raise exception 'Only the access admin can change roles';
  end if;
  if new_role not in ('member', 'sales', 'sales_admin') then
    raise exception 'A person can be member, sales or sales admin';
  end if;
  if exists (select 1 from public.user_access where user_id = target_user and role = 'admin') then
    raise exception 'The access admin''s role does not change';
  end if;
  select coalesce(array_agg(ws), '{}'::uuid[]) into held from (
    select workspace_id as ws from public.workspace_members where user_id = target_user
    union select workspace_id from public.sales_seats where user_id = target_user
  ) h;
  update public.user_access
     set role = case when new_role = 'sales_admin' then 'sales' else new_role end,
         leads_approver = (new_role = 'sales_admin')
   where user_id = target_user;
  perform public.place_user_companies(target_user, held, true);
end;
$$;
grant execute on function public.set_user_role(uuid, text) to authenticated;
