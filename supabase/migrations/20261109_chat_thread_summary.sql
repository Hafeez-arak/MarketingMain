-- A long chat thread's running summary (2026-11-02).
--
-- The assistant is sent the summary plus the messages after summary_through,
-- instead of every message the thread has ever held. research_messages is not
-- touched: the drawer still shows every message, so the summary is invisible
-- from the screen. Written by the server (service role) after an answer has
-- been sent — see api/agent/_thread.js foldThread().
--
-- Until this runs, the chat reads the plain thread and folds nothing.

alter table public.research_chats
  add column if not exists summary text,
  add column if not exists summary_through timestamptz;

comment on column public.research_chats.summary is
  'Running summary of the messages up to summary_through, sent to the assistant in their place. Never shown in the UI.';
comment on column public.research_chats.summary_through is
  'created_at of the last research_messages row folded into summary.';
