-- ─── Everyone who asked us about our products → a marketing group (2026-10-12)
-- The owner: someone who wrote to us asking for a quote, a product or a
-- project may get our marketing email, so each real enquirer joins a
-- marketing group by itself. For Arak:
--   info@arak-sa.com + the website form  →  "Previously contacted Arak"
--   info@clb-sa.com                       →  "Previously contacted CLB"
-- Which group is DATA: lead_mailboxes.contact_group for each mailbox the
-- lead agent reads, lead_agent_settings.website_contact_group for the
-- website form. '' = that source feeds no group.
--
-- Who joins: a lead whose verdict (the team's, else the agent's) is
-- qualified or needs_review; a duplicate follows the lead it repeats. Job
-- seekers, vendors, agencies and spam never join. A verdict changed later
-- (the team says "unqualified") takes them out again, unless another of
-- their enquiries still counts. Leaving a group never deletes the contact.
--
-- The website form has carried a "send me marketing email" box since
-- lead_agent_settings.website_consent_since. After that moment a website
-- enquiry joins only if the box was ticked, which websiteSignup records as
-- an opted-in contact; an unticked box is a "no". Enquiries from before the
-- box existed count like an email.
--
-- Never: an unsubscribed, bounced or spam-reporting contact is left exactly
-- as it is, and our own addresses (any connected mailbox's domain) are
-- skipped. A cold prospect who writes in moves to marketing and their
-- queued outreach stops, as a reply does (api/email/_engine.js,
-- moveToMarketing).
--
-- A trigger on leads runs it, so every path that sets a verdict (mail and
-- website intake, the team's review, Odoo approval, the workbook's Decision
-- column, a hand-run SQL fix) keeps the groups right. Both functions are
-- SECURITY DEFINER and callable by the service role only.
--
-- Run ONCE. Idempotent.

alter table public.lead_mailboxes add column if not exists contact_group text not null default '';
alter table public.lead_agent_settings add column if not exists website_contact_group text not null default '';
alter table public.lead_agent_settings add column if not exists website_consent_since timestamptz;

-- 'enquiry' = added because they contacted us (src/lib/email/contacts.js SOURCES).
alter table public.email_contacts drop constraint if exists email_contacts_source_check;
alter table public.email_contacts add constraint email_contacts_source_check
  check (source in ('manual','import','website','event','research','reply','enquiry','other'));

create or replace function public.sync_lead_contact(p_workspace uuid, p_email text)
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

  -- Every group a lead can feed in this workspace.
  select coalesce(array_agg(distinct t.name), '{}') into managed from (
    select contact_group as name from lead_mailboxes where workspace_id = p_workspace and contact_group <> ''
    union select website_contact_group from lead_agent_settings where workspace_id = p_workspace and website_contact_group <> ''
  ) t;
  if cardinality(managed) = 0 then return; end if;

  -- Our own addresses never join; anything else is decided by its leads.
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
      -- Unsubscribed, bounced or marked spam: left exactly as it is.
      continue when c.status <> 'active';
      if gid is null then
        insert into email_groups (workspace_id, name, audience, description)
        values (p_workspace, g, 'marketing', 'Asked us for a quote, a product or a project. The lead agent adds and removes people by its verdict.')
        on conflict do nothing;
        -- A cold group already holding the name: nobody joins it from here.
        select id into gid from email_groups where workspace_id = p_workspace and lower(name) = lower(g) and audience = 'marketing';
      end if;
      if gid is not null then
        insert into email_group_members (group_id, contact_id, workspace_id) values (gid, c.id, p_workspace)
        on conflict do nothing;
      end if;
    elsif gid is not null then
      delete from email_group_members where group_id = gid and contact_id = c.id;
    end if;
  end loop;
end $$;

-- Every enquirer of one workspace again: after setting contact_group on a
-- mailbox, or to repair. Returns how many addresses it looked at.
create or replace function public.sync_lead_contacts_all(p_workspace uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0; e text;
begin
  for e in select distinct lower(btrim(email)) from leads where workspace_id = p_workspace and btrim(email) <> '' loop
    perform sync_lead_contact(p_workspace, e);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.leads_sync_contact() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform sync_lead_contact(old.workspace_id, old.email);
    return null;
  end if;
  if tg_op = 'UPDATE' and old.email is distinct from new.email then
    perform sync_lead_contact(old.workspace_id, old.email);
  end if;
  perform sync_lead_contact(new.workspace_id, new.email);
  -- A duplicate from another address follows this lead's verdict.
  perform sync_lead_contact(d.workspace_id, d.email) from leads d
    where d.duplicate_of = new.id and lower(btrim(d.email)) <> lower(btrim(new.email));
  return null;
end $$;

drop trigger if exists leads_sync_contact on public.leads;
create trigger leads_sync_contact
  after insert or delete or update of verdict, human_verdict, email, duplicate_of on public.leads
  for each row execute function public.leads_sync_contact();

revoke all on function public.sync_lead_contact(uuid, text) from public, anon, authenticated;
revoke all on function public.sync_lead_contacts_all(uuid) from public, anon, authenticated;
revoke all on function public.leads_sync_contact() from public, anon, authenticated;
grant execute on function public.sync_lead_contact(uuid, text) to service_role;
grant execute on function public.sync_lead_contacts_all(uuid) to service_role;
