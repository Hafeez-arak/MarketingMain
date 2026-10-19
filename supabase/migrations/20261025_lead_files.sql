-- ─── Large email attachments, kept for one day (2026-10-19) ────────────────
-- Vercel answers at most 4.5 MB, so a bigger attachment (a drawings zip, a
-- full BOQ) cannot come straight back from /api/leads. The owner's choice:
-- the server fetches it from the mailbox, puts it here, and the browser
-- downloads it from a private link that lasts ten minutes. The copy is
-- deleted after a day; the email keeps the original, so a later click just
-- fetches it again. Nothing in this bucket is the only copy of anything.
--
-- Private, with no policies: only the service key (the server, after it has
-- checked the caller can see the lead) reads or writes it.

insert into storage.buckets (id, name, public)
values ('lead-files', 'lead-files', false)
on conflict (id) do nothing;

-- The copies older than a day, for the server to delete through the Storage
-- API (deleting storage.objects rows in SQL would leave the files behind).
create or replace function public.lead_files_expired(max_rows integer default 500)
returns setof text
language sql
stable
security definer
set search_path = storage, public
as $$
  select name from storage.objects
   where bucket_id = 'lead-files' and created_at < now() - interval '1 day'
   order by created_at
   limit greatest(1, least(max_rows, 1000));
$$;
revoke all on function public.lead_files_expired(integer) from public, anon, authenticated;
grant execute on function public.lead_files_expired(integer) to service_role;
