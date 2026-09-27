-- ════════════════════════════════════════════════════════════════════════
-- Email: contacts, groups, campaigns, sends, events, settings
-- ════════════════════════════════════════════════════════════════════════
-- Replaces the placeholder Email Flows page. Two lanes share one contact book
-- and are kept apart by the `audience` column, never by convention:
--
--   marketing  people who know us (customers, sign-ups, event contacts).
--              Sent through Resend from a subdomain of the company domain.
--   cold       prospects who never opted in. NEVER sent through Resend —
--              Resend's terms forbid it and a suspension would take the
--              customer newsletter down with it. Cold sends go through a
--              separate domain and mailbox, which does not exist yet, so the
--              cold lane can be written and queued but not sent.
--
-- The server (api/email/[action].js) enforces the lane split again when it
-- picks recipients, because a hidden button is a courtesy and the query is
-- the guarantee.
--
-- Run ONCE. Idempotent: create-if-not-exists, drop-then-create policies.

create table if not exists public.email_contacts (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  -- Stored lower-cased and trimmed by the app; the unique index is what stops
  -- the same person being imported twice.
  email               text not null check (email = lower(btrim(email)) and position('@' in email) > 1),
  first_name          text not null default '',
  last_name           text not null default '',
  company             text not null default '',
  job_title           text not null default '',
  phone               text not null default '',
  city                text not null default '',
  country             text not null default '',
  -- What kind of business contact this is. Free text so a new kind needs no
  -- migration; the UI offers the common ones.
  contact_type        text not null default '',
  audience            text not null default 'marketing' check (audience in ('marketing','cold')),
  language            text not null default 'en' check (language in ('en','ar')),
  -- Why we may email them. PDPL requires a basis for direct marketing, and a
  -- recorded one is what answers "why did you email me?".
  consent             text not null default 'business_contact'
                      check (consent in ('opted_in','customer','business_contact','none')),
  status              text not null default 'active'
                      check (status in ('active','unsubscribed','bounced','complained')),
  source              text not null default 'manual'
                      check (source in ('manual','import','website','event','research','reply','other')),
  notes               text not null default '',
  -- Cold follow-ups stop the moment someone replies. Set by a person today
  -- (there is no inbox connected); by the mailbox sync once there is one.
  replied_at          timestamptz,
  -- Link to a research lead, for prospects found through the research agent.
  opportunity_id      uuid references public.research_opportunities(id) on delete set null,
  -- Opaque token in every unsubscribe link. Not the row id, so a link cannot
  -- be edited into someone else's unsubscribe.
  unsubscribe_token   uuid not null default gen_random_uuid(),
  unsubscribed_at     timestamptz,
  last_sent_at        timestamptz,
  last_opened_at      timestamptz,
  last_clicked_at     timestamptz,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists email_contacts_ws_email_idx
  on public.email_contacts (workspace_id, email);
create unique index if not exists email_contacts_unsub_token_idx
  on public.email_contacts (unsubscribe_token);
create index if not exists email_contacts_ws_created_idx
  on public.email_contacts (workspace_id, created_at desc);

create table if not exists public.email_groups (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  name          text not null check (length(btrim(name)) > 0),
  description   text not null default '',
  -- Which lane this group is for. A marketing campaign may only pick
  -- marketing groups, a cold one only cold groups — and the recipient query
  -- checks each CONTACT's audience as well, so a mis-filed person is skipped.
  audience      text not null default 'marketing' check (audience in ('marketing','cold')),
  color         text not null default 'steel',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists email_groups_ws_name_idx
  on public.email_groups (workspace_id, lower(name));

create table if not exists public.email_group_members (
  group_id      uuid not null references public.email_groups(id) on delete cascade,
  contact_id    uuid not null references public.email_contacts(id) on delete cascade,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  added_at      timestamptz not null default now(),
  primary key (group_id, contact_id)
);

-- A membership row must not join a group in one workspace to a contact in
-- another. RLS cannot see that (an operator is a member of both), so the
-- foreign keys carry the workspace too.
create unique index if not exists email_groups_id_ws_idx on public.email_groups (id, workspace_id);
create unique index if not exists email_contacts_id_ws_idx on public.email_contacts (id, workspace_id);
alter table public.email_group_members drop constraint if exists email_group_members_group_ws_fk;
alter table public.email_group_members add constraint email_group_members_group_ws_fk
  foreign key (group_id, workspace_id) references public.email_groups (id, workspace_id) on delete cascade;
alter table public.email_group_members drop constraint if exists email_group_members_contact_ws_fk;
alter table public.email_group_members add constraint email_group_members_contact_ws_fk
  foreign key (contact_id, workspace_id) references public.email_contacts (id, workspace_id) on delete cascade;

create index if not exists email_group_members_contact_idx
  on public.email_group_members (contact_id);
create index if not exists email_group_members_ws_idx
  on public.email_group_members (workspace_id);

create table if not exists public.email_campaigns (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  audience        text not null check (audience in ('marketing','cold')),
  name            text not null default '',
  subject         text not null default '',
  preheader       text not null default '',
  -- Plain text with light formatting (paragraphs, **bold**, [links](url),
  -- "- " bullets) and merge tags. Rendered to HTML at send time by
  -- src/lib/email/render.js, so what the preview shows is what goes out.
  body            text not null default '',
  -- The drag-and-drop design: { version, style, blocks[] }, rendered by
  -- src/lib/email/design.js. Null means the email is the plain `body`.
  -- `body` is kept either way: it is what the AI writes and what a plain
  -- email sends.
  design          jsonb,
  -- The language the email is WRITTEN in. It sets the layout (right-to-left
  -- for Arabic) and the footer, whatever the recipient prefers.
  language        text not null default 'en' check (language in ('en','ar')),
  -- Send only to contacts whose preferred language is `language`. Off, an
  -- Arabic-preferring contact in the group gets the English email too.
  language_only   boolean not null default false,
  group_ids       uuid[] not null default '{}',
  -- Cold only: the follow-ups after the first email.
  -- [{ "delay_days": 3, "subject": "", "body": "" }, ...]
  follow_ups      jsonb not null default '[]'::jsonb,
  status          text not null default 'draft'
                  check (status in ('draft','scheduled','sending','sent','paused','cancelled')),
  -- The day it may start. Sending happens in the morning run (about 9:00
  -- Riyadh) or immediately on "Send now".
  scheduled_for   timestamptz,
  -- Snapshot of the sender at launch, so changing Settings later does not
  -- rewrite history.
  from_name       text not null default '',
  from_email      text not null default '',
  reply_to        text not null default '',
  recipients      int not null default 0,
  launched_at     timestamptz,
  completed_at    timestamptz,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists email_campaigns_ws_idx
  on public.email_campaigns (workspace_id, created_at desc);

-- One row per recipient per step. The queue AND the record: a row is created
-- `queued` at launch and moves forward as Resend reports what happened.
create table if not exists public.email_sends (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  campaign_id     uuid not null references public.email_campaigns(id) on delete cascade,
  contact_id      uuid references public.email_contacts(id) on delete set null,
  email           text not null,
  step            int not null default 0,
  -- 'sending' is the claim: a row moves queued → sending in one conditional
  -- PATCH before it is handed to Resend, so two senders running at once (the
  -- morning run and a "Send now") can never both send it.
  status          text not null default 'queued'
                  constraint email_sends_status_check
                  check (status in ('queued','sending','sent','delivered','opened','clicked',
                                    'bounced','complained','failed','skipped','cancelled')),
  -- Not before this moment. Warm-up spreads a campaign over days by leaving
  -- rows queued; follow-ups are queued with a later due_at.
  due_at          timestamptz not null default now(),
  -- Per-recipient wording. Empty means "use the campaign's"; a cold email
  -- personalised for one prospect is stored here so the preview a person
  -- approved is exactly what is sent.
  subject         text not null default '',
  body            text not null default '',
  provider_id     text,
  error           text not null default '',
  sent_at         timestamptz,
  delivered_at    timestamptz,
  opened_at       timestamptz,
  clicked_at      timestamptz,
  bounced_at      timestamptz,
  complained_at   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists email_sends_once_idx
  on public.email_sends (campaign_id, contact_id, step);
create index if not exists email_sends_queue_idx
  on public.email_sends (workspace_id, status, due_at);
create index if not exists email_sends_provider_idx
  on public.email_sends (provider_id);
create index if not exists email_sends_ws_sent_idx
  on public.email_sends (workspace_id, sent_at desc);

-- Every webhook Resend delivered, verbatim. Analytics reads email_sends; this
-- is the audit trail for "why does it say bounced?".
create table if not exists public.email_events (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid references public.workspaces(id) on delete cascade,
  send_id       uuid references public.email_sends(id) on delete set null,
  provider_id   text,
  type          text not null,
  payload       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists email_events_ws_idx
  on public.email_events (workspace_id, created_at desc);

create table if not exists public.email_settings (
  workspace_id          uuid primary key references public.workspaces(id) on delete cascade,
  from_name             text not null default '',
  from_email            text not null default '',
  reply_to              text not null default '',
  -- Printed in every marketing footer. Anti-spam law and Gmail's bulk rules
  -- both expect a real postal address.
  company_address       text not null default '',
  -- Warm-up: the day sending started. Null means warm-up has not begun, and
  -- the first send sets it.
  warmup_started_on     date,
  warmup_enabled        boolean not null default true,
  -- The provider's own ceilings (Resend free: 100/day, 3,000/month). The
  -- daily cap is the lowest of warm-up, health and these.
  provider_daily_limit  int not null default 100 check (provider_daily_limit >= 0),
  provider_monthly_limit int not null default 3000 check (provider_monthly_limit >= 0),
  -- The cold lane, for when the separate domain and mailbox exist.
  cold_from_name        text not null default '',
  cold_from_email       text not null default '',
  cold_daily_limit      int not null default 20 check (cold_daily_limit >= 0),
  updated_at            timestamptz not null default now()
);

-- ── Per-campaign numbers ──
-- security_invoker so the view applies the caller's RLS rather than the
-- owner's. Without it a view reads every workspace's rows for anyone (see
-- 20260822_generated_posts_takes_instagram.sql for how that happened once).
drop view if exists public.email_campaign_stats;
create view public.email_campaign_stats
with (security_invoker = true) as
select
  s.campaign_id,
  s.workspace_id,
  count(*)                                                        as total,
  count(*) filter (where s.status = 'queued')                     as queued,
  count(*) filter (where s.sent_at is not null)                   as sent,
  count(*) filter (where s.delivered_at is not null)              as delivered,
  count(*) filter (where s.opened_at is not null)                 as opened,
  count(*) filter (where s.clicked_at is not null)                as clicked,
  count(*) filter (where s.bounced_at is not null)                as bounced,
  count(*) filter (where s.complained_at is not null)             as complained,
  count(*) filter (where s.status in ('failed','skipped'))        as failed
from public.email_sends s
group by s.campaign_id, s.workspace_id;

-- ── RLS ──
-- Membership, not isolation: every query in application code also carries
-- its own workspace_id filter.
alter table public.email_contacts       enable row level security;
alter table public.email_groups         enable row level security;
alter table public.email_group_members  enable row level security;
alter table public.email_campaigns      enable row level security;
alter table public.email_sends          enable row level security;
alter table public.email_events         enable row level security;
alter table public.email_settings       enable row level security;

drop policy if exists email_contacts_member on public.email_contacts;
create policy email_contacts_member on public.email_contacts
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists email_groups_member on public.email_groups;
create policy email_groups_member on public.email_groups
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists email_group_members_member on public.email_group_members;
create policy email_group_members_member on public.email_group_members
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists email_campaigns_member on public.email_campaigns;
create policy email_campaigns_member on public.email_campaigns
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- Sends and events are written only by the server (service key). People may
-- read them; pausing or cancelling happens through the campaign's status,
-- which the sender re-reads before every batch.
drop policy if exists email_sends_read on public.email_sends;
create policy email_sends_read on public.email_sends
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists email_events_read on public.email_events;
create policy email_events_read on public.email_events
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists email_settings_member on public.email_settings;
create policy email_settings_member on public.email_settings
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

notify pgrst, 'reload schema';
