-- ════════════════════════════════════════════════════════════════════════
-- Media Library: record what shape a picture is
-- ════════════════════════════════════════════════════════════════════════
-- A carousel went out to Instagram with a 1239 × 488 slide in it and came
-- back refused: "Aspect ratio 2.5389:1 is outside Instagram's allowed range
-- (0.5625 to 1.91)." The refusal arrived from Zernio after the row had been
-- claimed as pending_publish — and draft_status only ever closes from n8n, so
-- the spinner outlived the error.
--
-- Nothing in the app could have caught it, because nothing in the app knew
-- how big the picture was. src/lib/composerMedia.js#toComposerMedia has
-- carried `width` and `height` since it was written; both were always null,
-- because there was nowhere for them to come from. This is that somewhere.
--
-- Deliberately nullable, with no backfill. A row written before today has a
-- file in a bucket this migration cannot open, and inventing a 0 would make
-- "we never measured it" indistinguishable from "it is 0 pixels wide" — the
-- second of which the composer would refuse. Old rows stay null and are
-- measured in the browser when they are picked; see toComposerMedia.
--
-- Run ONCE. Idempotent — safe to re-run, drops nothing.
-- ════════════════════════════════════════════════════════════════════════

alter table public.media_library
  add column if not exists width  integer,
  add column if not exists height integer;

comment on column public.media_library.width is
  'Natural pixel width. Null on rows written before 2026-09-20, and on video.';
comment on column public.media_library.height is
  'Natural pixel height. Null on rows written before 2026-09-20, and on video.';

-- ════════════════════════════════════════════════════════════════════════
-- Done. Not a constraint: a platform''s accepted range is a publish-time
-- question about one post on one platform, not a property of an asset. The
-- same 1.91:1 banner is legal on an Instagram feed post and wrong in a 4:5
-- carousel, and the library holds both.
-- ════════════════════════════════════════════════════════════════════════
