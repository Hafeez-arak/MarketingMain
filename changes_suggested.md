# changes_suggested

Running log of the dashboard rebuild — what was wrong, what changed, what is
still owed, and what was deliberately left out. Started 2026-09-17.

Keep this file in step with the work. A line moves from **To do** to **Done**
only when it has been verified, not when the code was written.

---

## 1. What was actually wrong

Found by reading the code, not by guessing:

| Symptom the user reported | Real cause |
|---|---|
| "The number tracking is not right, is it not activated?" | `src/pages/Dashboard.jsx` read `state.posts`, `state.campaigns`, `state.approvals`, `state.emailFlows` from `src/store/appStore.jsx:54` — a **localStorage demo store that starts empty and that nothing in the real pipeline ever writes to**. It was never connected to anything. Real posts live in Supabase (`scheduled_posts` over `generated_posts`); real analytics come from Zernio via `/api/zernio/analytics`. |
| "Platform overview, what are the numbers for?" | Posts-per-platform counted from that same empty store. Worse, it listed **Facebook and X, which are not platforms in this app at all** — `src/lib/utils.js:18` has Instagram, TikTok and LinkedIn live, Snapchat in beta. The card was fiction twice over. |
| "Create post moves me immediately to Instagram" | The header button was hardwired to `navigate('/social/instagram')`. |
| "Quick actions still offers Create Instagram post" | Left over from when Instagram was the only platform. |
| No analytics on the dashboard | The only analytics surface was `/analytics`, which shows **one account at a time** and cannot combine platforms. |
| No website analytics | Search Console exists in the repo but only server-side, inside the research agent (`api/agent/_searchConsole.js`). Nothing the browser can call. |

### The website situation (important context)

- **There is no analytics tag on arak-sa.com at all** — no GA4, no GTM, no
  Clarity in the served HTML. So sessions, users, bounce rate and conversions
  are **not available from anywhere** today.
- Search Console is the only first-party website source that exists:
  `sc-domain:arak-sa.com`, verified as a Domain property.
- Volume is thin (~122 web-search clicks per quarter), which is why the
  dashboard reports **impressions, queries and position** and refuses to
  narrate click movement below the floor in `src/lib/agent/searchConsole.js`.

---

## 2. Decisions taken (by the user, 2026-09-17)

1. **Website analytics** — build the Search Console card now, *and* write up
   what it would take to get real traffic analytics (GA4) later.
2. **SEO recommendations** — rule-based now, computed in code, no per-view AI
   spend. Keep the door open for the research agent to deepen it later.
3. **Multi-platform selection** — combined totals across the platforms picked,
   *plus* one coloured line per platform in the trend chart.
4. **Dashboard contents** — analytics overview, upcoming scheduled posts,
   pending approvals, and quick actions limited to: Create Instagram post,
   Create LinkedIn post, Create TikTok post, Plan a month, View analytics,
   View research.

---

## 3. Changed in this pass

All verified in a browser against the harness (see §7), `npm test` 1638 passing,
`npm run build` clean, `npx eslint` clean on every file touched.

- [x] `src/pages/Dashboard.jsx` — rebuilt against real data sources. Nothing on
      it reads the localStorage app store any more.
- [x] `src/lib/dashboardOverview.js` (+ 27 tests) — pure aggregation of one
      per-account Zernio response per connected account into combined KPIs,
      per-platform rows and a zero-filled series.
- [x] `src/lib/seoAdvice.js` (+ 15 tests) — ranked, deduplicated SEO
      recommendations built on the existing pure primitives in
      `src/lib/agent/searchConsole.js`, so the dashboard and the weekly
      research report can never disagree about what a "winnable query" is.
- [x] `api/agent/search.js` — browser-callable Search Console read, auth'd by
      Supabase session + `callerMayUseWorkspace`. Lives under `api/agent/` so
      the credential is already on vite.config.js's dev allowlist and so
      `_searchConsole.js` stays the only module that signs the JWT.
- [x] `src/pages/dashboard/CreatePost.jsx` — "Create post" asks which platform
      first instead of jumping to Instagram.
- [x] Quick actions are now exactly: Create Instagram post, Create TikTok post,
      Create LinkedIn post, Plan a month, View analytics, View research.
- [x] The old "Platform overview" card is gone. A real per-platform breakdown
      replaces it, driven by `LIVE_PLATFORMS` so Facebook and X cannot come back.
- [x] "Recent posts" replaced by "Going out next" (Supabase, next 14 days).

### Two judgement calls made while building

1. **"Pending approvals" is now "Needs attention".** There is no approve/reject
   step in this app any more — plans schedule on save and `/social/approvals` is
   the Post Queue (the route keeps the old name so links work). The card is fed
   by `queueBucket`'s `attention` bucket: made but not booked, or failed. That
   is the real version of the question the old card was asking.
2. **Metrics a platform does not take now print "—", not 0.** LinkedIn takes no
   view count on an ordinary post, so a LinkedIn-only selection showing
   "Post views: 0" would read as a quiet month rather than as a number nobody
   measured. `metricAcross` sums only the platforms that report a metric and
   names them on the tile ("Instagram only"); the chart's metric picker hides
   options the selection cannot fill.

---

## 4. Still owed — blockers outside the code

These are **not** code problems. The card will say so on screen rather than
showing zeros.

- [x] **`GOOGLE_SA_KEY` on Vercel** — done, live 2026-09-17. The Website card
      is reading real Search Console numbers for `sc-domain:arak-sa.com`.
- [x] **`customFields.website`** — done; the property resolved, which is what
      the live numbers prove. (Reminder for next time: a PostgREST `PATCH` on a
      jsonb column REPLACES the whole object — read, spread, write the union.)
- [ ] **The agent container's own `.env`** on the WSL2 box still needs the same
      `GOOGLE_SA_KEY` if the weekly research lens is to read the property too.
      Vercel and the box are separate environments; setting one does not set
      the other. Worth checking the next research run's search lens is not
      reporting itself unconfigured.
- [ ] **GA4 (or Plausible/Clarity) on arak-sa.com.** See §6.

---

## 5. Left out on purpose

- **Sessions / users / bounce rate / conversions** — impossible without a tag
  on the site. Not stubbed, not faked.
- **The "Email flows" KPI** — it was on the old tile row, but there is no email
  sending integration behind it, so it would be another permanently-zero tile.
- **AI-written SEO prose on the dashboard** — costs money per view. The
  rule-based cards carry the same facts; the research agent does the writing
  when asked. The door is open: `/api/agent/search` returns the same rows the
  lens reads, so handing them to `runSearchLens` is the only step left if we
  ever want the deeper written version on demand.

---

## 6. GA4: what it would take (the "push for GA4" the user asked for)

Today the dashboard can tell you what people **searched** before reaching the
site. It cannot tell you what they **did** once they arrived. Closing that gap
needs one tag on the site, and nothing else in this repo changes:

1. Create a GA4 property for `arak-sa.com` and copy its Measurement ID
   (`G-XXXXXXXXXX`).
2. Install Google Tag Manager on every page of the site (EN and AR trees —
   44 pages × 2), immediately after `<head>`. GTM rather than a raw gtag
   snippet, so later additions need no developer.
3. Fire GA4 Configuration on all pages via GTM.
4. Mark the things that matter as conversions: contact-form submit, WhatsApp
   click, phone click, catalogue/spec-sheet download.
5. Link GA4 to Search Console, so query data and on-site behaviour sit in one
   property.
6. Grant the **same service account** (`client_email`) Viewer on the GA4
   property. The GA4 Data API takes service-account auth exactly like Search
   Console does, so the dashboard card gains sessions and conversions without
   an OAuth consent flow.

Worth doing in this order: step 6 is what lets the dashboard read it, but
steps 1–4 are worth having even if nobody ever wires the API up, because
without them the data does not exist to read.

Also still open from the last session and relevant here: `/about-us` 404s (the
real page is `/about`), and GRMS / energy management are sold on the homepage
but have no page of their own — the strongest content gap Search Console has
surfaced.

---

## 7. Second pass — 2026-09-17, after the first version went live

Search Console came online between the two passes (`GOOGLE_SA_KEY` is set), so
the Website card is showing real numbers now.

### Decided

1. **"What to do now" replaces the idea of dashboard tabs.** The user first
   proposed two tabs, one of them an "Overview" holding a short form of the
   research. Argued against and dropped, for three reasons: the dashboard *is*
   the overview so the name is a loop; a tab hides state on a page whose whole
   job is showing state (you would never see an expiring tender unless you
   remembered to click); and `/insights` already solves this by putting its
   summary *above* both halves rather than behind a tab. One always-visible
   ranked list instead.
2. **One merged list, not two.** Recommended splitting urgency from direction;
   the user chose one list. Built as one, with a kind tag on every row so it
   still scans as four — see the header of `src/lib/dashboardPriority.js`.
3. **Quick actions deleted entirely.** After removing the three "Create X post"
   entries the user asked to drop, the survivors all duplicated the left
   navigation. The user's own argument ("no one would scroll to the bottom,
   they would go to the navigation") kills the card rather than relocating it.
4. **Research is read-only here.** A run costs about $1. The dashboard reads the
   newest finished run; starting one stays on `/insights` where the cost and
   the progress are visible. No money-spending button on a landing page.
5. **The research short form is direction + gaps-with-ideas**, not `topThree()`.
   `topThree` scores +2 for a deadline inside 14 days and +1 for anything
   sales-flagged, so for a marketing reader it can come back as three tender
   deadlines — a sales digest wearing a marketing label.

### Built

- [x] `src/lib/dashboardPriority.js` (+ 26 tests) — merges the research report,
      the Search Console rules and the post queue into one ranked list.
- [x] `src/pages/dashboard/Priority.jsx` — draws it, dated with the run it came
      from so three-week-old findings never read as this week's.
- [x] `src/pages/dashboard/Collapsible.jsx` — real `<button>` + `aria-expanded`
      + the `hidden` attribute, not a zero-height div.
- [x] Website card: both long lists collapsed by default, tiles always visible.
      The card went from roughly 1200px tall to 230px.
- [x] "Most active platform" and "By platform" merged into one **Platforms**
      card, leader first and marked.
- [x] Quick actions card deleted.
- [x] Fetches lifted into `useWebsiteSearch` / `useResearch` / `useQueue` so the
      strip and the cards share one answer each — otherwise every visit made two
      Search Console round trips, the slowest call on the page.

### One design bug caught in the browser, not in tests

The first version ranked the merged list flat. With a realistic week — two live
tenders, two urgent Search Console items and a failed post — **the content gaps
fell off the bottom every single time**, which is exactly the half the marketing
reader opens the page for. Fixed with per-kind caps (`KIND_CAP`), plus a
backfill so a quiet week does not produce a four-row list. A flat ranking here
would have been correct and useless.

---

## 8. How to look at it without signing in

`/` is behind auth, and the states worth checking (a platform that failed, a
Search Console credential nobody has created, an account nobody has counted
yet) cannot be produced on demand against the live stack at all.

```bash
npm run dev
```

Then open **`/dev-dashboard.html`**. It mounts the real Dashboard, the real
aggregation and the real SEO rules against a stubbed `fetch`, with four
scenarios across the top: everything connected, Search Console not set up,
Search Console failing, nothing connected. Only the network is fake — the
shapes are the ones `api/zernio/_zernio.js` and `api/agent/search.js` return.

Vite only builds `index.html`, so none of this reaches a production bundle.
