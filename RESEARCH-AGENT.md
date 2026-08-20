# Research Agent

Architecture for the agent behind **Insights → Research**. Written before any
code so the shape can be argued with while it is still cheap to change.

Nothing here is scheduling. The weekly run is a button; the cron that presses
it later is four lines and deliberately out of scope.

---

## 1. What exists today, and why it is not this

`Arak Lighting – Brand Research` already runs. It is honest about what it is:

- three hardcoded Tavily queries built from `brand_descriptor` + competitor names
- one Claude call
- at most four `brand_memory` rows written as `proposed`

That is a **one-shot prompt**, not an agent. Specifically it has:

| missing | consequence |
|---|---|
| no memory of prior runs | every week searches something slightly different, so nothing is comparable week to week |
| no numeric evidence | every "competitor" claim is an LLM paraphrase of a blog post; there is not one real number in it |
| no report | the only artifact is ≤4 sentences; you cannot read what it *learned*, only what it *concluded* |
| no follow-up | it cannot notice that a result was interesting and search deeper |
| no conversation | you cannot ask it "why did you say that" |
| no route to content | a finding never becomes an idea, so research and planning stay separate systems |

The Insights Review (`arak-insights-review`) is the mirror image: it reads our
own history and proposes rules, but never looks outside.

The research agent is the third thing — it looks outside, keeps a memory of
what it looked at, and reports.

---

## 2. What the market actually does

Okara's loop is: **enter a URL → it profiles the product, identifies the niche,
finds competitors, audits, then runs specialised agents daily that fill a feed
with opportunities and drafts.** Six agents (SEO, GEO, Copywriter, Reddit, HN,
X), a terminal showing what each is doing, an analytics tab, and a chat box
that routes a natural-language question to the right agent. The chat is the
single entry point — "which subreddits generated the most mentions", "draft an
article on X".

Across the wider category (Relevance, Gumloop, Datagrid, Sprout, Hootsuite,
Socialinsider) the pattern is consistent, and so is the weakness:

**What is worth copying**
- A **feed of opportunities**, not a PDF. The deliverable is a list of things
  to do, each expandable to its evidence.
- **Continuous, comparable** monitoring — the value is the delta, not the
  snapshot. "A sudden posting spike is the first visible sign a competitor
  spotted something working."
- **Chat as the entry point.** One box, not eleven screens.
- **Normalised metrics**: engagement per 1k followers, format mix share,
  cadence — because raw likes across accounts of different sizes are noise.
- **Findings feed the calendar automatically.** Okara's competitor and keyword
  agents write back into the editorial calendar. This is the part that makes it
  feel like an employee rather than a dashboard.

**What is not worth copying**
- **Prose reports with no numbers.** Most "AI competitor analysis" is a model
  reading marketing pages and writing confident paragraphs. It reads well and
  is unfalsifiable.
- **Daily cadence.** Daily runs on a brand that posts four times a week
  manufacture findings to justify the run. Weekly is honest.
- **Generic SEO/GEO scoring.** We are an Instagram-first brand studio. Core Web
  Vitals are not our problem.
- **Always finding something.** Every tool in this category is incentivised to
  produce four exciting insights per run. Ours must be allowed to say *nothing
  moved this week*, and must say it often.

---

## 3. The one real advantage we have

Every competitor-analysis tool on the market guesses at Instagram from the
outside. **We have an authenticated Meta Graph token and publish through it
already.**

The `business_discovery` edge returns, for any *public Business or Creator*
account, without their permission:

```
GET /{ig-user-id}?fields=business_discovery.username(competitor_handle){
  followers_count, follows_count, media_count, biography, website,
  media.limit(25){ id, caption, media_type, permalink, timestamp,
                   like_count, comments_count, view_count } }
```

That is real, numeric, per-post competitor data. From it, **computed in code,
not by a model**:

- posting cadence (posts / week, and the trend against last week)
- format mix (IMAGE / VIDEO / CAROUSEL_ALBUM share)
- engagement per 1k followers per post — the only cross-account-comparable number
- follower delta since last run
- their top 3 posts this period, with permalinks and captions
- posting-time distribution (weekday/hour, from `timestamp`)
- caption length and hook patterns (first line), as raw material for the model

**This is the spine of the whole design.** The web channel explains; the
Instagram channel proves. A finding that has a number behind it is worth ten
that do not, and this is the only place we can get numbers about anyone but
ourselves.

Costs and caveats:
- Target must be a **public Business/Creator** account. Personal or private
  accounts return nothing — handled as "no IG data for this competitor",
  never as a failure.
- It needs a competitor **handle**, which the Brand Brain directory does not
  currently hold (only `watch_url`). See §7.
- It leans harder on `META_IG_TOKEN`. That token **dies 2026-10-18 and nothing
  renews it.** Today its expiry breaks publishing; after this it also breaks
  research. That is an argument for fixing renewal, not against this design,
  but it should be a known, stated consequence.

---

## 4. The loop

Not a free-running ReAct agent. A weekly cron pointed at an unbounded tool
loop is how you get an incoherent report and a surprising bill.

**Deterministic where it is deterministic; agentic only where judgement is
actually required — which is deciding what to search next.**

```
  Stage 0  GATHER            code only, no model
  Stage 1  PLAN              1 model call
  Stage 2  SEARCH & READ     bounded tool loop  ← the only agentic part
  Stage 3  REFLECT           1 model call, may trigger ONE more search round
  Stage 4  SYNTHESISE        1 model call, structured output
  Stage 5  PERSIST           code only, no model
```

### Stage 0 — Gather (code)

Pulls everything the run is grounded in and computes every number:

1. `buildContext(task: 'research')` — who this brand is. Assembled **in the
   browser**, same as today, so there is never a second copy of the flattening
   logic in n8n.
2. The **agenda** — standing questions and the competitor watchlist (§6).
3. `business_discovery` for every competitor with a handle, **and for our own
   account**, so every comparison is against us and not against an average.
4. The previous run's `competitor_snapshots`.
5. Our own performance — the same aggregation `summarisePerformance` does.
6. Existing `brand_memory` in every status, so nothing already turned down is
   re-proposed.

Then it **computes the delta table in code**. This is not negotiable: asking a
model to subtract last week's post count from this week's is asking it to be
wrong occasionally about the single number the reader will trust most. The
model receives deltas as given facts.

Stage 0 is pure functions over stubbed HTTP — which means it is fully testable
in `workflowHarness.js`, like the Meta workflows already are.

### Stage 1 — Plan (1 call)

Input: agenda, delta table, unanswered questions from last week.
Output: **at most 8 search queries**, each tagged to an agenda item, each with
a stated expectation of what it should turn up.

Bounded on purpose. An unbounded planner writes twenty queries and the run
costs six times as much for one more paragraph.

### Stage 2 — Search & read (bounded tool loop)

A hand-rolled Anthropic tool loop in a Code node — loop while
`stop_reason === 'tool_use'`, with:

- **max 12 tool calls**
- **a hard token budget**
- every result retained with its URL

This is where the agent earns the name: it sees that a query about "Ramadan
lighting campaigns" returned a competitor's launch and decides on its own to
fetch that page and read it.

Why hand-rolled rather than n8n's LangChain Agent node: the generated JSON is
what `metaWorkflows.test.js` runs. A Code node loop is testable; an Agent node
is a black box in the same position.

### Stage 3 — Reflect (1 call)

"Which agenda questions are still unanswered? Which claims you are about to
make have no source behind them?" → either one more bounded search round
(**maximum one**) or proceed.

This is the step that stops the report making claims it cannot support. It is
also the step every cheap implementation skips.

### Stage 4 — Synthesise (1 call, structured)

Produces the report JSON (§8) in one shot, given: the delta table, the
gathered findings with URLs, our own numbers, and the existing rules.

Explicitly instructed that **an empty week is a valid and expected outcome**,
and that a finding with no source is not a finding.

### Stage 5 — Persist (code)

Writes `research_runs` (status → `complete`), `research_findings`,
`competitor_snapshots`, proposed `brand_memory` rows, proposed ideas, and any
agenda changes the agent suggested (as proposals, never applied).

**Cost per run:** 3 fixed model calls + ≤13 tool-loop turns on Sonnet, plus
≤10 Tavily searches and ~6 Graph calls. Order of $0.20–0.50. Weekly, that is
nothing; the bound is what keeps it that way.

---

## 5. The tool belt

Two classes, deliberately separated — the first are free and grounding, the
second cost money and reach outside.

**Read-the-brand (Supabase, free, cannot fail expensively)**

| tool | returns |
|---|---|
| `get_brand_context` | identity, positioning, what we sell — the `research` slice |
| `get_competitors` | watchlist rows: name, positioning, how_we_differ, url, handle |
| `get_memory` | every rule in every status, so nothing is re-proposed |
| `get_prior_research` | last N run headlines + open agenda questions |
| `get_our_performance` | our own pillar/format/weekday/platform breakdown, with sample sizes |
| `get_competitor_metrics` | the Stage-0 delta table, re-readable during the loop |

**Go-look-outside (metered)**

| tool | notes |
|---|---|
| `web_search(query)` | Tavily. Rate-limited, counted against the loop budget. |
| `fetch_page(url)` | Read one page properly — a competitor's site, a launch post. |
| `instagram_account(handle)` | `business_discovery`. Also usable ad hoc from chat: "what is X posting?" |
| `resolve_competitor_handle(name, …)` | Finds and **verifies** a rival's Instagram handle, then stores it on the agenda row. Zero handles exist today — see §7. |
| `discover_competitors()` | Searches for rivals we do not have listed and **proposes them onto the agent's own watchlist** (`research_agenda`) — never into the Brand Brain directory. See §5a. Not optional any more: Alo Kheyatah has no competitors listed at all. |

Every tool that writes, writes as `proposed`. The agent has no path to
`active`. That is already the rule for `brand_memory` and it extends here
without exception.

---

## 5a. The write boundary — the agent never edits the Brand Brain

**The Brand Brain's *content* is human-authored and the agent cannot touch it.**
Not "should not", cannot: it has no tool that writes to `brand_profile`,
`brand_fields`, `brand_sections`, `brand_directory_columns` or
`brand_directory_rows`, and none is ever added.

What the brand *is* — its identity, positioning, voice, products, prices, the
competitor rows someone typed in — is a statement the company makes about
itself. A weekly agent that could quietly rewrite it would mean the ground
truth every other prompt in this app is built on drifts on its own, and the
next off-brand caption would have no traceable cause.

What the agent writes instead is the **rule book that sits inside the Brand
Brain but is separate from its content**:

| surface | who writes it | agent access |
|---|---|---|
| `brand_profile` / `brand_fields` / `brand_sections` | human, in Brand Brain | **none** |
| `brand_directory_rows` (competitors, products, suppliers) | human, in Brand Brain | **read only** |
| `brand_memory` — the learned rule book | agent proposes, human approves | propose only, `status = 'proposed'` |
| `research_agenda` — the agent's own watchlist | agent proposes, human approves | propose only |
| `plan_ideas` — suggested content | agent proposes | propose only, `source = 'research'` |

Three consequences that fall out of this and are worth spelling out, because
each is a place the design would otherwise have leaked:

1. **`discover_competitors` proposes a watchlist entry, not a directory row.**
   The agent can find a rival nobody listed and start tracking it — that entry
   lives in `research_agenda`, which is the agent's memory. If a human decides
   the rival belongs in the Brand Brain, they add it there themselves, by hand.
   The agent's watchlist and the Brand Brain's competitor directory are
   allowed to differ, and that difference is information.

2. **The agenda is seeded *from* the Brand Brain, never back into it.** Reads
   flow one way. A question generated from the descriptor stays in
   `research_agenda`.

3. **A finding that contradicts the Brand Brain is reported, not applied.** If
   research shows the positioning line is out of date, the agent says so in
   `gaps` and may propose a *rule* about it. Editing the positioning is a
   decision a person makes in the Brand Brain, with the finding in front of
   them.

The rule book is the only thing that learns. Everything else is authored.

---

## 6. Memory — three kinds, and they are not the same thing

The "small memory to feed the agent every week" is the load-bearing idea in the
request, and it needs to be three tables rather than one blob, because the
three have different lifetimes and different readers.

### a. The agenda — *what to keep asking*

A standing list of questions and a watchlist. Stable IDs. This is what makes
week N+1 comparable to week N: **continuity comes from re-asking the same
questions, not from pasting last week's answers into the prompt.**

```
research_agenda
  id, workspace_id
  kind        'question' | 'competitor' | 'metric'
  subject     "Are rivals leaning into Reels for product launches?"
  why         why we care — steers how the answer is judged
  status      'active' | 'proposed' | 'retired'
  cadence     'weekly' | 'monthly'
  last_seen_run_id, created_by ('human' | 'agent')
```

Seeded from the Brand Brain on first run, extended by chat ("start watching
Lumina"), and the agent may **propose** additions — approved on the page like
a rule. A retired question stays retired.

### b. The ledger — *what was found*

```
research_runs
  id, workspace_id, trigger ('manual'|'scheduled'|'chat')
  status ('running'|'complete'|'failed'), started_at, finished_at
  period_start, period_end
  report jsonb            -- §8
  error text, model, tokens_in, tokens_out, searches, cost_estimate

research_findings
  id, run_id, workspace_id, agenda_id
  kind ('competitor'|'trend'|'gap'|'our_performance')
  headline, detail
  sources jsonb           -- [{url, title, quote}]
  evidence jsonb          -- numbers this rests on
  confidence numeric
  novelty ('new'|'continuing'|'changed'|'resolved')
```

`novelty` is what turns a report into a *review*. "Continuing" findings get
collapsed in the UI; "changed" ones lead.

### c. The snapshots — *the numbers, so deltas are real*

```
competitor_snapshots
  id, run_id, workspace_id, competitor_name, ig_handle, captured_at
  followers, media_count
  posts_in_period, posts_per_week
  format_mix jsonb        -- {IMAGE: .4, VIDEO: .5, CAROUSEL_ALBUM: .1}
  avg_engagement, engagement_per_1k
  top_posts jsonb         -- [{permalink, likes, comments, caption_head}]
  post_hours jsonb
```

Without this table, "their posting went 3 → 7 per week" is a model recalling
something it never saw. With it, that sentence is a subtraction.

Our own account gets a row here too, under our own name. Every comparison in
the report is then a comparison against us.

### And what does *not* go in memory

The full text of every page ever fetched. Sources are kept as URL + the quote
that mattered. A memory that grows without bound is a context bill that grows
without bound, and by month three the agent is paying to re-read February.

---

## 7. Competitor handles — checked against the live database

Queried 2026-08-20 before designing this section, because the whole Instagram
spine depends on the answer.

| workspace | competitor rows | with a `watch_url` | **with an Instagram handle** |
|---|---|---|---|
| Arak Lighting | 7 (one blank) | 2, both company websites | **0** |
| Aqeeq | 5 | 0 | **0** |
| Alo Kheyatah | **no competitor section at all** | — | **0** |

And our own side, from `social_accounts`: exactly one connected Instagram
account across all three workspaces — Arak's `@lightingaaa`, **1 follower**, a
test account. Aqeeq and Alo Kheyatah have none.

Two conclusions, and both change the build.

### a. Handle resolution is a build step, not a parsing convention

The earlier plan here was a `competitorHandlesFrom()` that reads an
instagram-ish column or parses an `instagram.com/...` URL. **Against the real
data that returns zero handles for every workspace.** It survives only as a
seed hint for the day someone does paste one.

What is actually needed is a resolution step, and it is itself a research task:

```
resolve_competitor_handle(name, positioning, website?)
  1. web_search for the brand's Instagram
  2. business_discovery the candidate handle
  3. VERIFY the match — does the returned biography / website / name
     correspond to the competitor we meant?
  4. store handle + confidence + verified_at on the agenda row
```

Step 3 is the one that matters. "Ozee" and "Ozeyl" are two different rivals in
the same workspace; an unverified guess silently attaches a week of numbers to
the wrong company, and a wrong number presented confidently is the failure this
whole document is organised against. An unresolved or low-confidence handle
stays unresolved and the competitor appears as `web_only` — **never a guess**.

The resolved handle is human-correctable on the Research page.

### b. And it lands on the agenda, not in the Brand Brain

This is where §5a stops being a constraint and starts being the thing that
makes the design work. A resolved handle is **research metadata** — a fact the
agent discovered and verified, with a confidence and a timestamp. It is not a
statement the company makes about itself, so it does not belong in the
competitor directory a human typed.

So it lives on `research_agenda` (`kind = 'competitor'`), which is seeded from
the Brand Brain directory but carries fields the directory should not hold. The
watchlist is a *superset* of the directory: it can track a rival nobody listed
(Alo Kheyatah, today: all of them), and it can carry an unverified handle
without polluting brand truth.

If handles had had to live in the Brand Brain, the boundary rule and the
Instagram spine would have been in direct conflict. They are not.

### c. `vs_us` has to degrade honestly

A 1-follower test account on one workspace and nothing on two others means the
"versus us" column is meaningless today. Rendering `-99.9%` against a rival
would be worse than rendering nothing.

So: **`vs_us` is null unless our own account clears a minimum baseline**, and
the board says "no comparable account connected" in its place. The same
`WEAK_SAMPLE` instinct the Insights page already has, applied to followers.

Note what this does *not* block. The competitor board's real value on day one
is competitor-versus-competitor: cadence, format mix, engagement per 1k,
follower deltas week over week. All of that works with no account of our own at
all. `vs_us` is one field, not the board.


---

## 8. The output contract

**This is the part that matters.** Everything above is machinery for producing
this, and if this shape is wrong the machinery is wasted.

Three artifacts, and all three are needed, because they have different
half-lives.

### a. The weekly brief — `research_runs.report`

Structured JSON, rendered on the page. Not a wall of prose.

```jsonc
{
  "headline": "One sentence: what actually changed this week.",
  "period": { "start": "2026-08-12", "end": "2026-08-19" },
  "baseline": false,          // true on the first run — no comparison possible

  "movements": [              // the lead. Deltas only. Empty is allowed.
    {
      "what": "Lumina tripled its Reels output",
      "metric": "video share of posts",
      "from": 0.2, "to": 0.6, "unit": "share",
      "competitor": "Lumina",
      "significance": "high",
      "evidence_source": "instagram"      // instagram | web | our_analytics
    }
  ],

  "competitor_board": [       // one card per competitor, hard numbers
    {
      "name": "Lumina",
      "handle": "luminaksa",
      "followers": 41200, "followers_delta": 900,
      "posts_per_week": 7, "posts_per_week_prev": 3,
      "format_mix": { "VIDEO": 0.6, "IMAGE": 0.3, "CAROUSEL_ALBUM": 0.1 },
      "engagement_per_1k": 12.4,
      "vs_us": "+38%",                    // always stated against our own row
      "top_posts": [{ "permalink": "...", "likes": 1840, "hook": "..." }],
      "read": "What they appear to be doing, in one sentence.",
      "data": "instagram"                 // or "web_only"
    }
  ],

  "market": [                 // trends. EVERY item carries sources.
    {
      "finding": "...",
      "agenda_id": "...",
      "sources": [{ "url": "...", "title": "...", "quote": "..." }],
      "confidence": 0.6,
      "novelty": "new"
    }
  ],

  "gaps": [                   // the "so what for us" — the highest-value section
    {
      "gap": "Three of four rivals ran Ramadan-timed content; we ran none.",
      "basis": "instagram",
      "our_position": "0 of 12 posts in period",
      "suggested_response": "..."
    }
  ],

  "proposed_rules": [ /* → brand_memory, status 'proposed' */ ],
  "proposed_ideas": [ /* → the planner. See (c). */ ],
  "agenda_changes": [ /* add / retire questions, as proposals */ ],

  "unanswered": ["Agenda questions this run could not answer, and why."],
  "sources": [ /* de-duplicated union of every URL used */ ],
  "quiet_week": false         // set true when there is genuinely nothing
}
```

Two fields there are doing unusual work and are worth defending:

- **`unanswered`** — a research agent that never admits a miss is one you
  cannot calibrate. It also feeds next week's plan directly.
- **`quiet_week`** — the escape hatch that lets the model return an honest
  nothing. Without an explicit place to put "nothing moved", a model asked for
  findings will always produce findings. This single field is most of what
  separates this from the category.

### b. Proposed rules → `brand_memory`

Unchanged from today, and deliberately so. Scopes `competitor` and `trend`
already exist, already map to the `plan` / `research` / `chat` tasks through
`SCOPE_TASKS`, and already require a human to approve before anything reaches
a prompt. Research lands in the same place as every other kind of learning,
with the same gate. **No new approval surface.**

This is the durable half of the output — the part that is still changing
generation in three months.

### c. Proposed ideas → the planner

The half that is missing today and is most of the perceived value in the
market. A gap like *"rivals are all running Ramadan content and we are not"*
should be able to become an actual idea in a plan — with the finding attached
as its brief — not just a sentence in a report someone has to re-type.

Minimum viable version: the report carries `proposed_ideas`, each with topic,
pillar, format, rationale, and the finding it came from; the Research page
offers **"Send to planner"**, which seeds a `plan_ideas` row exactly as the
planner's own flow would, with `source = 'research'` so its performance is
traceable back to the research that suggested it.

Note what this is *not*: a proposed idea is a row in the planner awaiting the
same approve/reject the planner already has. It does not edit the Brand Brain,
and neither does the rule it may later produce — §5a.

That last part is the loop closing: research → idea → post → analytics →
insights → rule → research. Every other piece of that circle already exists in
this app. This is the missing arc.

---

## 9. The chat

Same agent, same tools, different entry. Not a second system.

- Turns persist (`research_chats` / `research_messages`) so a reload does not
  lose the thread.
- The current brief is in context — "why did you say Lumina tripled Reels"
  must be answerable, and answerable **with the stored snapshot**, not by
  searching again.
- It can search live when asked. Bounded harder than the weekly run (≤4 tool
  calls) because a human is waiting.
- **It can write, as proposals**: "make that a rule" → `brand_memory` proposed;
  "start watching Lumina" → agenda proposed; "turn that into an idea" →
  proposed idea.
- Synchronous. A chat turn is seconds, and the async machinery in §10 exists
  for the weekly run, which is minutes.

The chat is also the honest UI for the fact that a weekly report can never
anticipate every question. Okara reached the same conclusion — the chat is the
single entry point, and the agents are what stands behind it.

---

## 10. Async, and the failure that must not happen

A weekly run is Stage 0 → 5 with a bounded loop in the middle. Minutes, not
seconds. A browser `fetch` held open across that will time out, and n8n's
`responseMode: responseNode` will be answering into a closed socket.

So the weekly run is **async, and the browser never waits**:

1. Browser POSTs → n8n immediately inserts `research_runs` with
   `status = 'running'` and responds `{ ok: true, run_id }`.
2. The agent continues in the background.
3. The browser polls (or subscribes to) that row.

And the rule this codebase already learned the hard way — *the browser opens
the spinner, only n8n closes it; a refused webhook spins forever*:

- **Every terminal path writes.** Success writes `complete`; an error writes
  `failed` with the message. The n8n workflow needs an error branch that does
  nothing but that write.
- **A stale `running` row is swept.** A run still `running` after 20 minutes is
  marked `failed` on the next page load, exactly like the creative reconcile
  sweep. A dead run must not leave a spinner up forever.
- **Runs are single-flight per workspace.** A second "Run weekly review" while
  one is running returns the running `run_id` rather than starting a second
  agent — otherwise a double-click doubles the bill and writes two conflicting
  snapshots for the same period.

Chat stays synchronous, bounded to a few tool calls.

---

## 11. The page — `/insights/research`

One page, everything visible, as asked.

```
┌────────────────────────────────────────────────┬──────────────┐
│ Research            [Run weekly review]        │              │
│ Last run: Aug 12 · 4 findings · 2 rules pending│    CHAT      │
├────────────────────────────────────────────────┤              │
│ ▸ HEADLINE — what changed this week            │  Ask the     │
│ ▸ MOVEMENTS — deltas, biggest first            │  agent       │
│ ▸ COMPETITOR BOARD — cards w/ real numbers     │              │
│ ▸ MARKET & TRENDS — cited                      │  "why did    │
│ ▸ GAPS — so what for us                        │   you say…"  │
│ ▸ PROPOSED — rules (approve) · ideas (send)    │              │
│ ▸ UNANSWERED                                   │  ┌────────┐  │
├────────────────────────────────────────────────┤  │ input  │  │
│ RUN HISTORY  Aug 12 · Aug 5 · Jul 29 …         │  └────────┘  │
│ AGENDA  standing questions + watchlist (edit)  │              │
└────────────────────────────────────────────────┴──────────────┘
```

- The proposed-rule card is `ProposedRule` from the Insights page, reused
  verbatim. Same component, same approve/dismiss, same table.
- Run history opens a past brief read-only. Later: a diff between two runs.
- The agenda is directly editable — it is the steering wheel, and it should
  not require a chat turn to adjust.

**The existing Insights page loses both buttons.** "Run research" becomes a
link here. "Run review" is absorbed too: its aggregation becomes the
`get_our_performance` tool of this agent rather than a parallel workflow.

Three paths writing `proposed` rows into one table is precisely the drift
`brandContext.js` exists to prevent — and beyond tidiness, the merge is what
makes the findings *true*. A market claim is worth far more when the same run
can test it against our own numbers: "rivals are winning with Reels" and "our
own Reels underperform our carousels at n=14" are one finding, not two, and
only a run holding both can say so.

`Arak Lighting – Insights Review` stays deployed but unreferenced, on the same
terms as the Zernio workflows — a rollback should be a change of import, not a
redeploy. The Insights page keeps its two summary sections and its active-rule
list; it simply stops being a place you *start* something.

---

## 12. Deliberately not building

- **Daily runs.** Weekly, on a brand posting a few times a week, is the
  shortest interval at which a delta means anything.
- **SEO / Core Web Vitals / GEO auditing.** Okara's centre of gravity; not
  ours. We are an Instagram-first brand studio.
- **Sentiment analysis.** Requires comment-level data we do not have for
  rivals, and cheap sentiment scoring is worse than no number.
- **A second approval surface.** Everything proposed lands in `brand_memory`
  or the planner, both of which already have one.
- **Scheduling.** By request. The weekly run is `{ trigger: 'scheduled' }` on
  the same webhook — adding cron later touches nothing else.
- **Any edit to Brand Brain content.** §5a. The agent proposes into the rule
  book, its own watchlist, and the planner. Identity, positioning, products and
  the competitor directory stay human-authored, permanently.

---

## 13. Build order — revised against the live data

1. ~~**Schema**~~ — **done 2026-08-20.** `supabase/migrations/20260824_research_agent.sql`,
   applied via MCP. Single-flight and no-double-snapshot are enforced by
   partial unique indexes rather than application checks, and both were probed
   live: a second `running` run is refused, a new one is allowed once the
   first completes, and the same rival twice in one run is refused
   case-insensitively.
2. ~~**Handle resolution**~~ (§7) — **done 2026-08-20.** Workflow
   `Arak Lighting – Research Resolve` (`arak-research-resolve`): seeds the
   agenda from the Brand Brain, then searches, verifies and scores a handle
   per rival. No model call in the graph — matching is arithmetic over a
   domain, a name and a bio, so it answers the same way twice and can be
   audited when wrong. Browser side in `src/lib/research.js`
   (`competitorRowsFrom`, `isSnapshotable`, `setHandleByHand`). 33 tests.
   **Not yet deployed to the n8n box.**
3. ~~**Stage 0 in isolation**~~ — **done 2026-08-20.** Workflow
   `Arak Lighting – Research Run` (`arak-research-run`): claims a run,
   snapshots every VERIFIED handle via `business_discovery`, computes cadence,
   format mix, engagement per 1k and week-over-week deltas in code, and writes
   the report document §8 specifies with the model-authored sections empty.
   Async — answers with a run id and keeps working. No model call at all, so
   there is already a competitor board with real numbers before stage 1
   exists. 23 tests, including a mutation check that the hidden-likes rule
   actually bites.
4. **Stages 1–5** as one n8n workflow, async, with the failure writes.
5. **The page** — brief rendering + run history + agenda (with handle
   correction), reusing `ProposedRule`. Insights' two buttons become one link
   here in the same change, so there is never a window with three research
   paths live.
6. **`discover_competitors`.** Moved up from "later": Alo Kheyatah has no
   competitor section at all, so for that workspace the agent's first useful
   act is finding rivals to watch.
7. **Chat.**
8. **`proposed_ideas` → planner.** Note `plan_ideas` has **no `source` column**
   and `plan_id` is required — an idea must belong to a plan. So proposals rest
   in `research_findings` until someone picks a target plan, and the only
   migration needed is a nullable `source` for traceability.
9. *(later)* cron, run diffing.

Steps 1–3 are the ones worth being slow about. A report built on numbers that
are quietly wrong is worse than no report, because it is convincing.

**The rule the resolve step establishes, which everything downstream inherits:**
a handle alone is never permission to collect numbers. Downstream filters on
`ig_status in ('resolved','human_set')` — never on `ig_handle` being non-empty
— because a weak candidate IS stored, deliberately, so a human has something
to accept. `isSnapshotable()` is that rule in one function, and it has its own
test.

And one check that belongs in review at every step: **grep the workflow for a
write to any `brand_profile` / `brand_fields` / `brand_sections` /
`brand_directory_*` endpoint.** There should never be one. That single grep is
the whole of §5a, enforced.

---

## 14. Ground truth, 2026-08-20

Queried live before building, so later readers know what the design was
actually sized against rather than what it assumed.

- **Workspaces:** Arak Lighting, Aqeeq, Alo Kheyatah.
- **Competitors:** 7 / 5 / 0. One Arak row is blank. Two `watch_url`s exist,
  both company websites.
- **Instagram handles for competitors: zero, everywhere.**
- **Connected own accounts:** one — Arak's `@lightingaaa`, 1 follower, a test
  account. Aqeeq and Alo Kheyatah have none.
- **`brand_memory`:** 4 rows (Arak), 1 (Aqeeq), 0 (Alo Kheyatah). The learning
  loop is real but barely started.
- **`plan_ideas`:** `status` already allows `proposed`; there is no `source`
  column; `plan_id` is required.
- No `research_*` table exists yet.

The honest reading: **this agent will be the primary source of learning for
these brands, not a supplement to it.** There is almost no posting history and
almost no accumulated memory to review. That is an argument for the web and
Instagram channels being the spine — they work on day one — and against
weighting our own analytics heavily in the first months.
