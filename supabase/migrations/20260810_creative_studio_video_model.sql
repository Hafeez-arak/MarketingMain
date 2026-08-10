-- ════════════════════════════════════════════════════════════════════════
-- Additive follow-up to 20260810_creative_studio_video_settings.sql, same
-- pattern (add column if not exists — safe against a table that already
-- exists live). No check constraint, matching duration/resolution on the
-- same table: new models get added to the picker (src/components/studio/
-- videoModels.js) more often than a constraint would be worth keeping in
-- sync with.
--
-- Why: the video model picker (Seedance 2.0/2.5, Kling, Veo, Hailuo) has
-- sent its choice in the webhook payload since the picker shipped, but
-- nothing on creative_versions recorded WHICH model rendered a given clip.
-- Without this column, the 🔄 re-render action can't replay the exact model
-- that made a past render — it silently fell back to Seedance 2.0 every time.
-- ════════════════════════════════════════════════════════════════════════

alter table public.creative_versions add column if not exists model text not null default 'seedance-2';
