-- ─── v2: CRM (sales opportunities), the tables ─────────────────────────────
-- 2026-10-28. Musa's CRM module, rewritten in our own stack as the v2 section
-- `crm` (dev/erp-pilot/CRM.md). Our own clean tables in `public`, not his
-- schema: his rules were read from his app and written here again.
--
--   crm_stages        the company's pipeline stages, in its own order
--   crm_sources       where opportunities come from
--   crm_lost_reasons  why they are lost (needed to mark one lost)
--   crm_tags          labels on opportunities, one of eight colours
--   crm_leads         the opportunity: open → won (with a client) or lost
--   crm_lead_tags     an opportunity's tags
--   crm_activities    planned calls, meetings, emails, site visits, tasks
--   crm_counters      the L-2026-000001 series, per company and year
--   crm_history       who changed what on an opportunity and its activities
--
-- The client is an organisation from Contacts (contacts_orgs): his "won
-- needs a client" and "no new opportunity for an archived client" point at
-- it through a composite (client_org_id, workspace_id) key, so an
-- opportunity can never name another company's client.
--
-- Who may do what (the section grant, 20261101_section_access), his three
-- permissions mapped onto our three levels:
--   view    read (his crm.view)
--   work    add, edit, move, won / lost / reopen, delete, activities (crm.manage)
--   manage  stages, sources, loss reasons, tags; the history (crm.settings)
-- RLS checks the grant; the business rules are triggers in
-- 20261125_crm_2_rules.sql.
--
-- v2 ONLY: the local v2 database (dev/v2db). Safe to re-run.

-- ── The section key ──
-- A check constraint is replaced whole: every key there today, plus 'crm'.
alter table public.section_access drop constraint if exists section_access_section_check;
alter table public.section_access add constraint section_access_section_check
  check (section in ('ceo', 'sales', 'marketing', 'insights', 'technical', 'finance', 'hr', 'contacts', 'crm'));
alter table public.tasks drop constraint if exists tasks_section_check;
alter table public.tasks add constraint tasks_section_check
  check (section in ('ceo', 'sales', 'marketing', 'insights', 'technical', 'finance', 'hr', 'contacts', 'crm'));
alter table public.meetings drop constraint if exists meetings_section_check;
alter table public.meetings add constraint meetings_section_check
  check (section in ('ceo', 'sales', 'marketing', 'insights', 'technical', 'finance', 'hr', 'contacts', 'crm'));

-- ── The company's lists ──
-- Named by the company (his are Arabic first), with an optional English
-- name. Switched off, never deleted: an opportunity keeps what it had.

create table if not exists public.crm_stages (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 120),
  name_en      text check (name_en is null or length(btrim(name_en)) between 1 and 120),
  -- Smaller first.
  sequence     integer not null default 10 check (sequence between 0 and 9999),
  is_active    boolean not null default true,
  -- An event of the quotation cycle that moves an open opportunity here
  -- (crm_auto_stage); one stage per event in a company.
  auto_event   text check (auto_event is null or auto_event in ('pricing', 'technical', 'financial', 'revision')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint crm_stages_id_ws unique (id, workspace_id)
);
create unique index if not exists crm_stages_name_uq on public.crm_stages (workspace_id, name);
create unique index if not exists crm_stages_event_uq on public.crm_stages (workspace_id, auto_event) where auto_event is not null;

create table if not exists public.crm_sources (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 120),
  name_en      text check (name_en is null or length(btrim(name_en)) between 1 and 120),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint crm_sources_id_ws unique (id, workspace_id)
);
create unique index if not exists crm_sources_name_uq on public.crm_sources (workspace_id, name);

create table if not exists public.crm_lost_reasons (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 120),
  name_en      text check (name_en is null or length(btrim(name_en)) between 1 and 120),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint crm_lost_reasons_id_ws unique (id, workspace_id)
);
create unique index if not exists crm_lost_reasons_name_uq on public.crm_lost_reasons (workspace_id, name);

create table if not exists public.crm_tags (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 120),
  name_en      text check (name_en is null or length(btrim(name_en)) between 1 and 120),
  -- One of the eight palette colours (lib/crm/logic.js TAG_COLORS).
  color        smallint not null default 0 check (color between 0 and 7),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint crm_tags_id_ws unique (id, workspace_id)
);
create unique index if not exists crm_tags_name_uq on public.crm_tags (workspace_id, name);

-- ── The opportunity ──
create table if not exists public.crm_leads (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  -- L-2026-000001: per company and year, gap-free (crm_leads_number).
  lead_no             text not null default '',
  title               text not null check (length(btrim(title)) between 1 and 255),
  -- Someone to talk to: a contact, an organisation, or a client.
  contact_name        text check (contact_name is null or length(btrim(contact_name)) between 1 and 255),
  organization        text check (organization is null or length(btrim(organization)) between 1 and 255),
  phone               text check (phone is null or length(phone) between 1 and 30),
  email               text check (email is null or email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  city                text check (city is null or length(btrim(city)) between 1 and 100),
  client_org_id       uuid,
  consultant          text check (consultant is null or length(btrim(consultant)) between 1 and 255),
  project_owner       text check (project_owner is null or length(btrim(project_owner)) between 1 and 255),
  -- The tender.
  bid_due_date        date,
  tender_ref          text check (tender_ref is null or length(btrim(tender_ref)) between 1 and 255),
  -- Follow-up.
  stage_id            uuid not null,
  source_id           uuid,
  assigned_to         uuid references auth.users(id) on delete set null,
  status              text not null default 'open' check (status in ('open', 'won', 'lost')),
  -- Unknown stays null, never 0 (his rule).
  expected_revenue    numeric(14,2) check (expected_revenue is null or expected_revenue between 0 and 999999999999),
  probability         smallint check (probability is null or probability between 0 and 100),
  expected_close_date date,
  priority            smallint not null default 0 check (priority between 0 and 3),
  -- Closing.
  lost_reason_id      uuid,
  lost_note           text check (lost_note is null or length(lost_note) <= 2000),
  closed_at           timestamptz,
  closed_by           uuid references auth.users(id) on delete set null,
  notes               text check (notes is null or length(notes) <= 10000),
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint crm_leads_id_ws unique (id, workspace_id),
  constraint crm_leads_client_fk foreign key (client_org_id, workspace_id) references public.contacts_orgs (id, workspace_id),
  constraint crm_leads_stage_fk foreign key (stage_id, workspace_id) references public.crm_stages (id, workspace_id),
  constraint crm_leads_source_fk foreign key (source_id, workspace_id) references public.crm_sources (id, workspace_id),
  constraint crm_leads_reason_fk foreign key (lost_reason_id, workspace_id) references public.crm_lost_reasons (id, workspace_id),
  constraint crm_leads_someone check (contact_name is not null or organization is not null or client_org_id is not null),
  -- Closed ⇔ a closing time; closed_by is the signed-in person who closed it.
  constraint crm_leads_closed check ((status = 'open') = (closed_at is null) and (status <> 'open' or closed_by is null)),
  constraint crm_leads_lost_reason check ((status = 'lost') = (lost_reason_id is not null)),
  constraint crm_leads_lost_note check (status = 'lost' or lost_note is null),
  constraint crm_leads_won_client check (status <> 'won' or client_org_id is not null)
);
create unique index if not exists crm_leads_no_uq on public.crm_leads (workspace_id, lead_no);
create index if not exists crm_leads_list_idx on public.crm_leads (workspace_id, status, stage_id);
create index if not exists crm_leads_client_idx on public.crm_leads (client_org_id);
create index if not exists crm_leads_assignee_idx on public.crm_leads (assigned_to);

create table if not exists public.crm_lead_tags (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id      uuid not null,
  tag_id       uuid not null,
  primary key (lead_id, tag_id),
  constraint crm_lead_tags_lead_fk foreign key (lead_id, workspace_id) references public.crm_leads (id, workspace_id) on delete cascade,
  constraint crm_lead_tags_tag_fk foreign key (tag_id, workspace_id) references public.crm_tags (id, workspace_id)
);
create index if not exists crm_lead_tags_tag_idx on public.crm_lead_tags (tag_id);

create table if not exists public.crm_activities (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  lead_id       uuid not null,
  activity_type text not null check (activity_type in ('call', 'meeting', 'email', 'site_visit', 'task')),
  summary       text not null check (length(btrim(summary)) between 1 and 500),
  due_date      date not null,
  assigned_to   uuid not null references auth.users(id),
  done_at       timestamptz,
  done_by       uuid references auth.users(id) on delete set null,
  outcome       text check (outcome is null or length(outcome) <= 2000),
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint crm_activities_lead_fk foreign key (lead_id, workspace_id) references public.crm_leads (id, workspace_id) on delete cascade,
  constraint crm_activities_outcome check (done_at is not null or outcome is null)
);
create index if not exists crm_activities_lead_idx on public.crm_activities (lead_id);
create index if not exists crm_activities_open_idx on public.crm_activities (workspace_id, assigned_to, due_date) where done_at is null;

-- Nobody reads or writes it but the numbering trigger (security definer).
create table if not exists public.crm_counters (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  year         integer not null,
  last         integer not null default 0,
  primary key (workspace_id, year)
);

-- One row per change, written by the database whoever made it. No foreign
-- key to the opportunity: a deleted one's history stays (his audit_log).
create table if not exists public.crm_history (
  id           bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id      uuid not null,
  activity_id  uuid,                 -- set when the row is about an activity
  action       text not null check (action in ('insert', 'update', 'delete')),
  -- What it was called at the time (the title, or the activity's summary).
  label        text not null default '',
  -- Field → [old, new]; only the fields that changed (update only).
  changes      jsonb not null default '{}'::jsonb,
  actor        uuid references auth.users(id) on delete set null,
  at           timestamptz not null default now()
);
create index if not exists crm_history_lead_idx on public.crm_history (workspace_id, lead_id, id desc);

-- ── Who reads, who writes ──
alter table public.crm_stages enable row level security;
alter table public.crm_sources enable row level security;
alter table public.crm_lost_reasons enable row level security;
alter table public.crm_tags enable row level security;
alter table public.crm_leads enable row level security;
alter table public.crm_lead_tags enable row level security;
alter table public.crm_activities enable row level security;
alter table public.crm_counters enable row level security;
alter table public.crm_history enable row level security;

revoke all on public.crm_stages, public.crm_sources, public.crm_lost_reasons, public.crm_tags, public.crm_leads,
  public.crm_lead_tags, public.crm_activities, public.crm_counters, public.crm_history from anon, authenticated;
-- The lists are switched off, never deleted (his settings screen has no delete).
grant select, insert, update on public.crm_stages, public.crm_sources, public.crm_lost_reasons, public.crm_tags to authenticated;
grant select, insert, update, delete on public.crm_leads, public.crm_activities to authenticated;
grant select, insert, delete on public.crm_lead_tags to authenticated;
grant select on public.crm_history to authenticated;

do $$
declare t text;
begin
  -- The company's lists: everyone with the section reads; managing names them.
  foreach t in array array['crm_stages', 'crm_sources', 'crm_lost_reasons', 'crm_tags'] loop
    execute format('drop policy if exists %1$s_read on public.%1$I', t);
    execute format('create policy %1$s_read on public.%1$I for select to authenticated using (public.has_section(workspace_id, ''crm'', ''view''))', t);
    execute format('drop policy if exists %1$s_add on public.%1$I', t);
    execute format('create policy %1$s_add on public.%1$I for insert to authenticated with check (public.has_section(workspace_id, ''crm'', ''manage''))', t);
    execute format('drop policy if exists %1$s_change on public.%1$I', t);
    execute format('create policy %1$s_change on public.%1$I for update to authenticated using (public.has_section(workspace_id, ''crm'', ''manage'')) with check (public.has_section(workspace_id, ''crm'', ''manage''))', t);
  end loop;
  -- Opportunities and their activities: view reads, work writes.
  foreach t in array array['crm_leads', 'crm_activities'] loop
    execute format('drop policy if exists %1$s_read on public.%1$I', t);
    execute format('create policy %1$s_read on public.%1$I for select to authenticated using (public.has_section(workspace_id, ''crm'', ''view''))', t);
    execute format('drop policy if exists %1$s_add on public.%1$I', t);
    execute format('create policy %1$s_add on public.%1$I for insert to authenticated with check (public.has_section(workspace_id, ''crm'', ''work''))', t);
    execute format('drop policy if exists %1$s_change on public.%1$I', t);
    execute format('create policy %1$s_change on public.%1$I for update to authenticated using (public.has_section(workspace_id, ''crm'', ''work'')) with check (public.has_section(workspace_id, ''crm'', ''work''))', t);
    execute format('drop policy if exists %1$s_remove on public.%1$I', t);
    execute format('create policy %1$s_remove on public.%1$I for delete to authenticated using (public.has_section(workspace_id, ''crm'', ''work''))', t);
  end loop;
end $$;

drop policy if exists crm_lead_tags_read on public.crm_lead_tags;
create policy crm_lead_tags_read on public.crm_lead_tags
  for select to authenticated using (public.has_section(workspace_id, 'crm', 'view'));
drop policy if exists crm_lead_tags_add on public.crm_lead_tags;
create policy crm_lead_tags_add on public.crm_lead_tags
  for insert to authenticated with check (public.has_section(workspace_id, 'crm', 'work'));
drop policy if exists crm_lead_tags_remove on public.crm_lead_tags;
create policy crm_lead_tags_remove on public.crm_lead_tags
  for delete to authenticated using (public.has_section(workspace_id, 'crm', 'work'));

-- His history needs audit.view; here, whoever manages the CRM.
drop policy if exists crm_history_read on public.crm_history;
create policy crm_history_read on public.crm_history
  for select to authenticated using (public.has_section(workspace_id, 'crm', 'manage'));
