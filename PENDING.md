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

## Website analytics — index health (raised 2026-09-20)

Built and shipped: `/api/agent/indexHealth` inspects every sitemap URL against
Google's index, on a button. Two decisions were deliberately NOT made while
building it.

- **It is not cached.** Each press is up to 120 Google calls and about forty
  seconds, and Google's quota allows roughly sixteen presses a day on a site
  this size — so a cache would pay for itself. What stopped it is the
  invalidation rule: the honest one is "whenever Google changes its mind",
  which is not observable, and a stored answer read as current on the day it
  stops being true is worse than a slow button. A `checked_at` stamp with an
  explicit "this is from Tuesday" label is the shape if this is revisited.
- **It inspects one spelling of each page.** `http://www.example.com/x` folds
  onto `https://example.com/x`, because the redirecting twin can only ever
  answer "Page with redirect". On arak-sa.com that halved the wait — the 2021
  `www` sitemap submission is still registered alongside the apex one, so
  every page was in the list twice. Removing that stale submission in Search
  Console is a one-click job nobody has done; until then the fold is carrying
  it.

Found by the first real run, not scheduled here because they are site work
rather than code: **24 of 89 pages are unknown to Google**, including every
lighting-services page and both `/services/lighting-controls` URLs — an entire
business line with no page in the index.

## Email — built 2026-09-27, what is still owed

The section is live (contacts, groups, marketing campaigns through Resend,
cold outreach written but not sent, warm-up, webhooks, unsubscribe). Parked:

- **Cold sending — built 2026-09-29 (sending half).** Outreach mailboxes
  (Google, app password, SMTP), the 10-minute sending run driven by the n8n
  workflow "Email — cold sender", ramp 5 → 10 → limit, working hours, threaded
  follow-ups, 90-day re-contact rule, bounce brake, master switch. Rules in
  `src/lib/email/cold.js`, engine in `api/email/_cold.js`. Setup owed by the
  owner: docs/EMAIL-SETUP.md sections 12–16. Still to build:
  - **Reading the inboxes (next).** IMAP sync per mailbox: a reply sets
    `replied_at` (on the contact and the send) and cancels queued follow-ups;
    a bounce notice (mailer-daemon, DSN) bounces the contact; "stop / remove
    me / إلغاء" unsubscribes; AI sorts the rest into interested / not now /
    out of office. `imapflow` and `mailparser` are already installed, and
    `email_sends.message_id` is stored for matching. Until then replies are
    marked by hand (Contacts → "They replied").
  - **Microsoft 365 mailboxes — built 2026-09-28.** Company arak-sa.com
    accounts connected by signing in (Graph, `api/email/_graph.js`), sending
    through Graph and reading replies/bounces from their inboxes every run
    (`readReplies` in `api/email/_cold.js`). Setup owed: docs/EMAIL-SETUP.md
    §17 (Entra redirect URI + client secret, three Vercel env vars). The
    inbox reader below is now only owed for Google mailboxes.
  - **Instantly as a second sender.** `email_mailboxes.provider` allows
    'instantly'; nothing uses it yet.
  - **Stuck 'sending' rows — built 2026-09-29 (#146).** Settled from a
    Microsoft mailbox's Sent Items / Drafts every run; the rest are listed on
    Overview and the campaign page for a person (went out / send again / drop).
- **Research leads → cold contacts — built by hand 2026-09-29 (#147).** Contacts
  tab lists open leads with search links and "Add contact" (tied by
  opportunity_id). An email-finding service (Hunter/Apollo) is still not wired.
- **Website sign-up — built 2026-09-29 (#148).** The contact form's quiet "i"
  holds a pre-ticked marketing box; ticked enquiries become opted-in marketing
  contacts in "Website enquiries". Website side: 055-Junaid/arak-lighting-website#4,
  **not merged** (merging deploys the live site). See EMAIL-SETUP.md §18.
- **Address verification** before a first send to an old list, and before
  importing any bought cold list (MillionVerifier, ZeroBounce, ~$0.002–0.008
  per address). The importer rejects malformed addresses only.


## Ghusn Brand Brain — what the sources did not supply (raised 2026-10-01)

Built from the Ghusn website repository and the 20-page company profile, and
live in the Ghusn workspace (`supabase/seed_brand_brain_ghusn.sql`). These are
the gaps left on purpose rather than filled with a guess.

- **No social handles.** Neither the site nor the profile prints an Instagram,
  Snapchat, TikTok or LinkedIn handle, so Contact carries phone, email, office
  and website only.
- **Competitor Watch is empty.** No source names a rival. "Find rivals" on the
  Insights page proposes them; nothing was invented.
- **Compliance is blank.** Opt-in and unsubscribe wording is needed before any
  WhatsApp or email campaign goes out for Ghusn.
- **The Asset Library holds the two logos and nothing else.** Light and dark
  lettering, uploaded 2026-10-01. The project photography in the website
  repository (`dist/assets/`) was left out by the owner's choice, so the
  picture models have the palette and the style rules but no real Ghusn photo
  to work from.
- **Projects: 25+ or 5+?** The website says 25+ projects; the profile PDF
  prints "+05". The Brand Brain follows the website. If the PDF is the right
  one, Company Facts needs one line changed.
- **"A greener arrival" does not name its client in captions.** The site copy
  says "a recognizable international brand" although the photo and the client
  list both show McDonald's. The project entry keeps the site's wording until
  someone confirms the name may be used.
- **Two market lines are general knowledge**, labelled as such in Market
  Context: the national green-space programmes, and the cool-season note.
- **Website address.** Contact uses `www.ghusnsa.com`, from the profile. The
  rebuilt site's README says it does not modify that domain, so the address
  is right only once the new site is pointed at it.
