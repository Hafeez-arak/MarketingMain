-- ─── Deleting a company deletes its data (2026-10-24) ─────────────────────
-- Settings → Delete company does one `delete from workspaces` and counts on
-- every workspace-scoped table cascading. Seven of the oldest tables were
-- created with a plain `references workspaces(id)` (NO ACTION), so the delete
-- failed with "violates foreign key constraint media_library_workspace_id_fkey"
-- — and fixing only that one would have failed next on brand_profile. These
-- were the only NO ACTION / RESTRICT foreign keys left in public (checked on
-- the live database); everything else already cascades or sets null.
--
-- The three instagram_* tables are the retired ones (empty since 2026-09-14)
-- but they still exist, so they still block the delete.
do $$
declare
  t text;
begin
  foreach t in array array[
    'media_library', 'brand_profile', 'brand_edit_feedback',
    'instagram_generated_posts', 'instagram_manual_posts',
    'instagram_reels', 'instagram_schedule'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I drop constraint if exists %I', t, t || '_workspace_id_fkey');
      execute format(
        'alter table public.%I add constraint %I foreign key (workspace_id) references public.workspaces(id) on delete cascade',
        t, t || '_workspace_id_fkey');
    end if;
  end loop;
end $$;
