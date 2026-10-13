-- ─── Automatic groups: a person's hand edit wins (2026-10-12) ──────────────
-- The "Previously contacted …" groups are filled by the lead agent
-- (20261016). The owner's rule for editing them by hand: the person wins.
--   removed by hand   remembered in email_group_exclusions; the agent never
--                     puts them back
--   added by hand     stays, even with no enquiry; the agent never takes out
--                     a membership it did not make
--   added back by hand  clears the exclusion
-- So each membership says who made it (added_by), and each automatic group
-- says so (managed_by), which the app shows as "Automatic".
--
-- A trigger on email_group_members records the hand edits. It ignores the
-- agent's own writes (the arak.lead_sync setting, on while
-- sync_lead_contact runs) and cascades (a deleted contact or group, whose
-- row is already gone), so only a person's add or remove counts.
--
-- Run ONCE, after 20261016. Idempotent.

alter table public.email_groups add column if not exists managed_by text not null default ''
  check (managed_by in ('', 'lead_agent'));
alter table public.email_group_members add column if not exists added_by text not null default 'person'
  check (added_by in ('person', 'lead_agent'));

create table if not exists public.email_group_exclusions (
  group_id      uuid not null,
  contact_id    uuid not null,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  excluded_at   timestamptz not null default now(),
  primary key (group_id, contact_id),
  foreign key (group_id, workspace_id) references public.email_groups (id, workspace_id) on delete cascade,
  foreign key (contact_id, workspace_id) references public.email_contacts (id, workspace_id) on delete cascade
);
create index if not exists email_group_exclusions_contact_idx on public.email_group_exclusions (contact_id);
alter table public.email_group_exclusions enable row level security;
drop policy if exists email_group_exclusions_member on public.email_group_exclusions;
create policy email_group_exclusions_member on public.email_group_exclusions
  for select to authenticated using (public.is_workspace_member(workspace_id));

-- The groups and memberships the agent made before this migration.
update public.email_groups g set managed_by = 'lead_agent'
  where managed_by = '' and audience = 'marketing' and exists (
    select 1 from public.lead_mailboxes m where m.workspace_id = g.workspace_id and lower(m.contact_group) = lower(g.name)
    union all
    select 1 from public.lead_agent_settings s where s.workspace_id = g.workspace_id and lower(s.website_contact_group) = lower(g.name));
update public.email_group_members m set added_by = 'lead_agent'
  from public.email_groups g where g.id = m.group_id and g.managed_by = 'lead_agent' and m.added_by = 'person';

-- ─── The agent's sum, now respecting hand edits ────────────────────────────
-- Same as 20261016, plus: a group the person was removed from by hand is
-- not wanted; the agent's rows say added_by 'lead_agent' and only those are
-- ever removed; a group it makes is managed_by 'lead_agent'.
create or replace function public.sync_lead_contact_run(p_workspace uuid, p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare
  e        text := lower(btrim(coalesce(p_email, '')));
  managed  text[];
  wanted   text[] := '{}';
  latest   public.leads%rowtype;
  c        public.email_contacts%rowtype;
  first    text;
  g        text;
  gid      uuid;
begin
  if p_workspace is null or e !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then return; end if;

  select coalesce(array_agg(distinct t.name), '{}') into managed from (
    select contact_group as name from lead_mailboxes where workspace_id = p_workspace and contact_group <> ''
    union select website_contact_group from lead_agent_settings where workspace_id = p_workspace and website_contact_group <> ''
  ) t;
  if cardinality(managed) = 0 then return; end if;

  if split_part(e, '@', 2) not in (
    select lower(split_part(email, '@', 2)) from lead_mailboxes where workspace_id = p_workspace
    union select lower(split_part(label, '@', 2)) from lead_mailboxes where workspace_id = p_workspace and label like '%@%'
    union select lower(split_part(email, '@', 2)) from email_mailboxes where workspace_id = p_workspace
  ) then
    with own as (
      select x.source, coalesce(x.received_at, x.created_at) as at,
             case when coalesce(x.human_verdict, x.verdict) = 'duplicate'
                  then (select coalesce(o.human_verdict, o.verdict) from leads o where o.id = x.duplicate_of)
                  else coalesce(x.human_verdict, x.verdict) end as verdict,
             case when x.source = 'website_form' then coalesce(s.website_contact_group, '')
                  else coalesce((select m.contact_group from lead_mailboxes m
                                  where m.workspace_id = x.workspace_id and x.mailbox <> '' and x.mailbox in (m.email, m.label)
                                  limit 1), '') end as grp,
             s.website_consent_since as since
      from leads x
      left join lead_agent_settings s on s.workspace_id = x.workspace_id
      where x.workspace_id = p_workspace and lower(btrim(x.email)) = e
    )
    select coalesce(array_agg(distinct grp), '{}') into wanted from own
    where verdict in ('qualified', 'needs_review') and grp <> ''
      and (source <> 'website_form' or since is null or at < since
           or exists (select 1 from email_contacts ct where ct.workspace_id = p_workspace and ct.email = e and ct.consent = 'opted_in'));
  end if;

  select * into c from email_contacts where workspace_id = p_workspace and email = e;

  -- Taken out of a group by hand: the agent leaves it that way.
  if c.id is not null then
    select coalesce(array_agg(w), '{}') into wanted from unnest(wanted) w
    where not exists (
      select 1 from email_group_exclusions x join email_groups gr on gr.id = x.group_id
      where x.contact_id = c.id and lower(gr.name) = lower(w));
  end if;

  if cardinality(wanted) > 0 then
    if c.id is null then
      select * into latest from leads
        where workspace_id = p_workspace and lower(btrim(email)) = e
        order by coalesce(received_at, created_at) desc limit 1;
      first := split_part(btrim(latest.name), ' ', 1);
      insert into email_contacts (workspace_id, email, first_name, last_name, company, phone, language,
                                  audience, consent, status, source, notes)
      values (p_workspace, e, left(first, 100), left(btrim(substr(btrim(latest.name), length(first) + 1)), 100),
              left(latest.company, 200), left(latest.phone, 50), latest.language,
              'marketing', 'business_contact', 'active', 'enquiry',
              left('Contacted us ' || to_char(coalesce(latest.received_at, latest.created_at) at time zone 'Asia/Riyadh', 'YYYY-MM-DD')
                   || case when latest.source = 'website_form' then ' from the website' else ' at ' || latest.mailbox end, 300))
      on conflict (workspace_id, email) do nothing;
      select * into c from email_contacts where workspace_id = p_workspace and email = e;
    elsif c.status = 'active' and c.audience = 'cold' then
      update email_contacts set audience = 'marketing',
             consent = case when consent = 'none' then 'business_contact' else consent end, updated_at = now()
        where id = c.id;
      update email_sends set status = 'cancelled', error = 'Contacted us with an enquiry', updated_at = now()
        where contact_id = c.id and workspace_id = p_workspace and status = 'queued';
      delete from email_group_members
        where contact_id = c.id and workspace_id = p_workspace
          and group_id in (select id from email_groups where workspace_id = p_workspace and audience = 'cold');
    end if;
  end if;
  if c.id is null then return; end if;

  foreach g in array managed loop
    select id into gid from email_groups where workspace_id = p_workspace and lower(name) = lower(g) and audience = 'marketing';
    if g = any(wanted) then
      continue when c.status <> 'active';
      if gid is null then
        insert into email_groups (workspace_id, name, audience, description, managed_by)
        values (p_workspace, g, 'marketing', 'Asked us for a quote, a product or a project. The lead agent adds and removes people by its verdict.', 'lead_agent')
        on conflict do nothing;
        select id into gid from email_groups where workspace_id = p_workspace and lower(name) = lower(g) and audience = 'marketing';
      end if;
      if gid is not null then
        insert into email_group_members (group_id, contact_id, workspace_id, added_by) values (gid, c.id, p_workspace, 'lead_agent')
        on conflict do nothing;
      end if;
    elsif gid is not null then
      -- Only what the agent itself put there; a person's addition stays.
      delete from email_group_members where group_id = gid and contact_id = c.id and added_by = 'lead_agent';
    end if;
  end loop;
end $$;

-- The entry point keeps its name (the trigger, websiteSignup's rpc and
-- sync_lead_contacts_all call it). It marks its writes as the agent's, so
-- the hand-edit trigger below does not take them for a person's.
create or replace function public.sync_lead_contact(p_workspace uuid, p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare prev text := coalesce(current_setting('arak.lead_sync', true), '');
begin
  perform set_config('arak.lead_sync', 'on', true);
  perform sync_lead_contact_run(p_workspace, p_email);
  perform set_config('arak.lead_sync', prev, true);
end $$;

create or replace function public.email_group_members_hand_edit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('arak.lead_sync', true), '') = 'on' then return null; end if;
  if tg_op = 'DELETE' then
    -- A cascade (the contact or the group itself deleted) is not a hand
    -- removal: by now its parent row is gone.
    if exists (select 1 from email_groups g where g.id = old.group_id and g.managed_by <> '')
       and exists (select 1 from email_contacts c where c.id = old.contact_id) then
      insert into email_group_exclusions (group_id, contact_id, workspace_id)
      values (old.group_id, old.contact_id, old.workspace_id) on conflict do nothing;
    end if;
  else
    delete from email_group_exclusions where group_id = new.group_id and contact_id = new.contact_id;
  end if;
  return null;
end $$;

drop trigger if exists email_group_members_hand_edit on public.email_group_members;
create trigger email_group_members_hand_edit
  after insert or delete on public.email_group_members
  for each row execute function public.email_group_members_hand_edit();

revoke all on function public.sync_lead_contact_run(uuid, text) from public, anon, authenticated;
revoke all on function public.sync_lead_contact(uuid, text) from public, anon, authenticated;
revoke all on function public.email_group_members_hand_edit() from public, anon, authenticated;
grant execute on function public.sync_lead_contact(uuid, text) to service_role;
