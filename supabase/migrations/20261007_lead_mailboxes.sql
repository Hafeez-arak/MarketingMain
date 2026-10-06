-- ─── Lead agent: the mailboxes it reads ────────────────────────────────────
-- The owner's decision (2026-10-06): start with info@arak-sa.com only, READ
-- ONLY. Someone signs in as the mailbox once from the Lead Agent page; the
-- server keeps a read-only Microsoft token (Mail.Read, never send or write),
-- sealed in lead_mailbox_secrets, which no signed-in person can read.
-- Kept apart from email_mailboxes on purpose: those are outreach SENDERS,
-- and a mailbox the agent reads must never become one.

create table if not exists public.lead_mailboxes (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  email           text not null,
  display_name    text not null default '',
  status          text not null default 'active' check (status in ('active', 'reconnect')),
  -- Mail received at or after this moment has not been read yet.
  read_from       timestamptz not null default now(),
  last_checked_at timestamptz,
  last_error      text not null default '',
  -- What the last check did, for the page: { seen, skipped, qualified... }.
  last_counts     jsonb not null default '{}'::jsonb,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (workspace_id, email)
);

alter table public.lead_mailboxes enable row level security;
drop policy if exists lead_mailboxes_admin_read on public.lead_mailboxes;
create policy lead_mailboxes_admin_read on public.lead_mailboxes
  for select to authenticated
  using (public.is_access_admin() and public.is_workspace_member(workspace_id));

create table if not exists public.lead_mailbox_secrets (
  mailbox_id    uuid primary key references public.lead_mailboxes(id) on delete cascade,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  secret        text not null,
  updated_at    timestamptz not null default now()
);
-- RLS on and no policy: only the server, with the service key, opens it.
alter table public.lead_mailbox_secrets enable row level security;

-- Where an email lead came from, and the way back to it in Outlook.
alter table public.leads add column if not exists mailbox text not null default '';
alter table public.leads add column if not exists link text not null default '';
alter table public.leads add column if not exists conversation_id text not null default '';
create index if not exists leads_conversation_idx on public.leads (workspace_id, conversation_id) where conversation_id <> '';
