-- ════════════════════════════════════════════════════════════════════════
-- generated_posts: a post that has gone out cannot be changed from the app
-- ════════════════════════════════════════════════════════════════════════
-- On 2026-09-15 a plan was saved a second time after one of its posts had
-- already been published on Instagram. Finalising PATCHed that row back to
-- status='pending_review' and rewrote its caption, so a live post sat in the
-- review queue with Approve and Edit buttons on it. Nothing anywhere asked
-- whether the post had gone out.
--
-- The app now asks (src/lib/postLock.js), in every screen that writes a post.
-- This is the layer that holds when a screen forgets, a tab is stale, or a
-- request is replayed.
--
-- LOCKED means, exactly as postLock.js defines it:
--   publish_status in ('publishing','published')
--   or published_at is set
--   or publish_status = 'scheduled' and scheduled_publish_at <= now()
-- A post scheduled for the future stays editable — the app re-books it at
-- Zernio when it changes.
--
-- What is refused, on a locked row, for a browser session (anon/authenticated):
--   * UPDATE of any content, timing, review or publish-state column
--   * DELETE — removing our row does not remove the post from the platform,
--     it only removes the record (and its analytics) of what went out
--
-- What is NOT refused: the service role. The n8n publish and sync workflows
-- write publish_status / published_at / platform_post_url after a post goes
-- out, and a reschedule or stuck-row recovery has to be possible. The SQL
-- editor (postgres) is exempt for the same reason.
--
-- Run ONCE in the Supabase SQL editor. Idempotent.
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.generated_post_is_locked(p public.generated_posts)
returns boolean
language sql
stable
as $$
  select coalesce(p.publish_status, '') in ('publishing', 'published')
      or p.published_at is not null
      or (p.publish_status = 'scheduled'
          and p.scheduled_publish_at is not null
          and p.scheduled_publish_at <= now());
$$;

create or replace function public.generated_posts_lock_sent()
returns trigger
language plpgsql
as $$
declare
  jwt_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '');
begin
  -- Trusted writers: n8n (service role) and anything run in the SQL editor.
  if jwt_role = 'service_role' or current_user in ('postgres', 'supabase_admin', 'service_role') then
    return coalesce(new, old);
  end if;

  if not public.generated_post_is_locked(old) then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    raise exception 'This post has already gone out, so its record cannot be deleted.'
      using errcode = 'P0001', hint = 'post_locked';
  end if;

  if (new.caption, new.caption_ar, new.caption_en, new.hashtags, new.first_comment,
      new.topic, new.format, new.media_type, new.aspect_ratio, new.post_kind,
      new.image_url, new.image_urls, new.video_url, new.cover_image_url,
      new.platform_options, new.tags, new.platform, new.workspace_id,
      new.scheduled_date, new.publish_time, new.scheduled_publish_at, new.status,
      new.publish_status, new.published_at, new.zernio_post_id, new.zernio_account_id,
      new.platform_post_url, new.plan_id, new.plan_idea_id)
     is distinct from
     (old.caption, old.caption_ar, old.caption_en, old.hashtags, old.first_comment,
      old.topic, old.format, old.media_type, old.aspect_ratio, old.post_kind,
      old.image_url, old.image_urls, old.video_url, old.cover_image_url,
      old.platform_options, old.tags, old.platform, old.workspace_id,
      old.scheduled_date, old.publish_time, old.scheduled_publish_at, old.status,
      old.publish_status, old.published_at, old.zernio_post_id, old.zernio_account_id,
      old.platform_post_url, old.plan_id, old.plan_idea_id)
  then
    raise exception 'This post has already gone out, so it cannot be edited.'
      using errcode = 'P0001', hint = 'post_locked';
  end if;

  return new;
end;
$$;

drop trigger if exists generated_posts_lock_sent on public.generated_posts;
create trigger generated_posts_lock_sent
  before update or delete on public.generated_posts
  for each row execute function public.generated_posts_lock_sent();

-- The row that prompted this: published on Zernio at 17:53 UTC on 2026-09-14,
-- then reset to pending_review by a re-save. Its review status is put back to
-- what it was when it went out. publish_status was never wrong.
update public.generated_posts
   set status = 'scheduled'
 where publish_status = 'published'
   and status = 'pending_review';
