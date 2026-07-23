-- Fix: "new row violates row-level security policy" when uploading a
-- reference image (ReferencePicker → uploadReferenceImage → schedule-uploads
-- bucket). The bucket has RLS enabled (Supabase's default on storage.objects)
-- but no policies were ever created for it — every insert/read was rejected.
-- Same pattern already used for the brand-assets bucket (20260630 migration).
--
-- Run ONCE in the Supabase SQL editor. Idempotent + additive.

-- Ensure the bucket exists and is public (URLs are fed straight to
-- FLUX/i2v/render APIs, same as brand-assets).
insert into storage.buckets (id, name, public)
values ('schedule-uploads', 'schedule-uploads', true)
on conflict (id) do nothing;

drop policy if exists "schedule-uploads read"   on storage.objects;
create policy "schedule-uploads read"   on storage.objects
  for select using (bucket_id = 'schedule-uploads');

drop policy if exists "schedule-uploads insert" on storage.objects;
create policy "schedule-uploads insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'schedule-uploads');

drop policy if exists "schedule-uploads update" on storage.objects;
create policy "schedule-uploads update" on storage.objects
  for update to authenticated using (bucket_id = 'schedule-uploads');

drop policy if exists "schedule-uploads delete" on storage.objects;
create policy "schedule-uploads delete" on storage.objects
  for delete to authenticated using (bucket_id = 'schedule-uploads');
