-- The sales playbook (2026-11-07, battle cards Part 2): situation cards in
-- the owner's template, one row each. A lead's battle card shows the ones
-- whose signals match it; an approved lead's Odoo notes carry them too.
-- See src/lib/sales/playbook.js. The content names real clients, so it
-- lives here, never in the repository.
--
--   category   discovery | objection | competitor | persona | closing
--   signals    what in a lead brings the card up (leadSignals keys, plus
--              sender_<type>, stage_<stage>, quote_sent)
--   status     draft until the owner of the cards marks it reviewed

create table if not exists public.playbook_cards (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  position      integer not null default 0,
  title         text not null check (length(title) between 1 and 200),
  category      text not null check (category in ('discovery', 'objection', 'competitor', 'persona', 'closing')),
  stage         text not null default '',
  trigger       text not null default '',
  statement     text not null default '',
  objective     text not null default '',
  response      text not null default '',
  follow_up     text not null default '',
  evidence      text not null default '',
  source        text not null default '',
  next_step     text not null default '',
  avoid         jsonb not null default '[]'::jsonb,
  signals       text[] not null default '{}',
  owner_label   text not null default '',
  status        text not null default 'draft' check (status in ('draft', 'approved')),
  reviewed_at   timestamptz,
  reviewed_by   uuid references auth.users(id) on delete set null,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id) on delete set null
);

create index if not exists playbook_cards_ws_idx on public.playbook_cards (workspace_id, position);

alter table public.playbook_cards enable row level security;

-- Read: the company's members and its sales seats. Writes go through
-- api/leads (the access admin or a sales admin), with the service key.
drop policy if exists playbook_cards_member_read on public.playbook_cards;
create policy playbook_cards_member_read on public.playbook_cards
  for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists playbook_cards_sales_read on public.playbook_cards;
create policy playbook_cards_sales_read on public.playbook_cards
  for select to authenticated using (public.is_sales_member(workspace_id));
