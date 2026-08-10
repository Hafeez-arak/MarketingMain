-- ════════════════════════════════════════════════════════════════════════
-- Creative Studio — prompt → 2 candidate images (GPT Image + Nano Banana
-- Pro) → pick one → unlimited edit rounds → optional video, all as a chat
-- thread the marketer can scroll back through.
--
-- Two tables, deliberately NOT reusing plan_ideas: a plan idea is one
-- planned *post* (topic, date, caption, hashtags) whose media is a
-- by-product. A creative session is the opposite — the ASSET is the
-- deliverable and there may be no post, no date and no caption at all.
-- Forcing one onto the other would mean nullable-everything on both sides.
--
-- The version row is the unit of everything: each generated candidate,
-- each AI edit, each text-overlay export and each video render is one row,
-- chained by parent_version_id. That single shape is what makes "keep
-- editing until I'm happy" work — history is never overwritten, so any
-- earlier version stays selectable/downloadable forever.
--
-- n8n authenticates with the service_role key (RLS bypassed), so the
-- policies below only need to serve the browser client.
--
-- Run ONCE in the Supabase SQL editor. Idempotent + additive.
-- ════════════════════════════════════════════════════════════════════════

-- ── Sessions ───────────────────────────────────────────────────────────
create table if not exists public.creative_sessions (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  created_by     uuid references auth.users(id) on delete set null,
  title          text default '',                    -- auto-filled from the first prompt

  -- What the marketer set out to make. Informational only — it picks the
  -- opening step and nothing else. An 'image' session can still animate
  -- later and a 'video' session can still add an image round, because the
  -- team explicitly works all three ways (image only / video only / both).
  intent         text not null default 'image'
                 check (intent in ('image', 'video', 'image_video')),

  aspect_ratio   text not null default '1:1',
  status         text not null default 'active' check (status in ('active', 'archived')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists creative_sessions_ws_idx on public.creative_sessions(workspace_id, created_at desc);

alter table public.creative_sessions enable row level security;

drop policy if exists creative_sessions_rw on public.creative_sessions;
create policy creative_sessions_rw on public.creative_sessions
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));


-- ── Versions (the chat thread + the version tree) ───────────────────────
create table if not exists public.creative_versions (
  id                uuid primary key default gen_random_uuid(),
  session_id        uuid not null references public.creative_sessions(id) on delete cascade,
  -- Denormalised from the session so RLS and workspace filtering never need
  -- a join (every other content table in this schema does the same).
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,

  -- Chat position. A generate round inserts TWO rows sharing one `round`
  -- (one per provider) so the UI can render them side by side; edits and
  -- renders get their own later rounds.
  round             int  not null default 0,
  parent_version_id uuid references public.creative_versions(id) on delete set null,

  kind              text not null
                    check (kind in ('generate', 'edit', 'overlay', 'canva', 'video')),
  -- '' for kinds with no model behind them (overlay is drawn in-browser,
  -- canva is round-tripped through their editor).
  provider          text not null default ''
                    check (provider in ('openai', 'gemini', 'seedance', 'manual', '')),

  user_prompt       text default '',            -- what actually produced this step (may be AI-enhanced)
  -- Prompt-enhancement provenance. `user_prompt` is what was actually sent to
  -- the model; `original_prompt` is what the human typed before any rewrite,
  -- kept so a version card can show "enhanced from: warm lobby shot" instead
  -- of losing their own words. Empty/'raw' when nothing was enhanced.
  original_prompt   text default '',
  prompt_source     text not null default 'raw'
                    check (prompt_source in ('raw', 'enhanced', 'enhanced_edited')),
  reference_url     text default '',            -- their uploaded reference, if any
  reference_notes   text default '',            -- "same pose, different colours"

  image_url         text default '',
  video_url         text default '',
  media_type        text not null default 'image' check (media_type in ('image', 'video')),
  aspect_ratio      text default '',

  -- Text boxes for kind='overlay', kept as data rather than only as baked
  -- pixels. This is what makes overlay text re-editable forever: reopening
  -- an overlay version loads the PARENT's clean image plus this state, so a
  -- typo fix six versions later never means redrawing from scratch.
  overlay_state     jsonb,

  status            text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  error             text default '',

  is_selected       boolean not null default false,   -- the candidate the marketer chose
  is_final          boolean not null default false,   -- pushed to the Media Library

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists creative_versions_session_idx on public.creative_versions(session_id, round, created_at);
create index if not exists creative_versions_ws_idx      on public.creative_versions(workspace_id);
-- The frontend polls "anything still pending in this session?" every few
-- seconds while a round runs; keep that lookup off a full scan.
create index if not exists creative_versions_pending_idx on public.creative_versions(session_id)
  where status = 'pending';

alter table public.creative_versions enable row level security;

drop policy if exists creative_versions_rw on public.creative_versions;
create policy creative_versions_rw on public.creative_versions
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));


-- ── Storage bucket ─────────────────────────────────────────────────────
-- Public read: these URLs are handed straight back to fal as the input of
-- the next edit/animate step, exactly like brand-assets and schedule-uploads.
insert into storage.buckets (id, name, public)
values ('creative-studio', 'creative-studio', true)
on conflict (id) do nothing;

drop policy if exists "creative-studio read"   on storage.objects;
create policy "creative-studio read"   on storage.objects
  for select using (bucket_id = 'creative-studio');

drop policy if exists "creative-studio insert" on storage.objects;
create policy "creative-studio insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'creative-studio');

drop policy if exists "creative-studio update" on storage.objects;
create policy "creative-studio update" on storage.objects
  for update to authenticated using (bucket_id = 'creative-studio');

drop policy if exists "creative-studio delete" on storage.objects;
create policy "creative-studio delete" on storage.objects
  for delete to authenticated using (bucket_id = 'creative-studio');
