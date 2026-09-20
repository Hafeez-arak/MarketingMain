# Pending — parked decisions

Things named as problems but deliberately not scheduled yet. Parked, not
dropped: each one is here so it stays visible while the agent and the
four-platform publishing work go first.

## Simplification pass (raised 2026-09-09, deferred)

- **Campaign Planner** (`src/pages/campaigns/CampaignPlanner.jsx`, 2,313 lines).
  Called out directly as not good. Three routes serve one job — `/campaigns`,
  `/campaigns/plans`, `/campaigns/plan` — plus a fourth for the post editor.
- **Insights + Analytics merge.** Two screens already report performance and
  the research agent is about to be a third. Insights' two run buttons are
  slated to collapse into one link at the agent's page regardless.
- **Email flows** (`src/pages/email/index.jsx`, 80 lines). A route with nothing
  behind it. Delete, or build — currently neither.
- **Studio and Brand Brain** (2,279 and 1,789 lines). The other two giants.
  Not known to be broken; listed for size, not for fault.

## Creative Studio — image generation (raised 2026-09-19)

Context for all of these: a marketer asked for three Saudi National Day posts
and the Gemini lane failed four times with fal's 422, *"the input cannot be
processed as the requested output type"*, while ChatGPT rendered the same
brief. Two causes were fixed in PR #77 — retries opening new lanes, and the
brand block's copywriting half reaching the models that draw. What is below is
what that investigation turned up and did **not** act on.

- **Auto-enhance is off by default** (`autoEnhance`, `src/pages/studio/index.jsx`).
  All five rows of the failed session are `prompt_source: 'raw'`, so a
  conversational brief — "I need you to help me create 3 posts…" — went to the
  image models verbatim. Enhance exists to turn that into a picture
  description, runs before any spend, and nobody ticks it. Flipping the default
  is one line; it adds a Claude call per generate, which is why it is a
  decision and not a fix.
- **A URL in the prompt is inert.** Nothing in the generate path opens links —
  Enhance calls Claude with no tools, Generate calls fal. "Use the official
  visual identity from this link" therefore reached the model as text about an
  attachment that was never attached, which is one of the causes fal's 422
  names out loud. Two options, smallest first: warn when the prompt box
  contains a URL, or **fetch it**. `api/agent/_web.js` already calls Firecrawl
  with `formats: ['markdown']`; adding a screenshot format gives the rendered
  page as an image, which drops straight into the reference-image slot the
  studio already has — and a reference routes generation to
  `nano-banana-2/edit`, the strongest instruction-follower available. Worth
  knowing regardless: Gemini is independently likely to refuse *reproducing* an
  official government identity, so "in the spirit of" will land where "use the
  official identity" may not.
- **"3 posts" in one prompt renders one image per model.** No batching exists
  and none is planned; three posts is three prompts. Either say so in the
  composer or build the fan-out — currently neither.
- **Which clause Gemini actually refused was never proven.** The ablation —
  same prompt minus the URL, minus the brand block, split into one post — costs
  roughly $1 of real fal spend and was declined on 2026-09-19. The two fixed
  causes were established by reading the stored prompts, not by testing fal.
- **Higgsfield is not open source** — checked 2026-09-19. Their GitHub org has
  the Python/TS SDKs, a CLI and an older GPU-orchestration framework; the
  generative platform is not there, and they raised an $80M Series A extension
  in January 2026 at $1.3B. The repos named "Open-Higgsfield-AI" are
  third-party front-ends that still bill per generation through somebody's API.
  The real option is the opposite one: **integrate their paid API** alongside
  fal for Seedance 2.5 character continuity and their motion presets. Not
  costed. Only worth opening if fal's model range becomes the limit.
- **fal hit `User is locked. Reason: TOP_UP.` on 2026-09-17.** One render died
  of it. The studio header shows the balance; nothing alerts before it runs
  out.
- **A reference photo containing a recognisable person is always refused** by
  Seedance ("may contain likenesses of real people"), twice on 2026-09-02. The
  picker does not warn before spending the attempt.

## Website analytics — GA4 and the site itself (raised 2026-09-20)

The Analytics page's Website tab shipped reading Search Console. The GA4 half
is **built and waiting** — panels, route, service-account auth, the lot — and
shows its four setup steps instead of numbers because arak-sa.com carries no
analytics tag at all. Nothing in this repo changes when it is turned on.

- **GA4 is deferred on deployment cost, not on doubt** (user, 2026-09-20).
  Installing the tag means redeploying the website, and the Vercel deployment
  credits reset **2026-09-24** — redeploying before then would exhaust them and
  force a purchase. Revisit after that date. Full steps, including the
  service-account email and the G-measurement-id-vs-property-id trap, are in
  `docs/GA4-SETUP.md`.
- **The cost of waiting is real and worth restating**: GA4 reports from the day
  the tag goes live and cannot backfill. Every week it is off is a week that
  never has session data, so this is the one item here where delay destroys
  something rather than postponing it.
- **The sitemap is dead.** `https://www.arak-sa.com/sitemap.xml`, submitted
  2021-07-06, **last downloaded by Google 2025-02-26**, 2 warnings, and on the
  `www` host that 301s to the apex. Regenerate, submit on the canonical host.
  Needs a site deploy, so it is blocked by the same credit window — and it is
  the cheapest explanation there is for a page taking no impressions.
- **Image search earns nothing.** 892 impressions in 28 days at average
  position 39.9, for one click — about a fifth of the site's total visibility.
  Descriptive `alt` text and real filenames on the product and project
  photography. Also a site change, also inside the credit window.
- **No structured data at all.** `searchAppearance` reported one translated
  result and nothing else, so every result is a plain blue link. Product and
  organisation markup is the opening; not costed, not scheduled.
- **`/about-us` still 404s** (the real page is `/about`) — carried from the
  2026-09-16 Search Console notes and still open. Another site-side fix.
- **Aqeeq and Alo Kheyatah have no `customFields.website`**, so their Website
  tab shows setup steps. Correct behaviour, but if either brand has a verified
  property it is one field away from working.

## Carried over from earlier work

- **Meta token expires 2026-10-18.** Even with Zernio publishing all four
  platforms, the research agent reads competitors through Meta's
  `business_discovery`, so the token stays load-bearing. Needs a Business
  Manager System User token. The test account `@lightingaaa` was disconnected
  from the platform on 2026-09-14 (both rows `is_active=false`); the real Arak
  account gets connected through Zernio, not Meta.
- **Two unmerged branches**, one commit each: `access-invites`,
  `webhook-guard-response-docs`.
