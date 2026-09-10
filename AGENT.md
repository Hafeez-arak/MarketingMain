# The Agent

Architecture for the assistant behind the whole product. Written before code,
same as `RESEARCH-AGENT.md` was, so the shape can be argued with while it is
still cheap to change.

`RESEARCH-AGENT.md` is not superseded. It designed the weekly research run
down to the stage, and stages 0–5 are built and tested against it. This
document is the layer above: what happens when that run stops being a feature
on one page and becomes one capability of an assistant that is reachable
everywhere and knows the whole organisation.

Read §§4–8 of `RESEARCH-AGENT.md` for how a run works internally. Nothing
here changes it.

---

## 1. The reframe

The ask was: *build the research agent properly, it should run and give its
suggestions, and we should be able to interact with it anywhere in the system
and get ideas and insights — it has all the information about our company.*

That is two things, and `RESEARCH-AGENT.md` only designed the first:

1. **A weekly research run** — batch, async, minutes long, produces a brief
   with real numbers in it. Built.
2. **An always-available assistant** — seconds long, conversational, reachable
   from every page, and knowledgeable about the whole org rather than just the
   market. Not built, and the more valuable of the two.

They are not two agents. They are one agent with one tool belt and one view of
the organisation, invoked two ways. The weekly run is the assistant executing
a long standing instruction on a schedule; the chat is the assistant answering
now. Building them separately would mean two context pipelines, two sets of
prompts, and two places for the brand's ground truth to drift — which is the
exact failure `brandContext.js` exists to prevent.

**So: one agent. Research is a capability, not an identity.**

---

## 2. One agent, many organisations

Three workspaces exist today — Arak Lighting, Aqeeq, Alo Kheyatah — and more
will. There is **one agent implementation**. It is not written three times and
not configured three times.

The org *is* its database. Every invocation resolves a `workspace_id` first,
and everything the agent knows for that turn is assembled from that
workspace's rows: its Brand Brain, its rules, its posts, its analytics, its
research history. Change the id and the same code is a different brand's
assistant with different knowledge, different memory and different opinions.

**Isolation is enforced in the tool layer, not in the prompt.** Every tool
takes `workspace_id` as its first argument, from the session — never from
anything the model produced. A model that asks for another workspace's data
gets a refusal from the tool, not from its own good behaviour. RLS is a
backstop here, not the mechanism; that lesson is already written down and it
applies with more force to an agent, because an agent composes its own
queries.

There is no cross-workspace read path. Not "restricted" — absent. If sharing
a proven rule between brands is ever wanted, it gets designed then, as an
explicit human-mediated copy.

---

## 3. What the agent knows — three layers

The agent's knowledge is not one blob. It is three layers with different
freshness, different cost, and different rules.

**Layer 1 — Who we are.** Brand Brain: identity, positioning, voice, products,
prices, the competitor directory. Plus `brand_memory`, the learned rule book.
This is the stable prefix of every prompt — it changes when a human edits it,
which is rarely.

Assembled through **`buildContext` in `src/lib/brandContext.js`, and only
through it.** This is the single most important constraint in this document.
That function is already the one entry point for every brand-aware prompt in
the app; an agent that assembled its own view of the brand would be a second
source of truth, and the two would diverge silently. If the agent needs a
slice `buildContext` does not expose, we add the slice there.

**Layer 2 — What we have done.** Posts, schedule, analytics, plans, media.
Volatile, sometimes large, and queried on demand through tools — never
pre-loaded into the prompt. The agent asks for the fourteen posts it needs,
not the whole table.

**Layer 3 — What we have learned about outside.** Research runs, findings,
competitor snapshots, the agenda. Also tool-fetched.

### Retrieval: tools over SQL, not embeddings

No vector store. The data is structured and small — three workspaces, barely
any posting history — and the questions are structured too ("our carousels
versus our reels, last 90 days"). Embeddings would add a sync problem, and
worse, would blur exactly the numbers that make this agent credible. A model
that retrieves *approximately* is fine for prose and disastrous for
engagement rates.

Typed tools over Supabase queries instead. If semantic search is ever wanted
over long brand sections and past briefs, it gets added **there and only
there**, as one more tool.

---

## 4. The tool belt

`RESEARCH-AGENT.md` §5 defines the research tools and they carry over
unchanged. This is the full belt, with the new ones marked.

**Read — the brand (free, grounding, cannot fail expensively)**

| tool | returns |
|---|---|
| `get_brand_context` | identity, positioning, what we sell — via `buildContext` |
| `get_competitors` | watchlist rows: name, positioning, how we differ, url, handle |
| `get_memory` | every rule in every status, so nothing is re-proposed |
| `get_prior_research` | last N run headlines + open agenda questions |
| `get_our_performance` | our pillar/format/weekday breakdown, with sample sizes |
| `get_competitor_metrics` | the Stage-0 delta table |

**Read — the operation (new)**

| tool | returns |
|---|---|
| `get_posts` | published + drafted posts, filterable, with their analytics |
| `get_schedule` | what is queued, when, on which platform |
| `get_plans` | content plans and their ideas |
| `get_media` | what is in the media library, so ideas can reference real assets |

**Go look outside (metered)**

| tool | notes |
|---|---|
| `web_search(query)` | counted against the loop budget |
| `fetch_page(url)` | read one page properly |
| `instagram_account(handle)` | `business_discovery` — the evidence spine |
| `resolve_competitor_handle(...)` | finds and verifies a rival's handle |
| `discover_competitors()` | proposes rivals onto the watchlist, never the directory |

**Write — proposals only**

| tool | lands in | status |
|---|---|---|
| `propose_rule` | `brand_memory` | `proposed` |
| `propose_idea` | `plan_ideas` | `proposed` |
| `add_agenda_item` | `research_agenda` | `proposed` |
| `draft_post` (new) | the composer, as a draft | `draft` |

**The agent has no path to `active`, and no path to publish.** It can fill
your queue with work; it cannot spend a posting slot. Widening that later is a
permission change, not a rewrite — which is exactly why it is drawn here.

### The write boundary is unchanged and non-negotiable

`RESEARCH-AGENT.md` §5a holds in full: no tool writes to `brand_profile`,
`brand_fields`, `brand_sections`, `brand_directory_columns` or
`brand_directory_rows`, and none is ever added. What the brand *is* stays
human-authored, permanently. The one-line review check survives the move off
n8n — grep the tool definitions for those table names; there should never be a
hit outside a read.

---

## 5. Three surfaces, one brain

**a. The assistant panel — every page.** A drawer that opens anywhere, and
knows what you are looking at. Open it on a post and "why did this
underperform?" already has the post; open it on a plan and it has the plan.
The page contributes a small typed **context descriptor** (route, entity type,
entity id) — never a scrape of the DOM, never the rendered page. The agent
then fetches what it needs through tools like it would anywhere else.

One conversation thread per workspace per user, persisted. Walking from
Analytics to the Planner does not restart the conversation — this is the
difference between an assistant and a search box.

**b. `/insights/research`** — the weekly brief, run history, the editable
agenda. Laid out in `RESEARCH-AGENT.md` §11, unchanged. The Insights page
loses both of its buttons in the same change that ships this, so there is
never a window with three research paths live.

**c. Inline hooks** — later, and only if the panel earns them.

---

## 5b. The human steers it — and that is not a settings screen

The agent is not a scheduled report you receive. It is meant to sit beside
whoever is doing the work, so **everything it watches, asks and believes is
editable by a person, in the place they are already looking.**

**a. Its task list is yours to edit.** `research_agenda` is the steering
wheel — standing questions ("is anyone pushing tunnel lighting?"), the
competitor watchlist, and how often each is revisited. A person can add,
reword, pause or delete any of it, directly on the page, without a chat turn.
The rows already carry `created_by` (`human` | `agent`), so who asked for a
line is never in doubt, and `status` — a question the agent proposed sits as
`proposed` until someone accepts it.

**b. Competitors are editable, including the part the agent got wrong.** The
watchlist is not derived from the Brand Brain's directory and is allowed to
differ from it — that difference is information. A person can add a rival
nobody listed, drop one that stopped mattering, and **correct a handle by
hand**: `setHandleByHand` sets `ig_status = 'human_set'`, which the whole
downstream pipeline treats as at least as trustworthy as a verified match and
never re-resolves over. The resolver stores weak candidates deliberately so
there is something to accept or fix, rather than a blank.

**c. Saying no is remembered.** A rejected rule is not merely not-applied —
`get_memory` returns every rule in every status, so the agent can see what was
turned down and does not re-propose it next week. An assistant that asks the
same rejected question every Monday is one people stop reading.

**d. It answers about work in progress, not just about the market.** This is
the case that makes it a shadow rather than a report. A marketing person has a
carousel drafted and wants a second opinion *before* it goes out:

> *"I made this carousel for Thursday — anything wrong with it?"*

The agent reads the draft it is looking at (caption, format, platform, the
media attached), the **active rules** for that brand, **our own numbers for
that format**, and the **competitor board**, and answers with specifics — that
the caption runs past where engagement drops on carousels, that an active rule
says the Arabic line leads, that our carousels outperform our reels at n=14 so
the format choice is sound. It proposes a revised draft; it never edits the
post behind the person's back and never publishes.

One edge worth naming now rather than discovering: **an unsaved draft has no
id.** The context descriptor (§5a) carries a route and an entity id, which is
enough for a saved post and nothing for one still being typed. So for the
composer specifically, the panel passes the current draft state itself —
caption, format, platform, attached media ids. It is the one place the page
hands over content rather than a pointer, and it is deliberate: asking someone
to save a half-finished post before they can ask about it would defeat the
purpose.

That is the posture in general: **whatever is in front of the person is what
the agent is about.** The weekly run is one standing instruction it happens to
carry. Everything else is answering the question actually being asked.

---

## 6. Runtime: JavaScript in this repo, on Vercel

The agent does not go into n8n. n8n keeps Creative Studio; nothing there is
switched off and the box stays up.

**JavaScript, not TypeScript**, because this repo has no TypeScript in it — no
`tsconfig`, no dependency, and `api/n8n/[slot].js` is plain ESM. A second
language for one subsystem would buy nothing. JSDoc types where they earn it.

Four reasons, in order of weight:

1. **A chat that types its answer out needs to stream.** n8n webhooks are
   request/response — a Code node cannot stream tokens to a browser. Vercel
   functions stream on the default Node runtime with no configuration.
2. **Iteration speed is a quality input, not a convenience.** One agent change
   in n8n today is: edit a 9,545-line Python generator, regenerate JSON,
   commit, push, pull on the box, `redeploy.sh`, probe the webhook. Agent
   tuning takes dozens of iterations. That loop is where "perfect" would die.
3. **Zernio's webhooks need a real endpoint.** `post.published`,
   `post.failed`, `analytics.synced` — the app already has a Vercel domain.
   Pointing production webhooks at a free ngrok domain on a home box is the
   most fragile part of the current setup.
4. **Testing gets easier.** vitest already runs here. The agent becomes
   ordinary modules instead of Code-node strings fed through a harness.

Provider keys stay server-side exactly as the n8n proxy guarantees today. The
browser never sees one.

### The 300s problem, named

Vercel functions cap at 300 seconds. A full research run — six competitors, a
bounded web loop — can exceed that. The run is already designed async (the
browser gets a run id and polls `research_runs`), so the fix is to split it
into chained invocations rather than hold one open:

```
POST /api/agent/run      → claims the run, returns { run_id }, invokes stage 0
  stage 0  gather        → writes the board. THE NUMBERS ARE SAFE FROM HERE ON.
  stages 1–4 investigate → own invocation, may chain again on a long loop
  stage 5  persist       → writes findings, proposals, terminal status
```

Two rules this inherits, both learned the hard way and both worth more than
they look:

- **Every terminal path writes a status.** The browser opens the spinner; only
  the server closes it. A crashed invocation that writes nothing leaves a
  spinner up forever. Errors write `failed` with the message, and a run still
  `running` after 20 minutes is swept on the next page load.
- **The measured numbers survive anything.** Stage 0 commits before a single
  model token is spent. No key, unreachable model, unparseable output — the
  run still completes with the board plus a note saying what was lost. A
  failed investigation must never cost the user their numbers.

### The import boundary, found while building the spine

`buildContext` is the single entry point for brand context (§3) and the server
must go through it. It currently **cannot be imported by a Node function**:
`brandContext.js` imports React and `supabaseClient.js`, and that module reads
`import.meta.env`, which does not exist outside the Vite bundle. Node also
cannot resolve the extensionless specifiers. Verified, not assumed — a plain
`import()` of it under Node fails on `./supabaseClient`.

The chain is `brandContext → brandBrain → brandSchema → supabaseClient`, and
each of those files is a pure half plus an IO half. So the fix is the one this
repo has already made once, deliberately, for the webhook proxy: extract the
pure chain into a module **free of imports that assume a browser**, and have
the existing files re-export from it so no call site changes. `buildContext`
stays the one builder; it simply becomes loadable from both sides.

The alternative — having the browser assemble the context and post it — is
what the Insights page does today for brand research, and it is precedented.
It is rejected for the agent on two grounds: a scheduled run has no browser to
assemble anything, and client-supplied prompt content is a trust boundary that
gets harder to close the longer it stands.

### Porting out of n8n

The stage 0–5 logic already exists as Code nodes in `Arak Lighting – Research
Run`, with ~56 tests behind it. **The logic and the tests carry over; the
plumbing does not.** Port the pure functions first, run the existing tests
against them, and only then wire the HTTP. Anything that was pure in n8n
should still be pure here — that is what made it testable in the first place.

---

## 7. Cost — the design, not the price list

Model prices as of 2026-09-09, per million tokens in/out: Claude Opus 5
$5/$25, Sonnet 5 $3/$15. For reference, the alternatives that were compared:
GPT-5.6 Sol $4/$20 (promotional through at least 2026-11-21; standard $5/$30),
Kimi K3 $3/$15, GLM-5.3 $1.40/$4.40.

**The chosen split:**

**Two models only — no Haiku anywhere.** A third tier would mean a third prompt
style to maintain and a quality cliff wherever the split was drawn slightly
wrong, to save a few dollars a month on a bill that is already small.

| work | model | why |
|---|---|---|
| Research synthesis, reasoning-heavy chat | **Opus 5** | The output people act on. Leads on agentic and tool-use benchmarks, which is the only column that matters here. |
| Everything else — the long, general, time-consuming turns, and the mechanical shaped work | **Sonnet 5** | 40% cheaper, and already what 8 of the 9 existing workflow calls use. |

Every call goes through **one thin provider interface**. Swapping a stage to a
different model — or a different provider — must be a config change, not a
rewrite. Revisit in a month against the ledger, not against a blog post.

*(A note for whoever revisits it: Kimi and GLM are genuinely cheaper —
GLM-5.3's output is about a fifth of Opus 5's. Both are Chinese providers, and
using them sends brand strategy, pricing and competitor intelligence to
Moonshot or Zhipu. That is a business decision, not a technical one, and it
should be made deliberately rather than discovered.)*

### What actually drives the bill

At our volume — an estimated $1–2 per weekly run and $0.02–0.09 per chat turn,
so roughly $30–80/month across three workspaces — **the per-token price is the
wrong lever.** Four design choices dominate it:

1. **Code does the arithmetic.** Six competitors × 25 posts through a model
   every week, to compute averages, would cost more than everything else
   combined and be less accurate. Cadence, format mix and engagement-per-1k
   are computed in code. This decision is already made and it is worth more
   than any model downgrade.
2. **Prompt caching on the stable prefix.** Layer 1 plus the tool definitions
   are byte-identical for a workspace across calls. Cached reads cost ~0.1×.
   Render order is `tools` → `system` → `messages`, so stable content goes
   first and volatile content (the question, timestamps, ids) goes last. **A
   single `Date.now()` in the system prompt silently invalidates everything
   and shows up only as a bill** — so the test asserts
   `usage.cache_read_input_tokens > 0` on a repeated call rather than trusting
   the arrangement.
3. **Bounded loops.** A hard cap on tool calls per run, plus a task budget so
   the model paces itself. An unbounded loop is the only genuine runaway risk
   in this design.
4. **Nothing is pre-loaded.** Layers 2 and 3 are fetched on demand. The chat
   sends the cached prefix and a context descriptor, not the history of
   everything.

### The ledger and the cap

Every run and every chat turn writes to a `agent_usage` row: workspace, model,
input/cached/output tokens, computed cost, and what invoked it. Two things
fall out of it — "what is this costing us" becomes a query rather than a
guess, and a **monthly ceiling per workspace** becomes enforceable. Past the
ceiling the agent refuses new runs and says why, rather than quietly
continuing to spend. A bad week is visible the day it happens.

---

## 8. Build order

1. **The spine.** Provider interface, workspace-scoped context assembly
   (through `buildContext`), the read tools, the usage ledger and cap.
2. **The run, ported.** Stages 0–5 out of the n8n Code nodes and into this
   repo, existing tests first, chained invocations for the 300s cap.
   Ends with a research run executing against live data for the first time —
   which has still never happened.
3. **The chat endpoint.** Streaming, bounded, thread persistence.
4. **The surfaces.** `/insights/research`, then the assistant panel. Insights'
   two buttons collapse into one link here.
5. **The write tools.** `propose_rule`, `propose_idea`, `add_agenda_item`,
   `draft_post` — each landing in an approval surface that already exists.
6. **`discover_competitors`.** Alo Kheyatah has no competitors listed at all,
   so for that workspace this is the agent's first useful act.

Steps 1 and 2 are the ones worth being slow about, for the reason
`RESEARCH-AGENT.md` already gave: a report built on numbers that are quietly
wrong is worse than no report, because it is convincing.

### Outside the sequence, and time-boxed

The Meta token expires **2026-10-18**. Even with Zernio publishing all four
platforms, the agent reads competitors through Meta's `business_discovery` —
there is no Zernio equivalent. It needs a Business Manager System User token
and the real Arak account connected in place of the test account
`@lightingaaa`. This is Business Manager configuration, not code, and if it is
still undone on the 18th the agent goes blind regardless of how well steps 1–6
went.
