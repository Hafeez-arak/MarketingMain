-- ════════════════════════════════════════════════════════════════════════
-- The media stage
--
-- Approving an idea and finishing its picture are two different facts, and
-- until now only the first one had anywhere to live. `status='approved'` means
-- "this idea is worth making"; nothing meant "the picture is done". So the
-- plan board could not show what was actually left to do, and the only way to
-- find out was to open every card.
--
-- That mattered more once the marketing team's actual standard was clear: an
-- image is finished when the person making it has edited and re-iterated until
-- she is happy with it, not when a model returns something. A one-shot render
-- is never the answer — which is also why plan generation now defaults to
-- Studio rather than paying for an image nobody will accept.
--
-- Worth knowing why that default matters: plan generation renders with
-- flux-schnell, while Creative Studio renders with gpt-image-2 and
-- nano-banana-2. Those are different quality tiers. A bulk-generated image
-- therefore arrives in review LOOKING finished, isn't, and offers no way
-- forward — you would have to start again in Studio. A blank slot is more
-- honest than a mediocre picture.
--
-- Run ONCE in the Supabase SQL editor. Idempotent + additive.
-- ════════════════════════════════════════════════════════════════════════

-- ── media_status ────────────────────────────────────────────────────────
-- Deliberately separate from image_mode, which is a different question:
--   image_mode   = HOW this idea's media gets made  (studio | use_reference | generate)
--   media_status = whether it is DONE               (none | in_studio | ready)
-- Collapsing them was tempting and wrong — 'studio' would have had to mean
-- both "she is making it by hand" and "it isn't finished", which are true at
-- different times and stop being true independently.
--
-- 'none' rather than null so the board never has to treat a missing value and
-- a not-started value as two different things.

alter table public.plan_ideas
  add column if not exists media_status text not null default 'none';

alter table public.plan_ideas
  drop constraint if exists plan_ideas_media_status_check;

alter table public.plan_ideas
  add constraint plan_ideas_media_status_check
  check (media_status in ('none', 'in_studio', 'ready'));

-- Which Studio version was accepted. The thumbnail itself reuses the existing
-- preview_image_url column rather than adding a second one — that column
-- already means "the picture standing in for this idea on the board", and
-- having two would immediately raise the question of which one wins.
alter table public.plan_ideas
  add column if not exists media_version_id uuid;

-- Backfill: an idea that already has a picture is already done. Without this
-- every existing plan would open showing all its media as not started, which
-- is both wrong and alarming.
update public.plan_ideas
   set media_status = 'ready'
 where media_status = 'none'
   and coalesce(preview_image_url, '') <> '';

-- The board's query: this plan's ideas, grouped by how far along they are.
create index if not exists plan_ideas_media_status_idx
  on public.plan_ideas(plan_id, media_status);


-- ── image_mode now defaults to studio ───────────────────────────────────
-- New ideas are made by hand unless someone says otherwise. 'generate' stays
-- in the CHECK as a deliberate opt-out for low-stakes formats (a Story that
-- only needs a background), not as the path of least resistance it used to be.
--
-- Only the DEFAULT changes. Existing rows keep whatever they were set to, so
-- a plan mid-flight does not change behaviour underneath the person running it.
alter table public.plan_ideas
  alter column image_mode set default 'studio';
