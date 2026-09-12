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
      ⚠️ **NOT YET APPLIED.** The user must run it by hand. Until then
      `agent_notes` / `agent_digest` do not exist and every memory read must
      degrade to "no memory" rather than throwing.
- [x] **2. Pure logic + tests** — `src/lib/agent/memory.js` + `memory.test.js`.
      Fingerprinting with light stemming, near-duplicate detection, digest
      rendering, token-capped compaction, note shapes, volatile tail. No
      network. **54 tests.** Similarity separation measured on the real ideas:
      lowest true match 0.714, highest false match 0.167, threshold 0.6.
- [ ] **3. Digest builder** — `api/agent/_memory.js`: read notes → compact
      (Sonnet, new `remember` job in `models.js`) → write `agent_digest`. Must
      never throw; a failure leaves the previous digest in place. Also needs
      `recordNotes()` for the write side.
- [ ] **4. Write path — runs** — after a run, record proposed ideas, headline
      and dated findings as notes. Hook into `api/agent/run.js` after persist.
- [ ] **5. Read path — into the cached block** — `api/agent/_context.js` loads
      the digest and appends it to the brand block for BOTH run and chat. The
      volatile tail goes on the user turn, never here.
- [ ] **6. Anti-repetition** — feed prior ideas to the synthesiser AND run
      `partitionRepeats()` over what it returns, in `_investigate.js`. Both
      halves: the prompt is the request, the code is the enforcement.
- [ ] **7. Lens tools** — give lenses `get_memory` / `get_prior_research`
      (currently they get web search only, in `_lenses.js`).
- [ ] **8. Write path — chat** — extract decisions/corrections at thread end;
      cross-thread continuity so the drawer feels like ChatGPT.
- [ ] **9. `search_history` tool** — full-text recall over notes/runs/messages.
- [ ] **10. Verify live + PR.**

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
