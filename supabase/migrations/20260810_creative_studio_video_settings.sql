-- ════════════════════════════════════════════════════════════════════════
-- Additive follow-up to 20260810_creative_studio.sql, same pattern as
-- 20260810_creative_studio_prompt_source.sql (add column if not exists —
-- safe against a table that already exists live).
--
-- Why: the one-click "re-render with the current image" action (BranchChat's
-- 🔄 button) needs to replay a past video render's exact prompt, duration,
-- resolution and audio choice against a NEW base image, without asking the
-- user to re-enter them. Nothing on creative_versions recorded those before
-- this — aspect_ratio was the only render setting kept.
-- ════════════════════════════════════════════════════════════════════════

alter table public.creative_versions add column if not exists duration text default '';
alter table public.creative_versions add column if not exists resolution text default '';
alter table public.creative_versions add column if not exists generate_audio boolean not null default false;
