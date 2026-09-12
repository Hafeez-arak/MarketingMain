-- ─── The agent's memory ────────────────────────────────────────────────────
-- Run this by hand against Supabase. Nothing in this repo applies it.
-- Until it is applied the memory code degrades to "no memory" rather than
-- erroring, so the app keeps working either way.
--
-- Two tables, and the split is the point:
--
--   agent_notes   append-only LOG. Every fact worth keeping, one row, forever.
--   agent_digest  DERIVED. The compacted notebook that rides in the prompt.
--
-- The digest is rebuildable from the log. That is not tidiness — a lossy
-- summariser that silently drops a real constraint ("never use discounts")
-- would otherwise destroy it with no way back.

-- ── The log ────────────────────────────────────────────────────────────────
create table if not exists public.agent_notes (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,

  -- What kind of thing this is. Drives how the digest renders it and what
  -- survives compaction: a correction outlives an observation.
  kind          text not null check (kind in (
                  'idea_proposed',   -- we suggested this; do not suggest it again
                  'idea_outcome',    -- what happened to one (used / rejected / ignored)
                  'correction',      -- the person told us we were wrong
                  'constraint',      -- a standing rule about how they work
                  'fact',            -- established, and not cheaply re-derivable
                  'question_asked',  -- a topic they have raised before
                  'run_headline'     -- what a run concluded
                )),

  body          text not null,

  -- Normalised form, for the code-level duplicate check. Two ideas that differ
  -- only in wording must collide here, or the anti-repetition guarantee is
  -- just a polite request to the model.
  fingerprint   text not null,

  source        text not null check (source in ('run', 'chat', 'human')),
  source_id     uuid,          -- run id or chat id, when there is one

  -- Lifecycle. 'folded' means the digest already carries it; 'dropped' means
  -- compaction let it go. Neither deletes the row.
  status        text not null default 'new' check (status in ('new', 'folded', 'dropped')),

  -- How often this has come back up. Drives what survives compaction: a thing
  -- that keeps mattering should outlive a thing mentioned once.
  seen_count    int not null default 1,

  -- Null means evergreen, NOT expired. Every consumer must treat the two
  -- differently or undated notes sort to the top as overdue.
  expires_at    timestamptz,

  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

create index if not exists agent_notes_ws_kind_idx
  on public.agent_notes (workspace_id, kind, created_at desc);

-- The duplicate check runs on every proposed idea, so it must be indexed.
create index if not exists agent_notes_ws_fingerprint_idx
  on public.agent_notes (workspace_id, fingerprint);

create index if not exists agent_notes_status_idx
  on public.agent_notes (workspace_id, status);

-- Full-text recall. This is the retrieval layer; swapping in pgvector later
-- replaces this index and nothing above it.
create index if not exists agent_notes_body_fts_idx
  on public.agent_notes using gin (to_tsvector('english', body));

-- ── The derived digest ─────────────────────────────────────────────────────
create table if not exists public.agent_digest (
  workspace_id  uuid primary key references public.workspaces(id) on delete cascade,

  -- The rendered notebook. Hard-capped in code, not here — the cap is a token
  -- count, which Postgres cannot measure.
  digest        text not null default '',

  -- Measured at write time so the cap is enforced rather than hoped for.
  approx_tokens int not null default 0,

  -- Which notes are already folded in, so a rebuild is idempotent and a
  -- concurrent run cannot double-count.
  built_through timestamptz,
  built_at      timestamptz not null default now(),
  build_error   text not null default ''
);

-- ── Row-level security ─────────────────────────────────────────────────────
-- RLS here scopes by MEMBERSHIP, not by workspace. The operators belong to all
-- three workspaces, so this passes every workspace's rows at once — every
-- query in application code must still carry its own workspace_id filter.
-- See the `workspace-isolation-model` memory. RLS is not isolation here.
alter table public.agent_notes  enable row level security;
alter table public.agent_digest enable row level security;

drop policy if exists agent_notes_member on public.agent_notes;
create policy agent_notes_member on public.agent_notes
  for all to authenticated
  using (
    exists (
      select 1 from public.workspace_members m
      where m.workspace_id = agent_notes.workspace_id
        and m.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.workspace_members m
      where m.workspace_id = agent_notes.workspace_id
        and m.user_id = auth.uid()
    )
  );

drop policy if exists agent_digest_member on public.agent_digest;
create policy agent_digest_member on public.agent_digest
  for all to authenticated
  using (
    exists (
      select 1 from public.workspace_members m
      where m.workspace_id = agent_digest.workspace_id
        and m.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.workspace_members m
      where m.workspace_id = agent_digest.workspace_id
        and m.user_id = auth.uid()
    )
  );
