-- ════════════════════════════════════════════════════════════════════════
-- copy_mode — whose words go out
--
-- Until now every plan had exactly one exit: finalizePlan() fired the n8n
-- Plan Generation webhooks, an AI wrote the caption, and the post row was
-- born from that. There was no way to say "the copy is already mine."
--
-- That made a whole legitimate use of this app impossible. Someone who has
-- written their own posts and just wants them scheduled had to either let
-- the AI rewrite their words, or not use the planner at all. Their typed
-- text was stored as `title`/`topic` — an idea BRIEF, a prompt for the
-- writer — and never as a caption, so it could not survive the trip.
--
-- The failure was worse than a rewrite when no webhook was configured:
-- finalize hard-failed, and the plan dead-ended holding approved ideas and
-- finished pictures that could never become posts.
--
-- copy_mode is the one fact that was missing:
--   'ai'  = brief the writer, generate the caption   (every existing row)
--   'own' = these words are final, publish them      (new)
--
-- Why a column and not "caption_en is non-empty": those are different
-- claims. Draft Copy already writes caption_ar/caption_en for AI ideas the
-- reviewer has picked wording for, and finalize must still send those
-- through the engine (which commits them rather than regenerating). Reading
-- intent off a populated field would sweep those ideas into the manual path
-- and silently stop the rest of the generation work — media prompts, first
-- comments, hashtags — from ever running for them.
--
-- Default 'ai' so every existing row keeps behaving exactly as it does now.
--
-- Run ONCE in the Supabase SQL editor. Idempotent + additive.
-- ════════════════════════════════════════════════════════════════════════

alter table public.plan_ideas
  add column if not exists copy_mode text not null default 'ai';

alter table public.plan_ideas
  drop constraint if exists plan_ideas_copy_mode_check;

alter table public.plan_ideas
  add constraint plan_ideas_copy_mode_check
  check (copy_mode in ('ai', 'own'));

-- Finalize partitions the approved ideas by this column, so it is read once
-- per plan over exactly that set.
create index if not exists plan_ideas_copy_mode_idx
  on public.plan_ideas(plan_id, copy_mode);
