-- ─── Lead agent ─────────────────────────────────────────────────────────────
-- Every enquiry the lead agent has read, from any source, and what it decided.
-- The website form is the first source; the info@ mailbox and Odoo come next
-- and read the same table. The rules live in src/lib/leads/qualify.js, the
-- server in api/leads/[action].js.
--
-- Admin only for now (the owner's decision, 2026-10-06): these rows carry
-- clients' names, emails and phone numbers. People read them through RLS;
-- every write goes through the server with the service key.

-- ── 1. leads ────────────────────────────────────────────────────────────────
create table if not exists public.leads (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  source        text not null check (source in ('website_form', 'email')),
  -- Stable per message (Sheet: received time + email; mail: message id), so
  -- reading the same enquiry twice never makes two leads or two model calls.
  source_ref    text not null,
  received_at   timestamptz,
  name          text not null default '',
  company       text not null default '',
  email         text not null default '',
  phone         text not null default '',
  subject       text not null default '',
  message       text not null default '',
  language      text not null default 'en' check (language in ('en', 'ar')),
  -- Null until the model has answered. A failed call leaves it null with
  -- `error` set, and the next pass tries again.
  verdict       text check (verdict in ('qualified', 'unqualified', 'needs_review', 'duplicate')),
  category      text not null default '',
  confidence    text not null default '',
  reason        text not null default '',
  summary       text not null default '',
  details       jsonb not null default '{}'::jsonb,
  ask_next      jsonb not null default '[]'::jsonb,
  duplicate_of  uuid references public.leads(id) on delete set null,
  model         text not null default '',
  cost_usd      numeric not null default 0,
  error         text not null default '',
  -- A person's correction. Never overwritten by the agent; it is how we
  -- measure whether the agent is right.
  human_verdict text check (human_verdict in ('qualified', 'unqualified', 'needs_review')),
  reviewed_by   uuid references auth.users(id) on delete set null,
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, source, source_ref)
);

create index if not exists leads_ws_received_idx on public.leads (workspace_id, received_at desc);

alter table public.leads enable row level security;
drop policy if exists leads_admin_read on public.leads;
create policy leads_admin_read on public.leads
  for select to authenticated
  using (public.is_access_admin() and public.is_workspace_member(workspace_id));

-- ── 2. lead_agent_settings ──────────────────────────────────────────────────
-- One row per company. `intake_key` is what the website Sheet's script sends
-- to prove it is that company's Sheet; rotating it cuts an old copy off.
create table if not exists public.lead_agent_settings (
  workspace_id    uuid primary key references public.workspaces(id) on delete cascade,
  enabled         boolean not null default true,
  intake_key      uuid not null default gen_random_uuid(),
  last_intake_at  timestamptz,
  updated_at      timestamptz not null default now()
);

create unique index if not exists lead_agent_settings_key_idx on public.lead_agent_settings (intake_key);

alter table public.lead_agent_settings enable row level security;
drop policy if exists lead_agent_settings_admin_read on public.lead_agent_settings;
create policy lead_agent_settings_admin_read on public.lead_agent_settings
  for select to authenticated
  using (public.is_access_admin() and public.is_workspace_member(workspace_id));

-- ── 3. lead_agent_secrets ───────────────────────────────────────────────────
-- The OpenRouter key, sealed (AES-GCM, see api/email/_secrets.js). RLS on and
-- no policy: no signed-in person can read it, not even the admin. Only the
-- server, with the service key, opens it.
create table if not exists public.lead_agent_secrets (
  workspace_id    uuid primary key references public.workspaces(id) on delete cascade,
  openrouter_key  text not null,
  updated_at      timestamptz not null default now()
);

alter table public.lead_agent_secrets enable row level security;
