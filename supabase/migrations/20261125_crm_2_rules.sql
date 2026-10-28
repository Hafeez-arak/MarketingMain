-- ─── v2: CRM, the rules ────────────────────────────────────────────────────
-- 2026-10-28, after 20261125_crm_1_tables.sql. Musa's CRM rules, in the
-- database so every screen (and anything written later) meets the same ones:
--
--   · an opportunity starts open; won is final and needs a client; lost
--     needs an active reason and changes only by being reopened;
--   · the number (L-2026-000001, gap-free per company and year) and the
--     creator never change;
--   · only an active stage, source, loss reason or tag is given anew;
--   · whoever it is assigned to has the CRM in this company;
--   · no new opportunity for an archived client; linking an organisation
--     makes it a client (one record, several roles: Contacts);
--   · a done activity is history; nothing new is planned on a closed one;
--     a closed opportunity's tags stay as they were;
--   · only an open opportunity without done activities is deleted;
--   · every change to an opportunity and its activities is in crm_history.
--
-- A refusal is an exception whose message is a code (CRM_…) and whose detail
-- is the data the screen needs; lib/crm/client.js turns it into words.
-- The functions run as the caller (security invoker), so RLS applies to
-- everything they read and write, except the four marked security definer
-- (numbering, history, the people and clients pickers, the client role).
--
-- v2 ONLY: the local v2 database (dev/v2db). Safe to re-run.

-- ── Helpers ──

-- Today in Riyadh: the company's day, whatever the server's clock zone.
create or replace function public.crm_today()
returns date
language sql
stable
as $$
  select (now() at time zone 'Asia/Riyadh')::date;
$$;
grant execute on function public.crm_today() to authenticated;

-- Is the company being deleted? (Settings → Delete company cascades through
-- every table; the rules below step aside for it.)
create or replace function public.crm_company_gone(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from public.workspaces w where w.id = ws);
$$;
revoke all on function public.crm_company_gone(uuid) from public, anon;
grant execute on function public.crm_company_gone(uuid) to authenticated;

-- Someone an opportunity or activity can be given to: an approved login of
-- this company with the CRM (his "member of the company"), or the access
-- admin who belongs to it.
create or replace function public.crm_member(ws uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_access ua
      join public.workspace_members m on m.user_id = ua.user_id and m.workspace_id = ws
     where ua.user_id = uid and ua.status = 'approved'
       and (ua.role = 'admin'
            or exists (select 1 from public.section_access a where a.workspace_id = ws and a.user_id = uid and a.section = 'crm')));
$$;
revoke all on function public.crm_member(uuid, uuid) from public, anon;
grant execute on function public.crm_member(uuid, uuid) to authenticated;

/** The people of the pickers (assignee), for anyone who reads the CRM. */
create or replace function public.crm_people(ws uuid)
returns table (user_id uuid, name text)
language sql
stable
security definer
set search_path = public
as $$
  select ua.user_id, coalesce(nullif(btrim(ua.full_name), ''), split_part(ua.email, '@', 1))
    from public.user_access ua
   where public.has_section(ws, 'crm', 'view')
     and public.crm_member(ws, ua.user_id)
   order by 2;
$$;
revoke all on function public.crm_people(uuid) from public, anon;
grant execute on function public.crm_people(uuid) to authenticated;

/**
 * The company's organisations as the CRM sees them: enough to pick a client
 * and to name it on an opportunity, for people who have the CRM but not
 * Contacts (his client picker and client name need no clients permission).
 */
create or replace function public.crm_clients(ws uuid)
returns table (id uuid, contact_no text, name text, name_ar text, status text, is_client boolean,
               phone text, email text, city text)
language sql
stable
security definer
set search_path = public
as $$
  select o.id, o.contact_no, o.name, o.name_ar, o.status, 'client' = any(o.roles), o.phone, o.email, o.city
    from public.contacts_orgs o
   where o.workspace_id = ws and public.has_section(ws, 'crm', 'view')
   order by o.name;
$$;
revoke all on function public.crm_clients(uuid) from public, anon;
grant execute on function public.crm_clients(uuid) to authenticated;

/**
 * Is this organisation one the company still deals with? Contacts'
 * contacts_org_is_active() runs as the caller, so for someone with the CRM
 * but not Contacts it would always say no; this one reads past Contacts'
 * RLS and says only active or not (the composite key keeps it to the
 * opportunity's own company).
 */
create or replace function public.crm_org_active(org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.contacts_orgs o where o.id = org and o.status = 'active');
$$;
revoke all on function public.crm_org_active(uuid) from public, anon;
grant execute on function public.crm_org_active(uuid) to authenticated;

/**
 * An organisation linked to an opportunity is a client: Contacts keeps one
 * record with several roles, so linking a consultant firm adds the role
 * instead of making a second record. Only for someone who works the CRM
 * of that organisation's company.
 */
create or replace function public.crm_mark_client(org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ws uuid;
begin
  select o.workspace_id into ws from public.contacts_orgs o where o.id = org;
  if ws is null or not public.has_section(ws, 'crm', 'work') then
    return;
  end if;
  update public.contacts_orgs o set roles = o.roles || array['client']
   where o.id = org and not ('client' = any(o.roles));
end;
$$;
revoke all on function public.crm_mark_client(uuid) from public, anon;
grant execute on function public.crm_mark_client(uuid) to authenticated;

-- ── The company's lists: tidy, and never moved to another company ──
create or replace function public.crm_lists_tidy()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.name := btrim(new.name);
  new.name_en := nullif(btrim(new.name_en), '');
  if tg_op = 'UPDATE' then
    if new.workspace_id <> old.workspace_id then
      raise exception 'CRM_WORKSPACE_FIXED' using errcode = 'P0001';
    end if;
    new.created_at := old.created_at;
  else
    new.created_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['crm_stages', 'crm_sources', 'crm_lost_reasons', 'crm_tags'] loop
    execute format('drop trigger if exists %1$s_tidy on public.%1$I', t);
    execute format('create trigger %1$s_tidy before insert or update on public.%1$I for each row execute function public.crm_lists_tidy()', t);
  end loop;
end $$;

-- ── Numbers: L-2026-000001, per company and year, gap-free ──
-- The counter row is updated in the same transaction as the insert, so a
-- refused insert gives its number back, and two people saving at once wait
-- for each other on the row instead of sharing a number.
create or replace function public.crm_leads_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  y integer := extract(year from public.crm_today())::integer;
  n integer;
begin
  if tg_op = 'UPDATE' then
    new.lead_no := old.lead_no;  -- a number never changes
    return new;
  end if;
  insert into public.crm_counters as c (workspace_id, year, last) values (new.workspace_id, y, 1)
  on conflict (workspace_id, year) do update set last = c.last + 1
  returning last into n;
  new.lead_no := 'L-' || y || '-' || lpad(n::text, 6, '0');
  return new;
end;
$$;
drop trigger if exists crm_leads_number on public.crm_leads;
create trigger crm_leads_number before insert or update on public.crm_leads
  for each row execute function public.crm_leads_number();

-- ── The opportunity's rules ──
create or replace function public.crm_leads_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  -- What reopening a lost opportunity may change (nothing else).
  reopen constant text[] := array['status', 'lost_reason_id', 'lost_note', 'closed_at', 'closed_by', 'updated_at'];
begin
  if tg_op = 'DELETE' then
    if public.crm_company_gone(old.workspace_id) then
      return old;
    end if;
    if old.status <> 'open' or exists (select 1 from public.crm_activities a where a.lead_id = old.id and a.done_at is not null) then
      raise exception 'CRM_LEAD_DELETE' using errcode = 'P0001';
    end if;
    return old;
  end if;

  -- Tidy text: trimmed, blanks stored as null.
  new.title         := btrim(new.title);
  new.contact_name  := nullif(btrim(new.contact_name), '');
  new.organization  := nullif(btrim(new.organization), '');
  new.phone         := nullif(btrim(new.phone), '');
  new.email         := lower(nullif(btrim(new.email), ''));
  new.city          := nullif(btrim(new.city), '');
  new.consultant    := nullif(btrim(new.consultant), '');
  new.project_owner := nullif(btrim(new.project_owner), '');
  new.tender_ref    := nullif(btrim(new.tender_ref), '');
  new.lost_note     := nullif(btrim(new.lost_note), '');
  new.notes         := nullif(btrim(new.notes), '');
  new.priority      := coalesce(new.priority, 0);

  if tg_op = 'INSERT' then
    if new.status <> 'open' then
      raise exception 'CRM_LEAD_TRANSITION' using errcode = 'P0001';
    end if;
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
    new.closed_at := null;
    new.closed_by := null;
  else
    if new.workspace_id <> old.workspace_id then
      raise exception 'CRM_WORKSPACE_FIXED' using errcode = 'P0001';
    end if;
    -- The creator never changes (the number is kept by crm_leads_number).
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if old.status = 'won' and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
      raise exception 'CRM_LEAD_WON' using errcode = 'P0001';
    end if;
    if old.status = 'lost' then
      if new.status <> 'open' or (to_jsonb(new) - reopen) is distinct from (to_jsonb(old) - reopen) then
        raise exception 'CRM_LEAD_LOST' using errcode = 'P0001';
      end if;
      -- Reopened: the loss and the closing are cleared.
      new.lost_reason_id := null;
      new.lost_note := null;
      new.closed_at := null;
      new.closed_by := null;
    elsif old.status = 'open' and new.status <> 'open' then
      -- Closed now, by whoever is signed in.
      new.closed_at := now();
      new.closed_by := auth.uid();
    end if;
  end if;

  if new.status = 'won' and new.client_org_id is null then
    raise exception 'CRM_WON_NEEDS_CLIENT' using errcode = 'P0001';
  end if;
  if new.status = 'lost' and new.lost_reason_id is null then
    raise exception 'CRM_LOST_NEEDS_REASON' using errcode = 'P0001';
  end if;

  -- Only active list items are given anew (a kept one stays where it is).
  if (tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id)
     and not exists (select 1 from public.crm_stages s where s.id = new.stage_id and s.workspace_id = new.workspace_id and s.is_active) then
    raise exception 'CRM_STAGE_INACTIVE' using errcode = 'P0001';
  end if;
  if new.source_id is not null and (tg_op = 'INSERT' or new.source_id is distinct from old.source_id)
     and not exists (select 1 from public.crm_sources s where s.id = new.source_id and s.workspace_id = new.workspace_id and s.is_active) then
    raise exception 'CRM_SOURCE_INACTIVE' using errcode = 'P0001';
  end if;
  if new.lost_reason_id is not null and (tg_op = 'INSERT' or new.lost_reason_id is distinct from old.lost_reason_id)
     and not exists (select 1 from public.crm_lost_reasons r where r.id = new.lost_reason_id and r.workspace_id = new.workspace_id and r.is_active) then
    raise exception 'CRM_REASON_INACTIVE' using errcode = 'P0001';
  end if;

  if new.assigned_to is not null and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
     and not public.crm_member(new.workspace_id, new.assigned_to) then
    raise exception 'CRM_ASSIGNEE' using errcode = 'P0001';
  end if;

  -- The client: an active organisation of this company, which becomes a client.
  if new.client_org_id is not null and (tg_op = 'INSERT' or new.client_org_id is distinct from old.client_org_id) then
    if not public.crm_org_active(new.client_org_id) then
      raise exception 'CRM_CLIENT_ARCHIVED' using errcode = 'P0001';
    end if;
    perform public.crm_mark_client(new.client_org_id);
  end if;

  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists crm_leads_guard on public.crm_leads;
create trigger crm_leads_guard before insert or update or delete on public.crm_leads
  for each row execute function public.crm_leads_guard();

-- ── Tags: active ones only, and a closed opportunity's stay as they were ──
create or replace function public.crm_lead_tags_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  rec public.crm_lead_tags := case when tg_op = 'DELETE' then old else new end;
begin
  -- Going with its opportunity, or with the company.
  if tg_op = 'DELETE' and (public.crm_company_gone(rec.workspace_id)
                           or not exists (select 1 from public.crm_leads l where l.id = rec.lead_id)) then
    return old;
  end if;
  if not exists (select 1 from public.crm_leads l where l.id = rec.lead_id and l.workspace_id = rec.workspace_id and l.status = 'open') then
    raise exception 'CRM_LEAD_CLOSED' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' and not exists (select 1 from public.crm_tags t where t.id = rec.tag_id and t.workspace_id = rec.workspace_id and t.is_active) then
    raise exception 'CRM_TAG_INACTIVE' using errcode = 'P0001';
  end if;
  return rec;
end;
$$;
drop trigger if exists crm_lead_tags_guard on public.crm_lead_tags;
create trigger crm_lead_tags_guard before insert or delete on public.crm_lead_tags
  for each row execute function public.crm_lead_tags_guard();

/**
 * Set an opportunity's tags to exactly these (his form sends the whole set).
 * Runs as the caller: RLS and the tag rules above apply to each change.
 */
create or replace function public.crm_set_tags(ws uuid, lead uuid, tag_ids uuid[])
returns void
language plpgsql
set search_path = public
as $$
begin
  delete from public.crm_lead_tags t
   where t.workspace_id = ws and t.lead_id = lead and not (t.tag_id = any(coalesce(tag_ids, '{}')));
  insert into public.crm_lead_tags (workspace_id, lead_id, tag_id)
  select ws, lead, x from unnest(coalesce(tag_ids, '{}')) as x
  on conflict do nothing;
end;
$$;
revoke all on function public.crm_set_tags(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.crm_set_tags(uuid, uuid, uuid[]) to authenticated;

-- ── Activities: a done one is history; new work only on an open opportunity ──
create or replace function public.crm_activities_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.done_at is not null and not public.crm_company_gone(old.workspace_id) then
      raise exception 'CRM_ACTIVITY_DONE' using errcode = 'P0001';
    end if;
    return old;
  end if;
  new.summary := btrim(new.summary);
  new.outcome := nullif(btrim(new.outcome), '');
  if tg_op = 'UPDATE' then
    if old.done_at is not null then
      raise exception 'CRM_ACTIVITY_DONE' using errcode = 'P0001';
    end if;
    if new.workspace_id <> old.workspace_id or new.lead_id <> old.lead_id then
      raise exception 'CRM_ACTIVITY_MOVED' using errcode = 'P0001';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  else
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
    new.done_at := null;
    new.done_by := null;
  end if;
  -- Marked done now, by whoever is signed in.
  if new.done_at is not null then
    new.done_at := now();
    new.done_by := auth.uid();
  else
    new.done_by := null;
    -- New work is planned only on an open opportunity.
    if not exists (select 1 from public.crm_leads l where l.id = new.lead_id and l.workspace_id = new.workspace_id and l.status = 'open') then
      raise exception 'CRM_LEAD_CLOSED' using errcode = 'P0001';
    end if;
  end if;
  if (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
     and not public.crm_member(new.workspace_id, new.assigned_to) then
    raise exception 'CRM_ASSIGNEE' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists crm_activities_guard on public.crm_activities;
create trigger crm_activities_guard before insert or update or delete on public.crm_activities
  for each row execute function public.crm_activities_guard();

-- ── The history: one row per change, field by field ──
create or replace function public.crm_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  rec jsonb := coalesce(n, o);
  diff jsonb := '{}'::jsonb;
  k text;
begin
  if public.crm_company_gone((rec ->> 'workspace_id')::uuid) then
    return null;
  end if;
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      if k not in ('updated_at', 'created_at', 'created_by') and (o -> k) is distinct from (n -> k) then
        diff := diff || jsonb_build_object(k, jsonb_build_array(o -> k, n -> k));
      end if;
    end loop;
    if diff = '{}'::jsonb then
      return null;
    end if;
  end if;
  insert into public.crm_history (workspace_id, lead_id, activity_id, action, label, changes, actor)
  values (
    (rec ->> 'workspace_id')::uuid,
    case when tg_table_name = 'crm_leads' then (rec ->> 'id')::uuid else (rec ->> 'lead_id')::uuid end,
    case when tg_table_name = 'crm_activities' then (rec ->> 'id')::uuid end,
    lower(tg_op),
    coalesce(case when tg_table_name = 'crm_leads' then rec ->> 'title' else rec ->> 'summary' end, ''),
    diff, auth.uid());
  return null;
end;
$$;
drop trigger if exists crm_leads_log on public.crm_leads;
create trigger crm_leads_log after insert or update or delete on public.crm_leads
  for each row execute function public.crm_log();
drop trigger if exists crm_activities_log on public.crm_activities;
create trigger crm_activities_log after insert or update or delete on public.crm_activities
  for each row execute function public.crm_log();

-- ── Settings: the suggested starting pipeline ──
/**
 * Five starting stages, names only, when the company has none yet (his
 * one-click start). The company renames, reorders or switches them off.
 */
create or replace function public.crm_suggest_stages(ws uuid)
returns integer
language plpgsql
set search_path = public
as $$
begin
  if not public.has_section(ws, 'crm', 'manage') then
    raise exception 'CRM_NEEDS_MANAGE' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.crm_stages s where s.workspace_id = ws) then
    raise exception 'CRM_STAGES_EXIST' using errcode = 'P0001';
  end if;
  insert into public.crm_stages (workspace_id, name, name_en, sequence) values
    (ws, 'جديدة', 'New', 10),
    (ws, 'مؤهلة', 'Qualified', 20),
    (ws, 'معاينة وتصميم', 'Site visit and design', 30),
    (ws, 'أُرسل عرض السعر', 'Quotation sent', 40),
    (ws, 'تفاوض', 'Negotiation', 50);
  return 5;
end;
$$;
revoke all on function public.crm_suggest_stages(uuid) from public, anon;
grant execute on function public.crm_suggest_stages(uuid) to authenticated;

/**
 * Move an open opportunity to the stage the company tied to an event of the
 * quotation cycle ('pricing', 'technical', 'financial', 'revision'). For the
 * modules that will raise those events (pricing sheets, technical offers,
 * quotations); none exists in v2 yet. Nothing happens when no active stage
 * is tied to the event, the opportunity is closed, or it is there already.
 * Returns the stage's name when it moved.
 */
create or replace function public.crm_auto_stage(lead uuid, event text)
returns text
language plpgsql
set search_path = public
as $$
declare
  l public.crm_leads;
  s public.crm_stages;
begin
  select * into l from public.crm_leads where id = lead;
  if not found or l.status <> 'open' then
    return null;
  end if;
  select * into s from public.crm_stages where workspace_id = l.workspace_id and auto_event = event and is_active;
  if not found or s.id = l.stage_id then
    return null;
  end if;
  update public.crm_leads set stage_id = s.id where id = l.id;
  return s.name;
end;
$$;
revoke all on function public.crm_auto_stage(uuid, text) from public, anon;
grant execute on function public.crm_auto_stage(uuid, text) to authenticated;
