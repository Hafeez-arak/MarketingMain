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

SQL lives in `supabase/migrations/` alongside every other migration:

- `20260912_agent_memory.sql` — `agent_notes`, `agent_digest`
- `20260912_research_lens_results.sql` — one row per (run_id, lens)

Both were **applied 2026-09-12**. Nothing in this repo applies them; they are
run by hand. Until they are, the memory code degrades to "no memory" rather
than erroring — that is the whole safety story, and it is verified.

---

## Progress

- [x] **0. Plan + handoff file** — this document.
- [x] **1. Migration SQL written** — `supabase/migrations/20260912_agent_memory.sql`: `agent_notes`,
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

---

# Part two: splitting the run so it fits on Hobby

**Decided 2026-09-12.** Separate from the memory work above; same branch.

## The problem

`api/agent/run.js` awaits everything in ONE HTTP request: gather → six lenses
→ synthesis → persist → memory. Vercel kills the function at the ceiling,
mid-run, and the browser's spinner never closes because only the server closes
it (`draft-status-is-one-way`).

**The project is on Vercel Hobby: 300s, and it CANNOT be raised.** Pro would
allow 800s; Hobby does not. Confirmed against the plan table in the
`vercel:vercel-functions` skill.

Measured, and the variance is the finding: a single calendar lens took **49s,
then 380s, then 380s**. A full six-lens run has never been profiled end to end
because it costs real money. So:

- Splitting per phase is necessary but **not sufficient** — one lens alone
  exceeded 300s twice.
- Therefore every lens also needs a **wall-clock budget**, so the run is
  bounded by construction rather than by hope. This is the part that holds on
  any platform and at any plan tier.

## The shape

Three routes, each short. n8n drives them — it is already up 24/7 on a
permanent ngrok URL (`n8n-runs-off-mac`), and using it here ALSO fixes the
missing weekly schedule, which has no `crons` entry anywhere.

```
n8n weekly trigger
  ├─ POST /api/agent/run          stage 0 only → run_id     target <60s
  ├─ POST /api/agent/lens   ×6    one lens each, parallel   budgeted
  └─ POST /api/agent/synthesise   brief + persist + memory  target <120s
```

**Logic stays in TypeScript.** n8n orchestrates and retries; it does not think.
Moving the logic into Code nodes would discard 680 tests, the provider seam
that guarantees the ledger, and the workspace-isolation tests — and the
2026-09-09 pivot deliberately went the other way. n8n calling the *existing*
`/api/agent/run` would fix nothing, because the Vercel function is what times
out.

## Decisions

| Decision | Answer | Why |
|---|---|---|
| Where lens results live | New table `research_lens_results`, one row per (run_id, lens) | Six parallel lenses writing into one jsonb column is a read-modify-write race. Separate rows cannot race at all. |
| Auth for n8n | Bearer `AGENT_RUN_SECRET`, timing-safe compare, **required** | These routes currently need a user JWT via `callerId`. n8n has none. Must never default to open when the env var is unset. |
| Lens time budget | Wall-clock deadline per lens, returns what it has | A lens already never throws; making it also never overrun makes the whole run predictable. Essential on Hobby. |
| Resumability | `/lens` is idempotent per (run_id, lens); `/synthesise` works with whatever lenses landed | A timed-out lens should cost one retry, not the run. `lensSummary` already reports which ran. |

## Progress — part two

- [x] **A. Migration** — `research_lens_results`. ✅ applied to
      `vxjhfvehccftvajgtqtv` 2026-09-12.
- [x] **B. Pure logic + tests** — `src/lib/agent/phases.js` + `phases.test.js`,
      **31 tests**.
- [x] **C. Deadline in `callModel`** — `deadline` (absolute epoch ms) aborts the
      stream via AbortController; refuses to START a call with under 15s left,
      since that buys an aborted generation that still bills. The ledger is
      written on the timeout path too. `timedOut` travels with the result so a
      caller can tell "stopped by us" from "broke".
- [x] **D. `run.js` stops after stage 0** and returns `next.lenses`.
- [x] **E. `api/agent/lens.js`** — one lens, idempotent per (run_id, lens).
- [x] **F. `api/agent/synthesise.js`** — 409 + the names of outstanding lenses
      while any are pending; every other path writes a terminal status.
- [x] **G. Service auth** — `api/agent/_serviceAuth.js`. Bearer
      `AGENT_RUN_SECRET`, timing-safe, and an UNSET secret denies.
- [x] **H. n8n workflow** — `n8n/agentRun.workflow.json`. 11 nodes, no dangling
      refs. Needs `AGENT_BASE_URL` and `AGENT_RUN_SECRET` in n8n's environment.
- [x] **I. Verified** — see below. **Not yet run end to end against live
      models**, because a full six-lens run costs real money; the mechanism is
      verified, the loop is not.

### Verified, part two

```
every new module loads under plain Node        OK  (6/6)
service auth: correct secret                   200 as=service
service auth: wrong / prefix / missing / bare  401  (all four denied)
loadRunContext against the live run            motion=specification, 5 lenses
brand block                                    8,419 chars, carries memory
budgets vs the 300s Hobby ceiling              gather 120s · lens 150s · synth 180s
upsert by (run_id, lens)                       wrote twice -> 1 row  idempotent
```

**Bug the probe caught:** the first upsert appended instead of replacing.
PostgREST resolves `merge-duplicates` against the PRIMARY KEY, which here is a
generated uuid that never collides — the (run_id, lens) uniqueness has to be
named explicitly as `?on_conflict=run_id,lens`. Without it every retry would
have added a second result for the same lens.

### Still to do

- Set `AGENT_RUN_SECRET` in **both** Vercel and n8n (same value), and
  `AGENT_BASE_URL` in n8n.
- Import `n8n/agentRun.workflow.json` and activate it.
- The browser's "run now" button now only starts stage 0. The page polls
  `research_runs`, so it will sit at `stage=lenses` forever unless n8n is
  driving. Either activate the workflow, or add a client-side driver.
- Profile a real end-to-end run and tune `PHASE_BUDGET_MS` against
  `research_lens_results.duration_ms`, which is recorded for exactly this.

---

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

---

# Part three: the lens rebalance

**Decided and built 2026-09-12**, same branch. Part two made the run *fit*.
This part is about it finding anything.

## The problem

The 2026-09-12 run completed cleanly, cost $0.44, and reported almost nothing:
four of five lenses returned zero findings. The obvious reading was that the
searching was broken.

**It was not.** Probed against `research_lens_results.sources`:

```
demand    36 sources read -> 0 findings
openings  37 sources read -> 0 findings
rivals    26 sources read -> 0 findings
```

99 pages, from MEED, Construction Week, MEP Middle East, Arab News, Bayt,
Glassdoor and the competitors' own sites. The lenses read the right things and
then said nothing about them.

## The cause, proven by A/B

The shared `CLOSING` block told every lens:

> "Return an empty findings array if you found nothing worth reporting. That is
> a correct and common answer. Do not pad."

It was written to stop padding. It was obeyed literally. A/B on the same week,
same lens, same sources, with only those lines changed:

```
before   0 findings, 37 sources
after    3 findings, 20 sources
```

One of the three was a **300-key Waldorf Astoria conversion sitting in DESIGN
phase** — a live specification window, in the sources the whole time, discarded
by an instruction.

The mistake was asking for a binary report/don't-report decision when the
schema already carries `confidence`. Anything under the model's private bar
became silence, and **a reader can discount a 0.35; they cannot discount
nothing.** Silence is also indistinguishable from never having looked.

## What changed

| | before | after |
|---|---|---|
| `CLOSING` | "empty is a correct and common answer" | "REPORT WHAT YOU FOUND — that is what the confidence score is for" |
| `calendar` | computed dates + a model call | **computed only, no model call, $0** |
| `openings` | 6 searches, "recent only" | 8 searches, window-still-open logic, absorbs trade shows |
| `demand` | complaints about competitors | **buyers directly** — relabelled "Buyers" |
| `category` | did not exist | **new** — regulation, standards, procurement policy |
| `rivals` | weekly | **monthly** |
| market | `customFields.geography`, empty everywhere | `marketOf()` resolves from prose, reaches every lens |

Weekly is now **5 lenses / 20 searches / 3 model calls**; monthly is 7 / 28 / 5.

### Why the calendar lost its model call

It was a hybrid: computed dates, then a model asked what the brand should DO
about them and which trade shows were coming. On the run that prompted this,
that half hit its 150s budget, was **stopped, billed $0 and produced nothing**,
while the free computed half produced the only real finding in the brief. Twice
in two runs is a shape, not bad luck. Both jobs moved:

- *"what should we do about this date"* → **synthesis**, which already reads
  every finding with the brand context in front of it and was doing this
  unprompted. `SYNTHESISE_PROMPT` now says so explicitly, and says the computed
  `suggested_action` is a placeholder to replace.
- *"which trade shows"* → **openings**, which already searches this market for
  dated events.

`mergeCalendarResult` was deleted with it. The guarantee it defended —
*computed dates survive a model failure* — is now structural rather than
defended: there is no model call left to fail. The tests assert the structure.

### The bug this nearly shipped

Demoting `rivals` to monthly silently meant **never**. The n8n driver hardcoded
`cadence: 'weekly'` on the run call and sent **no cadence at all** to
`/api/agent/lens` and `/api/agent/synthesise`, each of which defaults to weekly
on its own. Three independent defaults.

Worse, it would not have failed loudly: `/api/agent/lens` refuses a lens the run
does not include, so a monthly run would have been rejected one lens at a time
with *"this run does not include a rivals lens"* — an error pointing at the lens
set rather than at the plumbing.

Fixed: `/api/agent/run` returns the cadence it used, the driver carries it to
every later call, and "Which brands" runs the monthly set on the first Monday of
each month. `n8n/agentRunWorkflow.test.js` is new and guards all of it —
dangling `$('node')` refs included, since n8n returns `undefined` for a missing
node rather than throwing.

## Verified

```
tests                                    723 passing (31 files)
lint                                     clean except the known researchRun.test.js error
plain-node import of every changed file  7/7 OK
weekly plan (Arak)                       openings, calendar, demand, ourselves, category
monthly plan (Arak)                      + rivals, craft
calendar via the real runSingleLens      2.1s, $0, 1 finding, status ok
  (was 151s, timed out, $0, nothing)
rivals on a weekly run                   correctly refused
lens='category' insert                   no CHECK constraint blocks it
throwaway probe run                      deleted, lens rows cascaded
```

**Not yet run end to end against live models** — the same caveat as part two. A
full run costs real money; the wiring is verified, the model output of the three
rewritten prompts is not, beyond the openings A/B.

## Still to do

- Everything in part two's "Still to do" is unchanged: `AGENT_RUN_SECRET` in
  both Vercel and n8n, `AGENT_BASE_URL` in n8n, import and activate the
  workflow. **No run has ever had `trigger='scheduled'`** — the cron has never
  fired.
- Re-import `n8n/agentRun.workflow.json`: one node was renamed
  (`Wait for all six` → `Wait for every lens`) and four now carry cadence.
- Profile a real monthly run — seven lenses has never been executed.
- `research_agenda` standing questions still never reach a lens; they are only
  shown to synthesis, which has no search tool. That is the next real gap.
