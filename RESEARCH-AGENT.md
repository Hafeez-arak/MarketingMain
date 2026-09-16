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

### b0. The watchlist is a list of identities, not of names — 2026-09-16

The sales team supplied 12 lighting and 8 controls competitors. Reconciling
them against the 12 already on the watchlist exposed what a name-only watchlist
costs:

- **Exactly one name overlapped** (Huda). The agent had spent every run
  researching companies nobody had asked for, and had stored **16 signals in
  total, 12 of them with no competitor attached at all**. The four that named a
  company named Datacore, Tawridat, Inara and Hondel — all four flagged as
  noise by the 15 Sep review. Technolight, Alfanar, Al-Babtain and the rest had
  **zero**.
- **"Lumiere" is at least four different Saudi companies** — Lumiere Group
  (Ariss family, 1994), Lumiere KSA (2007), Lumiere Lighting Technology,
  Lumiere Studio. The sales list has "Lumiere Lighting" under lighting and
  "Lumiere Group" under controls. Nobody can tell whether that is one company
  or two. **A name is not an identity. A domain is.**
- **"Fututron" does not exist.** The company is Futuron (futuron.sa). The
  misspelling would have returned nothing, forever, and read as a quiet rival.
- **Four companies are genuinely in BOTH lines** — Al Nasser, Armada, Spectra,
  Nassli. Nassli runs two businesses on two domains. A single-value `line`
  field would force a wrong answer on exactly the companies that matter most,
  which is why it has to be multi-valued when the column is added.
- **Al Nasser Group (alnasser.me) is the closest comparable that exists**:
  founded 1976, the same year as Arak, selling professional lighting *and*
  building control systems, with its own manufacturing and 20+ retail branches.
  It was on the old watchlist as "Alnasser Lighting" with no handle, no domain
  and no signal ever recorded against it.

`research_agenda` has no column for a domain, a line or a tier, so all of it
goes in `why` — which is free text the rivals lens is given verbatim, and which
**the loader did not even select until this date**. `select=subject` meant
every note a person wrote against a competitor was invisible to the lens that
researches them.

Two things follow, and both are in the prompt now:

- Research the **domain**, never the name. Where the note says the domain is
  unknown or ambiguous, SKIP and say so — a search spent guessing which company
  was meant is worse than not looking.
- The roll is no longer `slice(0, 12)`. With 17 names entered lighting-first,
  the cut fell above every controls competitor: the lens would have researched
  one business line and reported silence on the other. And where there are more
  names than searches the prompt now says so rather than promising one search
  per name — an instruction that cannot be followed is one the model quietly
  reinterprets, deciding for itself which rivals to drop.

**The order is the priority**, because `created_at` is the only thing resembling
one until a `tier` column exists. It is set so both business lines appear inside
the search budget (the top eight are four both-lines, two lighting, two
controls) and so the names that cannot be researched at all sit at the bottom
where they consume nothing.

### b1. Identities, distribution rights and lost deals — 2026-09-16

A review of b0 landed three additions worth taking, and the migration
`20260919_competitor_intelligence.sql` implements them.

**`domain`, `lines[]`, `kinds[]`, `city`, `tier`, `source`, `resolution` on the
watchlist.** The prose note in `why` was a stopgap; these are columns now.
`lines` and `kinds` are arrays because four of the seventeen rivals sell into
both business lines and Al Nasser is manufacturer, distributor, retailer and
integrator at once — a single value forces a wrong answer on exactly the
companies that matter most.

**`tier` is nullable and stays null.** It records how often a rival is actually
met and what a deal against them is worth, which only the sales team knows. The
first cut of this list tiered by SOURCE — sales-named was tier 1, agent-found
was tier 2 — which points the search budget at whoever came up in a meeting
rather than at whoever is actually met. `source` is now its own column, and a
default tier would be an invention dressed as data. The loader orders by
`tier.asc.nullslast, created_at.asc`, so list order carries the priority until
sales fills it in.

**`competitor_brands`.** In lighting, distribution rights decide who can bid
what, and there was nowhere to record them. Al Nasser is the confirmed
exclusive Berker partner for Saudi Arabia — one fact that says more about what
they can win in controls than any amount of social activity. `relationship`
separates `exclusive` from `claimed` from `unconfirmed`, because the difference
between evidence and repetition is the whole value of the table.

**`deal_outcomes`.** "Who are we losing to, and on what" is the question the
business actually wants answered, and every other part of this system collects
from the public web, where the answer is not. Six fields a person fills after a
contested bid: project, competitor, line, what decided it, rough price delta,
consultant. **The only table here a model never writes to.** Its failure mode is
organisational rather than technical — a log like this dies in month three if it
is not part of a routine — which is why `price_delta_pct` is explicitly rough:
waiting for precision is how it dies.

#### The axes differ by line, because the buyer does

The two business lines are not two product catalogues, they are **two buying
centres**. Lighting is specified by architects and lighting designers, so what
matters is which agencies a rival holds and what they can prove they have lit.
Controls is specified by MEP/ELV consultants and bought through the main
contractor, so what matters is protocol coverage, certification and who they
commission for. `LINE_AXES` in lensPrompts.js keys on the line's own name and
emits only the lines a brand's own watchlist uses; a line with no vocabulary
gets a fallback that asks the same question without presuming the answer.

Alongside it, one question for every rival regardless of line: **who they keep
appearing beside** — which consultants, lighting designers, main contractors
and ELV subcontractors. In a specification business the relationship is the
moat, and it is public far more often than people assume.

#### What was NOT taken from that review

- That the name research was half-done, naming ViaLighting, Namaraa, MASQ and
  Sela-PASS as untouched and Sela-PASS as unresolvable. All four are live and
  in the watchlist with domains: selapass.com returns "SelaPASS | Leading MEP &
  Engineering Contractor in Saudi Arabia". The three genuinely unresolvable
  names are Greenlight, Al Dhow and Spectrum, and they sit at the bottom of the
  list marked `unresolvable` so they consume no search.
- That `kind` was needed because a report had claimed rivals were absent from
  social. No stored report contains that claim. `kind` is worth having for the
  reason above; the evidence offered for it was not real.
- That Light & Design was founded by a former Al Nasser board member. Nothing
  found supports it. It may well be true and sales would know — but it does not
  enter the data as fact.

#### And one it got right about this file

Its sharpest line was that the name research had the defect it diagnosed. True,
though not of the names it picked: **"Al Nasser" is itself at least three live
Saudi entities** — alnassergroup.com, al-nasser.com, alnasser.me, plus a
separate retail store at alnasser.com. b0 asserted one of them from a single
search result and made it the number-one rival. The entry now lists all three
candidates and says *confirm before researching, do not guess* — the same
instruction it gives for Lumiere.

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

### a2. What the 15 Sep review changed — 2026-09-16

The three-reader report shipped on 15 Sep and was read closely by someone who
checked its numbers. Six things it got wrong are now held in code rather than
in the prompt, because each of them is the kind of mistake a model makes again
next week however clearly it is asked not to.

**One number per measurement, and the measurement is named.** That report gave
three different figures for our own Instagram posting — 7 a week in the Top 3,
5 posts in the social table, 7 again in the limitations — and built a
channel-weight recommendation on the gap. Two instruments measure that channel:
`business_discovery` reads the profile (everything on the account), and
`own_performance` counts our own published rows (the only ones that can carry
analytics). `reconcileAccountPosting` now carries both on the platform row with
a sentence saying why they differ, `ownPostingFacts` hands them to synthesis as
given facts, and the prompt forbids deriving a third. The same rule covers
comparisons: interactions per post and page impressions are different units, and
a recommendation resting on fewer than five measured posts says so in its own
sentence.

**Two axes for a competitor move, not one.** Every move in that report was rated
Medium, including one its own text called "confirmation of current state, not
momentum". `relevance` keeps the one meaning it should have had — how much this
matters — and freshness is derived in code from the store verdict the findings
already carry (`new` / `changed` / `standing`). A standing fact about a serious
rival is high significance and zero freshness, and that is a real and useful
thing to be able to say.

**The lead table holds leads.** A finding whose `for_whom` is "sales" is not a
lead; the competitors lens writes those constantly. Three rows in "Sales: act
now" were competitor intelligence, each duplicated two pages down. `isLeadFinding`
requires a named lead, or a finding from the openings lens — a finding naming a
competitor belongs to competitor moves unless it also names a project.

**A window, where there is no published deadline.** Six of six rows read
"unconfirmed", which is honest and unsortable. `leadWindow` gives every row a
closing condition and, crucially, its `basis`: a published date, an estimate
from the stage, or nothing established. Tender portals hide deadlines behind a
login; they do not hide the stage, and the stage is what closes the window.

**Standing events persist; calendar dates are not events.** That report's 90-day
events table held Saudi National Day and not the two largest shows in this
market, 48 days out. Computed dates now have their own band, every event row
carries its exhibitor-deadline status every week (open / closed / not
established), and the events lens re-confirms any tracked event inside 90 days
even when nothing about it changed.

**The watchlist before discovery.** The rivals lens found three companies nobody
had listed — the best material in the run — and ran out of searches before
reaching the two closest rivals on the watchlist. The list is now numbered in
the prompt with one search reserved per name, hiring and pricing are required
passes rather than bullets, and discovery is named as the thing to drop.

Two sections became permanent: **Open items**, computed across runs so a blocker
raised twice cannot vanish without a person closing it, and **What this report
cannot tell you**, which now renders even when it is empty. And the run
telemetry separates a lens that looked and found nothing from one that read
forty pages and reported none of them — on 15 Sep three lenses read 130 sources
between them and were all reported as a quiet week.

Still open: source-quality tiering. The right shape is a field the lens fills
when it reads a page — primary filing, trade press, aggregator, vendor
marketing — not a guess from the domain, and the caveat should then follow
automatically wherever that source is cited.

### a3. Search demand — the first first-party signal, 2026-09-16

Every other lens infers what buyers want from something second-hand: a rival's
post, a trade article, a tender listing. The `search` lens reads what people
actually typed into Google on the way to our own site, in both scripts,
including the searches where we appeared and nobody clicked.

**Zero budget, like Calendar and Ourselves.** It is a measured API read, not a
model call, so it costs nothing and cannot time out on a slow search.

**Why it is a lens and not a few rows inside `ourselves`.** Three outcomes have
to stay distinct, and only a lens can report the middle one:

| outcome | `ok` | means |
|---|---|---|
| unconfigured | `true`, with a note | no property set for this brand. Nothing is wrong. |
| failed | `false` | a property IS set and the call did not work — bad key, service account never added, grant revoked. |
| quiet | `true` | it answered and had nothing. A real result. |

A dead credential reporting "nothing found" is indistinguishable from nobody
searching for us, and the report would state the second with full confidence.
This agent has been bitten by a silent empty twice already.

#### No OAuth flow, and that is not a shortcut

There is no Connect button, no consent screen, no refresh token and no
reconnect UI. OAuth exists so a PERSON can grant an app access to THEIR data.
We do not need that: Google issues us an identity of our own (a service
account with its own email), and a human grants that identity access to our own
property once, by hand, in Search Console.

What remains is technically still an OAuth grant — a JWT signed with the
service account's private key, exchanged at Google's token endpoint for a
one-hour access token (RFC 7523). No browser, no user, ~30 lines of
`node:crypto`, **and no new dependency** — which matters because the agent
container installs exactly one package (see `server/Dockerfile`).

The day another workspace wants to connect a property *we* do not control, this
stops being enough and a real consent flow has to be built. Until then it is
the same shape as `META_IG_TOKEN`: a long-lived server credential.

#### Setup

1. Google Cloud: create a project, enable the **Search Console API**, create a
   **service account**, download a **JSON key**.
2. Search Console → Settings → Users and permissions → add the service
   account's `client_email` as a **Full** user. Full is enough to read
   performance data; Owner is only needed for the Indexing API, which we do not
   use.
3. Put the JSON in the n8n box's `.env` as `GOOGLE_SA_KEY` (raw or base64 — both
   are accepted, because a PEM with newlines survives some .env parsers and not
   others). The compose file already passes `.env` through; no Dockerfile or
   compose change is needed. Redeploy the agent container.
4. Set the brand's `customFields.website` to the verified property. A **Domain
   property** is addressed as `sc-domain:arak-sa.com` — *not* a URL. Handing it
   `https://arak-sa.com/` returns a 403 that reads like a permissions problem
   and is not one.

`GOOGLE_SC_SITE` is a deployment-wide fallback for when a brand sets none.
Both keys are named literally in a comment at the top of
`api/agent/_searchConsole.js`, because `vite.config.js`'s dev allowlist is kept
in step with `grep -rho 'process\.env\.[A-Z0-9_]*' api/agent/` and every read
goes through an injectable parameter that grep would never find.

#### The rule this lens exists to enforce

arak-sa.com had **122 web-search clicks in a quarter** when this was written. At
that volume a click count is noise: 3 → 6 is two people, not a doubling, and an
agent asked what changed will find something to say every week and be wrong
every week.

So the reported numbers are **impressions, query text and position**, which are
stable at low volume and are the useful half anyway. "We appeared 400 times for
*guest room management system saudi* at position 14 and were not chosen" is a
content brief and needs no clicks at all to be true. The floors are constants in
`src/lib/agent/searchConsole.js` — `MIN_IMPRESSIONS` 30, `NARRATABLE_CLICKS` 10,
and a winnable band of positions 4–20. Below position 4 with no clicks the query
wanted something else; past 20, "improve the title" is advice that cannot work.

The window is **28 days against the previous 28**, ending **three days back**.
Search Console keeps revising the last couple of days, so a window ending today
always reads as a decline — and a weekly agent would report that decline forever
as news.

#### Tuned against the first real run, 2026-09-16

The property was connected the day this shipped, and the live data contradicted
four things the code assumed. All four were invisible against a fixture; none
would have survived a week of real reports.

**The position band was set for a site that ranks better than this one.** It
stopped at 20, roughly where page two ends. arak-sa.com's non-brand impressions
sit 93 at positions 1-10, 50 at 11-20 and **269 at 21-30** — so the band
excluded most of the demand, and both queries actually worth having (151 and 77
impressions, at 20.3 and 23.2) fell just outside and were dropped in silence.
Now 4-30, with `tweakable: 15` deciding the ADVICE rather than the cutoff: near
the top of page one a title and description can win the click back; at position
22 they cannot, and saying otherwise is advice that quietly does not work.

**Brand queries leaked into the fix-this list.** The single finding the first
run produced was "we appear for اراك at position 9.1 and get no clicks —
rewrite the title", where اراك is the company's own name in Arabic.
`homepageCatching` had the brand filter from the start; `appearingNotWinning`
never did.

**An empty previous period was read as 172 arrivals.** The property held nothing
before 2026-08-17, so every query came back "new this period" — five of nine
findings, none of them meaning anything. That is a BASELINE, the distinction
`gather.js` already draws for competitor numbers (`baseline` vs `quiet_week`).
`impressionMovers` now returns nothing at all without a previous period and the
summary says so in words.

**The same query was reported up to three times.** Once as visible-but-unclicked,
once as landing on the homepage, once as a mover. They are one finding, and
merged it is stronger than any of the three alone: the demand is proven, the
ranking is proven, and the reason it converts nothing is that Google had no page
of ours to send it to. A `reported` set keeps the later sections off a query
already given a bullet.

Net effect on the same live data: **9 findings to 3**, and all three are claims
a person can act on.

#### Business lines

Findings carry a `line`, the first use of the second axis (the first being
`teamsOf`). It is **stamped in code, never asked of a model**: each query is
joined to the landing page that took most of its impressions, and the page's
path decides the line. A URL is a fact; a keyword match is an opinion. Query
words are the fallback, which is the case that matters most — a query landing on
the homepage because the page it deserves does not exist.

Unclassified findings carry `''` rather than a default. A finding filed under
the wrong business is worse than an unfiled one, because someone acts on it.

Nothing about lighting is in the code. The lines come from
`customFields.business_lines`, one per row, `key | Label | patterns` — a pattern
starting with `/` matches the landing page's path (language prefix stripped, so
`/ar/services/x` classifies like `/services/x`), anything else matches the query
text:

```
controls | Controls & automation | /services/lighting-controls, /services/home-automation, knx, grms, guest room
lighting | Lighting | /services/indoor-lighting, /services/facade-lighting, /services/outdoor-lighting, /services/lighting-design, luminaire, facade
```

#### One thing only looking found

Queries are interpolated into English sentences next to numbers, and without
isolation the bidi algorithm absorbs the number into the RTL run:

```
intended:  We appear for "شركة إنارة واجهات الرياض" 233 times at position 12.1
rendered:  We appear for "233 شركة إنارة واجهات الرياض" times at position 12.1
```

The impression count moves inside the quotes and reads as part of the query. The
string was correct and only its *display* was wrong, so no test would have
caught it — it was found in the dev harness. `isolate()` wraps every query in
U+2068/U+2069, which travels with the text rather than living in a renderer,
because these strings are also printed to PDF and read back by the model.

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
4. ~~**Stages 1–5**~~ — **done 2026-08-20.** `Run: Investigate` on the same
   workflow: plan → bounded tool loop (`web_search`, `fetch_page`) → reflect →
   synthesise, then persists findings, proposed rules and proposed agenda
   questions. Properly async now — the webhook responds the moment the run row
   exists and execution continues down the chain.

   Two properties it is built around, both mutation-tested:
   - **The measured numbers survive anything.** No key, unreachable model,
     unparseable output, an exception — the run still completes with Stage 0's
     board plus a note saying what was lost. A failed investigation never
     costs the user their numbers.
   - **Citations are checked, not trusted.** Every URL a tool returned is
     remembered; the model's sources are filtered against that set. A finding
     that loses all its sources is marked uncited and said out loud; a
     proposed *rule* that loses all its sources is not offered at all, because
     a rule steers every future generation.
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
