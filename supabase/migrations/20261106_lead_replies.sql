-- ─── Replies to leads: the test run first, the send queue later ────────────
-- 2026-10-29. Every qualified lead will get a short reply from the mailbox it
-- wrote to (src/lib/leads/autoReply.js). Before anything is sent, the owner
-- reviews the replies written for last week's leads on the Sales page, in a
-- "Test" tab. Those rows are status 'test' and are never sent.
--
-- The same table becomes the send queue when sending is built ('due' with a
-- send_after 15–20 minutes after the email arrived, then 'sent', 'skipped' or
-- 'failed'), which is why those states and columns are here already.
--
-- Written only with the service key (scripts/lead-qualifier/reply-test.mjs,
-- later the mail round). Read by whoever may approve leads in the company:
-- the access admin and the sales admin.
--
-- Applied by hand. Safe to re-run.

create table if not exists public.lead_replies (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  lead_id       uuid not null references public.leads(id) on delete cascade,
  status        text not null default 'test' check (status in ('test', 'due', 'sent', 'skipped', 'failed')),
  format        text not null default '',
  subject       text not null default '',
  body          text not null default '',
  why           text not null default '',
  skip_reason   text not null default '',
  model         text not null default '',
  cost_usd      numeric not null default 0,
  send_after    timestamptz,
  sent_at       timestamptz,
  error         text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists lead_replies_ws_status on public.lead_replies (workspace_id, status, created_at desc);
create index if not exists lead_replies_lead on public.lead_replies (lead_id);

alter table public.lead_replies enable row level security;

drop policy if exists lead_replies_approver_read on public.lead_replies;
create policy lead_replies_approver_read on public.lead_replies
  for select to authenticated
  using (public.can_approve_leads(workspace_id));

grant select on public.lead_replies to authenticated;
