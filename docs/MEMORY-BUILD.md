# The agent's memory — build plan and handoff

**Branch:** `worktree-agent-calendar` · **Started:** 2026-09-12

This file exists so the work survives a context limit. If you are picking this
up cold: read **Decisions** (they are settled, do not relitigate them), then
find the first unchecked part in **Progress** and continue from there. Update
the checkbox and the notes when you finish a part.

---

## The problem, in the user's words

> "when the agent runs for the first time, it is like do this and this, and the
> next run also gives almost very generic or same ideas … the memory should be
> stored somewhere, with a reset or summary of prev conversations, exactly like
> ChatGPT or Claude browser chats that knows the context and memory of the
> user, but in a better way."

Two surfaces need it: the **weekly research run** and the **chat** (both the
⌘K drawer and the `/agent` page — they share one thread).

Three things it must do:

1. **Never re-propose what it already proposed.** Enforced in code, not by
   asking the model nicely.
2. **Say "we already did X"** when asked about something covered before.
3. **Feel continuous in chat** — like talking to something that remembers you,
   across threads, not just within one.

### The evidence this is real

Two consecutive runs proposed, with no awareness of each other:

```
Run 1:  "Inside our Riyadh partner floor: 20+ certified brands, one room"
        "The guest turns one dial and the room answers"
Run 2:  "Ritz Carlton Riyadh — what a luxury hospitality fit-out requires"
        "KNX and GRMS: what hotel operators are actually specifying"
```

Those live inside `research_runs.report` (jsonb) and are written nowhere
durable. Nothing reads them back. Run 3 would re-suggest them.

---

## Decisions (settled — do not reopen)

| Decision | Answer | Why |
|---|---|---|
| RAG / embeddings? | **No.** Text digest + Postgres full-text search. | Corpus is ~16 rows; after 2 years ~100 runs. It fits in one prompt. Embeddings solve "corpus won't fit", which is years away. Schema is shaped so swapping in pgvector later is a retrieval-layer change only. |
| Threshold to revisit | Digest can't stay under ~2,000 tokens without losing things that matter (realistically a few thousand notes). | |
| What gets recorded | Decisions, corrections, constraints, proposed ideas + their fate, facts that can't be re-derived. **Not** questions, pleasantries, or anything already in the DB. | User: "only what is necessary". |
| Summariser model | **Sonnet**, via a new `remember` job. | `models.js` documents a deliberate 2026-09-09 decision against a third (Haiku) tier. Compaction runs ~10×/month; the saving does not justify reopening it. User approved a cheap model "only if we need to". |
| Update cadence | Digest rebuilds on **run end** and **thread end**. Newer facts ride as a small volatile tail on the user turn. | The digest lives in the **cached** system block. Changing it per-message breaks the prefix cache — ~10× cost on the whole prefix, silently. This is the one hard constraint in the design. |

### The cache constraint, spelled out

`src/lib/agent/prompt.js` renders `tools → system → messages` with the cache
breakpoint on the last stable system block. The digest goes **inside** that
cached block. Measured from a real lens call: `input_tokens: 62912`,
`cache_read_input_tokens: 39442`. A 1,200-token digest is ~2% of that at
cache-read rates — negligible.

It is only negligible **while it stays byte-stable**. Anything that changes the
digest per-message turns a cached prefix into a fresh one every turn. So:
digest = slow cadence, byte-stable; fresh facts = volatile tail on the user
turn (see `contextPreamble` in `prompt.js` for the existing pattern).

---

## Architecture

Two tiers.

**Tier 1 — the digest.** One row per workspace, hard-capped ~1,200 tokens,
loaded into the cached brand block by both surfaces. Holds: ideas already
proposed (+ fate), active rules, corrections the person gave, last 2–3 run
headlines, the rejected list.

**Tier 2 — recall on demand.** `get_memory` and `get_prior_research` already
exist (`src/lib/agent/tools.js`) — the lenses simply are not given them. Plus a
new `search_history` doing Postgres full-text search over notes, past runs and
chat messages.

**The log / derived split.** `agent_notes` is an append-only log;
`agent_digest` is derived from it and rebuildable. This matters: a lossy
summariser that silently eats a real constraint is otherwise unrecoverable.

---

## Schema (migrations are applied BY HAND — see memory `campai-console-noise-and-migrations`)

SQL lives in `docs/memory-schema.sql`. It must be run against Supabase manually;
nothing in this repo applies it. Until it is run, the memory code degrades to
"no memory" rather than erroring — verify that, it is the whole safety story.

---

## Progress

- [x] **0. Plan + handoff file** — this document.
- [x] **1. Migration SQL written** — `docs/memory-schema.sql`: `agent_notes`,
      `agent_digest`, indexes, RLS. Table names verified against the live
      database (`workspace_members` exists with `workspace_id`/`user_id`).
      ✅ **APPLIED 2026-09-12** to project `vxjhfvehccftvajgtqtv`. Before it was applied,
      `agent_notes` / `agent_digest` do not exist and every memory read must
      degrade to "no memory" rather than throwing.
- [x] **2. Pure logic + tests** — `src/lib/agent/memory.js` + `memory.test.js`.
      Fingerprinting with light stemming, near-duplicate detection, digest
      rendering, token-capped compaction, note shapes, volatile tail. No
      network. **54 tests.** Similarity separation measured on the real ideas:
      lowest true match 0.714, highest false match 0.167, threshold 0.6.
- [x] **3. Digest builder** — `api/agent/_memory.js`. `recordNotes()`
      (de-duplicates by fingerprint, bumps `seen_count` instead of inserting a
      second row), `rebuildDigest()`, `loadMemory()`, `priorIdeas()`.
      Two-stage: renders in CODE first and only pays for the Sonnet `remember`
      job when that overflows the budget — most weeks it does not, and those
      weeks cost nothing. A compaction that does not actually shrink the digest
      is rejected in favour of the code render.
- [x] **4. Write path — runs** — `rememberRun()` + forced `rebuildDigest()` in
      `api/agent/run.js`, after `persist`. Neither can fail the run.
- [x] **5. Read path — into the cached block** — `api/agent/_context.js`
      appends the digest to `brand`, and returns `recallTail` separately. The
      tail is volatile and goes on the user turn; concatenating it into `brand`
      would put per-minute bytes inside the cached prefix.
- [x] **6. Anti-repetition** — both halves, in `_investigate.js`: prior ideas
      go to the synthesiser AND `partitionRepeats()` runs over what it returns.
      Repeats are moved to `report.repeated_ideas`, never silently deleted.
- [x] **7. Lens tools** — **satisfied without a tool loop, deliberately.** The
      lenses already receive `brand`, which now carries the digest; and
      `brand_memory` rules were already in the brand context via
      `buildContext`. Adding a client-side tool-execution loop to `runLens`
      would add round-trips to a path that already took 380s in one measured
      run, to fetch what is now in the prompt. Revisit only if a lens needs
      memory the digest does not carry.
- [x] **8. Write path — chat** — `rememberChat()` in `_memory.js`, called from
      `chat.js` after the answer has streamed. Runs every `EXTRACT_EVERY` (6)
      assistant turns, not every turn: a call per message would roughly double
      the cost of chat to record something on maybe one turn in ten. Chat
      already shared one persisted thread per workspace, so cross-surface
      continuity (drawer ↔ `/agent`) was already there — what was missing was
      anything crossing OUT of a thread, which the digest now does.
- [ ] **9. `search_history` tool** — **deliberately deferred.** Same argument
      as RAG, one scale down: the whole corpus renders to a 528-token digest
      that is already in every prompt. Full-text search over 13 notes retrieves
      what the model can already see. Build it when the digest starts dropping
      notes (`rebuildDigest` returns `dropped > 0`) — that number is the
      trigger, and it is reported.
- [x] **10. Verified live.** See below.

### Verified live, 2026-09-12

Migration applied to project `vxjhfvehccftvajgtqtv` (confirmed against
`SUPABASE_URL` before applying). Backfilled from the five real runs already in
the database:

```
13 notes:  5 idea_proposed · 5 run_headline · 3 fact
digest  :  528 approx tokens, 0 dropped, $0.00 (fit without the summariser)
```

The test that matters — replaying what run 2 proposed, as if run 3:

```
proposed 3, kept 1, caught 2 as repeats
  BLOCKED  "KNX and GRMS: what hotel operators are actually specifying"
  BLOCKED  "What hotel operators actually specify when it comes to GRMS and KNX"
  ALLOWED  "A genuinely new angle: the procurement calendar for Q1 tenders"
```

The second BLOCKED line is the whole point: that is the reworded form, which a
prompt alone does not catch.

Brand block grew 6,308 → 8,419 chars and `prefixRisk()` still reports safe.

### Notes for whoever continues

- Run tests: `npx vitest run` from the worktree root. **680 passing** after part 2.
- Lint: `npx eslint .` — there is ONE pre-existing error in
  `n8n/researchRun.test.js` (a `useTool` helper the React plugin misreads). Not
  yours; ignore it.
- `.env` is copied into the worktree already. `SUPABASE_URL` must be set from
  `VITE_SUPABASE_URL` when running probe scripts under plain Node.
- Probe scripts from this session live in `/Users/junaid/.claude/jobs/492f8123/tmp/`.
- **Trap:** `import.meta.env` does not exist under Node. Anything `api/` imports
  must come from a `*Core.js`-style pure module. `nodeBoundary.test.js` guards
  this — run it.
- **Trap:** `Number(null)` is `0` and `isFinite(0)` is `true`. This codebase has
  been bitten three times. Use a `num()` helper returning `null`.
- **Trap:** `brand_memory.source` has a CHECK constraint — `'agent'` is NOT an
  allowed value, `'research'` is. Same for `generated_posts.source`.
- Do NOT add `workspace_id` as a tool parameter. The executor injects it from
  the verified session; `tools.test.js` asserts no tool exposes it.
