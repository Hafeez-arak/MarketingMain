-- ════════════════════════════════════════════════════════════════════════
-- Media Library: a real storage bucket instead of base64 in a text column
-- ════════════════════════════════════════════════════════════════════════
-- pages/media/index.jsx read every dropped file with FileReader.readAsDataURL
-- and wrote the resulting data: URL straight into media_library.url — a
-- Postgres text column. So the database was the file store: a 4 MB image
-- became a ~5.5 MB base64 string in a row that every listing query then had
-- to read in full, and Postgres holds it forever in TOAST.
--
-- Every other upload path in this app already does the right thing
-- (brand-assets, creative-studio, instagram-posts...). This gives the media
-- library the same, with policies copied from brand-assets so the two behave
-- identically.
--
-- Run ONCE. Idempotent — safe to re-run, drops nothing.
-- ════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public)
values ('media-library', 'media-library', true)
on conflict (id) do nothing;

-- Same four policies brand-assets has. Access is gated by the app's own
-- workspace filter on media_library rows; the bucket itself is public-read
-- because the URLs are embedded straight into posts.
drop policy if exists "media-library read"   on storage.objects;
drop policy if exists "media-library insert" on storage.objects;
drop policy if exists "media-library update" on storage.objects;
drop policy if exists "media-library delete" on storage.objects;

create policy "media-library read"   on storage.objects
  for select using (bucket_id = 'media-library');
create policy "media-library insert" on storage.objects
  for insert with check (bucket_id = 'media-library');
create policy "media-library update" on storage.objects
  for update using (bucket_id = 'media-library');
create policy "media-library delete" on storage.objects
  for delete using (bucket_id = 'media-library');

-- Where the object lives, so a deleted row can take its file with it. Rows
-- written before this migration have no path — their url is the data: URL
-- itself, and the app treats a missing storage_path as "legacy, inline".
alter table public.media_library
  add column if not exists storage_path text;

comment on column public.media_library.storage_path is
  'Object path in the media-library bucket. Null on legacy rows whose url is an inline data: URL.';

-- ════════════════════════════════════════════════════════════════════════
-- Done. Existing inline rows are left alone deliberately: they still render,
-- and rewriting them would mean re-uploading content this migration cannot
-- see. See the note in pages/media/index.jsx about how they are surfaced.
-- ════════════════════════════════════════════════════════════════════════
