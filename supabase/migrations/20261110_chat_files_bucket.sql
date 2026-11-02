-- ─── Files attached in the assistant chat, kept for later turns (2026-11-02) ─
-- Hand-applied. Until it is, every upload fails quietly, files are stored
-- without a path, and the chat behaves as it did before (api/agent/_chatFiles.js).
--
-- The chat used to keep only a thumbnail, so a follow-up ("look at the PDF
-- again") could not re-read a newsletter it had been shown. The original now
-- goes here, with a PDF's extracted text beside it, and the get_attachment
-- tool re-opens it on the turn that needs it:
--
--   <workspace>/chat/<chat>/<key>/file.<ext>
--   <workspace>/chat/<chat>/<key>/text.txt
--
-- Private, with no policies: only the service key (the server, after it has
-- proved the thread is the caller's own) reads or writes it. Chats are private
-- to their owner, and a browser policy would have to choose between leaking
-- them and not being able to clean them up; see src/lib/workspaceFiles.js.
--
-- No column: where a file was kept is recorded on the message's existing
-- research_messages.attachments entry (path, text_path).

insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-files', 'chat-files', false, 10485760)
on conflict (id) do nothing;

-- Files whose chat no longer exists: a deleted company (research_chats
-- cascades with the workspace) or a deleted conversation. Returned for the
-- server to remove through the Storage API, since deleting storage.objects
-- rows in SQL would leave the files behind. Ten minutes' grace so a file
-- uploaded alongside a brand-new chat is never mistaken for an orphan.
create or replace function public.chat_files_orphaned(max_rows integer default 500)
returns setof text
language sql
stable
security definer
set search_path = storage, public
as $$
  select o.name from storage.objects o
   where o.bucket_id = 'chat-files'
     and o.created_at < now() - interval '10 minutes'
     and not exists (
       select 1 from public.research_chats c
        where c.id::text = (storage.foldername(o.name))[3]
          and c.workspace_id::text = (storage.foldername(o.name))[1]
     )
   order by o.created_at
   limit greatest(1, least(max_rows, 1000));
$$;
revoke all on function public.chat_files_orphaned(integer) from public, anon, authenticated;
grant execute on function public.chat_files_orphaned(integer) to service_role;
