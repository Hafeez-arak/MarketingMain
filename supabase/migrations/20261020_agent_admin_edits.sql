-- ─── The assistant edits directly, for admins — and every edit is logged ───
-- 2026-10-17. The chat gained direct edits for admins (Brand Brain, rule book,
-- research agenda, sales ICP, plan ideas, draft text). See
-- src/lib/agent/adminTools.js for the gate and api/agent/_adminEdits.js for
-- the executors. This migration adds two things:
--
--   1. agent_edit_log — one row per direct edit, with the row before and
--      after, so a change can be seen and undone. The executor writes the log
--      row right after the change and REVERTS the change if the log row cannot
--      be written, so until this table exists every direct edit is refused by
--      being put back. Applying this migration is what switches the feature on.
--
--   2. research_messages.attachments — the name, type and a ~160px thumbnail
--      of each image or PDF attached to a chat message. Never the file itself:
--      that goes to the model on its own turn and nowhere else. Both readers of
--      this column fall back to a select without it, so the chat keeps working
--      before this is applied; thumbnails just do not survive a reload yet.
--
-- Apply by hand, like every migration here.

create table if not exists public.agent_edit_log (
  id          uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- Who asked. The admin whose chat made the change, from the session token.
  user_id     uuid references auth.users(id) on delete set null,
  chat_id     uuid references public.research_chats(id) on delete set null,
  tool        text not null default '',
  -- Constrained to the tables the code allows (ADMIN_EDIT_TABLES). The undo
  -- replays `before` into `table_name`, so this CHECK is the database's half
  -- of making sure a log row can never become a write to anywhere else.
  table_name  text not null
              check (table_name in (
                'brand_profile', 'brand_sections', 'brand_fields', 'brand_directory_rows',
                'brand_memory', 'research_agenda', 'sales_icp', 'plan_ideas', 'generated_posts'
              )),
  -- text, not uuid: sales_icp is keyed by its workspace_id, and the log should
  -- not care which column a table uses as its key.
  row_id      text not null default '',
  action      text not null check (action in ('create', 'update', 'delete', 'undo')),
  -- For an update, only the columns the edit touched; for a create or delete,
  -- the whole row. That is exactly what an undo needs to put back.
  before      jsonb,
  after       jsonb,
  -- On an 'undo' row: the edit it reversed. On the reversed row: when, by whom.
  undoes      uuid references public.agent_edit_log(id) on delete set null,
  undone_at   timestamptz,
  undone_by   uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists agent_edit_log_ws_idx
  on public.agent_edit_log (workspace_id, created_at desc);

-- ── Who can see it, and who can write it ────────────────────────────────────
-- Members read their workspace's log: "what did the assistant change?" is a
-- question every member may ask, not only the admin who made the change.
-- Nobody writes it through the API. There is deliberately no insert, update or
-- delete policy: the only writer is the chat endpoint with the service key,
-- which bypasses RLS. An audit log a member could edit would not be one.
-- (RLS is still not workspace isolation here — the operators belong to every
-- workspace — so readers filter by workspace_id, as everywhere.)
alter table public.agent_edit_log enable row level security;

drop policy if exists agent_edit_log_member_read on public.agent_edit_log;
create policy agent_edit_log_member_read on public.agent_edit_log
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

comment on table public.agent_edit_log is
  'One row per direct edit the assistant made for an admin, with before/after for undo. Written only with the service key by /api/agent/chat.';

-- ── Thumbnails of what was attached to a chat message ───────────────────────
alter table public.research_messages
  add column if not exists attachments jsonb not null default '[]'::jsonb;

comment on column public.research_messages.attachments is
  'Files attached to a user message: [{name, media_type, kind, thumb}]. thumb is a small JPEG data URL. The file itself is never stored.';
