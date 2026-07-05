# ARAK Content Studio — Build Plan & Roadmap

> Living document. This is the reference we build against. Update the status
> boxes as work lands. Last reviewed: 2026-07-04.

---

## ⭐ PIVOT — 2026-06-30: Brand Brain becomes the core

The client redefined the product. The **Brand Brain is now the single source of
truth** — a structured knowledge base + asset library that is the **persona of the
company** and powers everything downstream (plan → content → approval → publish),
and later **email + WhatsApp** marketing too. This supersedes the older framing
where Brand Brain was just a profile the generators read.

**Build order the client wants (do in sequence):**
1. **Fix the Instagram reel** — ✅ DONE 2026-06-30. Root cause was deeper than
   params: **Wan 2.5 i2v-fast is broken on Replicate** (model-level E002 on every
   input, incl. its own demo image — verified live; FLUX works on same token, so
   it's not the account). Original workflow also had: invalid `num_frames`/`fps`
   params (real model uses `duration` enum 5/10s only), wrong endpoint, an
   **orphaned failure node**, and **no loop cap** (the 30-min hang). Fix: swapped
   the video node to **LTX-Video** (native Replicate, ~18s/clip, ~$0.03–0.05,
   proven working), cover switched FLUX→**PNG** (i2v rejects webp), added real
   failure detection + a 40-poll timeout guard. Backup at
   `…Instagram Reels (Manual).BACKUP.json`. Quality upgrade to Kling/Veo = post-MVP.
2. **Rebuild Brand Brain from scratch** — structured modules + asset/image upload.
   *In progress (2026-06-30):* schema migration written
   (`supabase/migrations/20260630_brand_brain_v2.sql` — 9 new `brand_profile`
   columns + `brand_assets` / `brand_suppliers` / `brand_competitors` tables +
   `brand-assets` Storage bucket). Data layer (`brandBrain.js`) + grouped
   text-module UI (`BrandBrain.jsx`: Identity & Voice / Guardrails / Audience /
   Market & References / Visual) done; `buildInstructionsString` enriched but
   backward-compatible so existing IG/LinkedIn generation is unaffected.
   **Next:** asset-library uploads → products sheet + suppliers/competitors
   editors → wire the new modules into generation (on-demand product lookup).
3. **Image modes 1 & 2** — direct asset reuse + caption-on-real-photo (keep mode 3).
4. **Monthly plan generation** — evolve Campaign Planner to read the Brain.
5. **Content generation** — per planned slot, across formats (single/carousel/reel).
6. **Approval + manual export** — whole month approved up front → clean export.

**Brand Brain modules:**
- **Persona / identity & voice** — mission, positioning, value prop, story, tone.
- **Visual identity & asset library** — logo, colors, type + uploaded assets.
- **Products** — a linked **Excel/CSV sheet** read on demand (NOT inline, to avoid
  context bloat) + **~40–50 supplier partners** listed directly.
- **Audience** — segments/personas (architects, contractors, developers in KSA).
- **Guardrails + competitors + market** — dos & don'ts, competitor watch, KSA /
  Vision 2030 calendar.

**Image strategy — 4 modes:** (1) direct asset reuse (logos, no AI) · (2)
caption-on-real-photo (upload real photo → AI caption) · (3) AI text-to-image
(current FLUX, keep) · (4) reference-conditioned generation (client ref
image/video/reel → AI generates in that style; needs image-conditioned model →
**later phase**). Modes 1–3 are MVP-ready.

**Publishing:** MVP = **manual export** to Instagram, Snapchat, LinkedIn. Auto-publish
deferred but scoped for awareness: IG feasible (Graph Content Publishing + Meta App
Review), LinkedIn feasible (Posts API + access approval), **Snapchat has no public
organic-post API → stays manual longest**. Tokens → `social_connections`.

**Deferred ideas:** mode-4 reference generation · "combine 3–6 posts into one
combined / Instagram grid-mosaic post" (mobile-first) · auto-publish · email · WhatsApp.

> Sections below predate this pivot (they describe the IG+LinkedIn internal-tool
> MVP). They stay valid as the base; this pivot section is the current direction.

---

## 0. How to use this doc

- **Section 3** is the single source of truth for *what is actually built right now*.
- **Section 5** defines the MVP — the cut line for "sellable to a second paying customer."
- **Section 6** is the phased task list. Each task has a checkbox and a "done when".
- When something ships, tick its box and move the one-liner into Section 3.
- Anything marked 🔴 is a hard blocker / dealbreaker; 🟠 important; 🟡 nice-to-have.

---

## 1. What the product is

**ARAK Content Studio** — an AI-powered social media content platform. Plan,
generate (caption + image + video), schedule, and approve Instagram & LinkedIn
content with a consistent brand voice, no designer/copywriter per post.

- **Origin:** internal tool for Arak Lighting (KSA architectural lighting).
- **Direction (DECIDED 2026-06-29):** **internal Arak Lighting product only** — *not*
  a SaaS, for now. Build it to run Arak's own Instagram + LinkedIn marketing
  end-to-end. The SaaS multi-tenant ambition is parked, not deleted — see Section 5.
- **What "internal tool" changes:** single tenant (Arak), so we do NOT need n8n
  workspace-awareness, per-workspace webhook config, billing, or self-serve
  onboarding right now. Those already-built SaaS bits just sit dormant and harmless.
- **Long-term differentiation (if it ever becomes SaaS later):** Brand Brain depth,
  real diffusion generation (FLUX/Wan), Arabic-native + KSA-holiday-aware calendars.

---

## 2. Architecture (the 3 systems)

```
  React app  ──POST job──▶  n8n workflows  ──calls──▶  FLUX / Wan / LLM
  (Vite, RR7)              (AI orchestration)          (the actual models)
      │                          │
      │  REST + supabase-js      │  writes results back
      ▼                          ▼
            Supabase  (Postgres + Auth + Storage + RLS)
            project: "Arak Marketing" (vxjhfvehccftvajgtqtv, ap-southeast-1)
```

- **No app server.** The React app talks directly to Supabase REST/`supabase-js`
  and to n8n webhook URLs. There is no Node/Express layer.
- **Auth/tenancy:** Supabase Auth + Postgres RLS. `is_workspace_member()` gates
  every content table. `handle_new_user()` trigger: `@arak-sa.com` emails auto-join
  the Arak workspace; everyone else gets a fresh isolated workspace.
- **Generation:** every AI job is a webhook POST to n8n. Two patterns:
  - *synchronous* (captions, single images, plan) — await the HTTP response.
  - *fire-and-forget + poll* (Reels, 2–4 min) — fire webhook, poll Supabase table
    until the result row appears. **This is the template for all future
    long-running jobs.**

### Key files
| File | Role |
|------|------|
| `src/store/AuthContext.jsx` | Real auth/session + workspace resolution. Source of truth for identity. |
| `src/store/appStore.jsx` | Legacy local reducer (UI state, webhook URLs). **Not** identity anymore. Still holds dead code. |
| `src/lib/supabaseClient.js` | Single `supabase-js` client from env vars. |
| `src/lib/brandBrain.js` | Fetch/save brand profile, `buildInstructionsString()`, `logEditFeedback()`. |
| `src/lib/campaignPlanner.js` | `requestCampaignPlan()` + `writeCampaignPosts()`. |
| `src/lib/designSuggestion.js` | Deterministic style/aspect-ratio hint pre-generation. |
| `src/pages/social/InstagramPage.jsx` (~3.9k lines) | The entire IG surface — create, approve, calendar, reels. |
| `src/pages/social/LinkedInPage.jsx` (~2.8k lines) | Same shape for LinkedIn. |
| `src/components/ui/index.jsx` | Shared component library — highest-leverage place for visual changes. |

---

## 3. Current state — what actually works (✅) vs not (❌)

✅ **Built and working today**
- Real signup/login (Supabase Auth) + workspace isolation via RLS + domain auto-onboarding.
- Brand Brain: structured profile per workspace, feeds every generation call.
- Edit-feedback logging: every human edit to AI copy is captured (`brand_edit_feedback`). *Logged, not yet used.*
- Campaign Automation: goal + date range → dated multi-platform plan written to schedule tables. KSA-holiday-aware.
- Instagram: full create / AI generate (caption+image) / approve / monthly calendar / day editor / regenerate / Reels (FLUX + Wan 2.5).
- LinkedIn: same shape (minus a local-only video brief planner not wired to a backend).
- Media Library, unified Schedule view, Approvals queue.
- App reads the signed-in user's session (not a pasted key).

❌ **Present in UI but NOT functionally built**
- Facebook / TikTok / X — routes only, no generation pipeline.
- Email — early stub.
- Analytics — counts the app's own records only. **No real engagement/reach/follower data.**
- Team/roles — local-only list, no real invite system.

🔴 **Explicit gaps (the important ones)**
- **No OAuth publishing.** Nothing posts to IG/LinkedIn via their APIs. Needs registered Meta + LinkedIn apps. *Dealbreaker for a social tool.*
- **n8n is single-tenant.** Authenticates with one shared key scoped to the legacy Arak workspace. `workspace_id` is now *sent* in payloads but **no workflow reads it yet** — so generation doesn't truly work for a second tenant.
- **Webhook URLs are per-browser** (localStorage), not per-workspace in the DB. A new tenant/device sees all 8 fields blank.
- **No billing.** `subscriptions` table exists; nothing wired to Stripe.
- **`social_connections` tokens are plain text** — must encrypt before storing real OAuth tokens.

🟠 **Technical debt**
- Two parallel state systems (`AuthContext` vs `appStore`) never merged; `appStore` has dead fields (`supabase`, old `workspaces`).
- ✅ RESOLVED: The two "Schedule" webhooks (`instagramSchedule`/`linkedinSchedule`) are **vestigial** — the Monthly Schedule workflows run on an n8n **cron** (IG `0 6 * * *`, LI `0 5 * * *`) that reads pending `*_schedule` rows directly. Leave those two Settings fields blank.
- Only ONE Supabase project exists → **dev currently runs against production data.** No staging.
- `.env` with real anon key is committed to the repo.
- Supabase security-advisor flagged 2 pre-existing issues (a SECURITY DEFINER view, 2 functions w/ mutable search_path).

---

## 4. North Star (the long-term vision)

From the founder's vision notes — the eventual autonomous AI marketing manager.
These are *beyond* the sellable MVP and inform direction, not near-term scope:

Brand learning · Trend looking & prediction · Content generation strategy ·
Autonomous execution · Content intelligence · Voice/tone learning ·
Marketing strategy planning · Analytics-based strategy & recommendations ·
Competitor monitoring · Conversational AI Manager Agent.

The through-line that unlocks most of these is the **measure → learn → adapt loop**,
which is gated on real analytics (MVP) + accumulated data (time). Build the loop
first; the "intelligence" features become possible only once data flows.

---

## 5. MVP definition — the cut line 🎯  (INTERNAL ARAK TOOL)

**Goal:** Arak's marketing team can log in, generate on-brand Instagram + LinkedIn
content (caption + image, and reels), plan a monthly calendar, review/approve it,
and **publish to Arak's own accounts** — reliably, with the existing single-tenant
n8n + Supabase. That's the product.

A feature is in the MVP only if removing it blocks that sentence.

| In the internal MVP (🔴 must-have) | Parked — only matters if we go SaaS later |
|---|---|
| Existing build verified working end-to-end (full QA) | n8n workspace-awareness (`workspace_id`) |
| n8n live with the 6 workflows + webhooks wired into the app | Per-workspace webhook config in DB |
| AI generation working (IG + LinkedIn + reels) | Self-serve onboarding for other companies |
| Publishing to Arak's IG + LinkedIn accounts | Billing / Stripe |
| Basic real analytics on Arak's published posts | Multi-tenant RLS hardening, token encryption at scale |
| | Agency / white-label, Arabic Brand Brain, FB/TikTok/X |

> **DECIDED 2026-06-29:** Product is an **internal Arak tool**, single-tenant. All
> SaaS machinery (multi-tenancy, billing, onboarding) is parked. Auth/login stays
> (Arak team needs accounts), but cross-tenant isolation is not a priority.
> **First milestone: make everything already built actually work, then publishing.**

---

## 6. Phased roadmap

> Phase numbering aligns with the original handover. Each task: `[ ]` checkbox +
> **done when**. Tackle phases roughly in order; tasks within a phase can parallelize.

### 📍 Webhook → Settings field mapping (reference)
Paste each n8n **Production URL** into Settings → Integrations:

| Settings field | Workflow file | Webhook path |
|---|---|---|
| Instagram Workflow | Instagram Manual Generation | `arak-instagram` |
| Instagram Reels Webhook | Instagram Reels (Manual) | `arak-instagram-reels` |
| Instagram Schedule — Regen Image | Instagram Monthly Schedule | `arak-instagram-schedule-regen` |
| LinkedIn Workflow | LinkedIn Manual Generation | `arak-linkedin` |
| LinkedIn Schedule — Regen Image | LinkedIn Monthly Schedule | `arak-linkedin-schedule-regen` |
| Campaign Planner | Arak Campaign Planner | *(get JSON to confirm)* |
| Instagram/LinkedIn Schedule | — | **leave blank** (cron, not webhook) |

Note: the two Monthly Schedule files each contain TWO things — a daily **cron**
(the automation, no config needed) + a **Regen webhook** (paste URL above). The
schedule workflows use n8n's native Supabase credential (`service_role` key) which
must be recreated in n8n Cloud; the manual + reels workflows use raw HTTP with keys
baked in, so they work as-imported (until those keys are rotated — see §10).

### ⭐ MVP COMPLETION CHECKLIST (internal Arak tool)
**The MVP value loop:** plan → generate (IG + LinkedIn, posts + reels) → review/approve
→ get content published. "Published" for the MVP = manual export (download image +
copy caption); OAuth auto-publishing is post-MVP (see Phase 2). Analytics is post-MVP.

**A. Get all generation live & verified** (same task as the proven IG flow)
- [x] Instagram Manual Generation — imported, wired, **tested & working** ✅
- [x] LinkedIn Manual Generation — wired, **tested & working** ✅ (image quality issue — see §11)
- [ ] **Campaign Planner** — wire `arak-campaign-planner`, test (goal → dated plan → writes `pending` schedule rows). ← NEXT
- [ ] **IG Monthly Schedule** — import, create n8n Supabase `service_role` credential, test via manual trigger; wire regen webhook. ← linchpin (generates the planned/scheduled posts)
- [ ] **LinkedIn Monthly Schedule** — same as above
- ⏸️ Instagram Reels — **DEFERRED to post-MVP** (broken — see §11). Not core to the MVP loop.

**B. End-to-end QA of the built app** (find & fix bugs before calling it done)
- [ ] Sign in → Brand Brain save/load → create → approve, across IG + LinkedIn
- [ ] Calendar scheduling writes rows; Campaign Planner writes rows; Approvals queue works
- [ ] Media library, navigation. Fix issues found.

**C. The "get content out" path** (the MVP's publish step)
- [ ] Verify the team can cleanly **download the image(s) + copy caption/hashtags** for posts AND reels. Make this UX clean — it's how content actually reaches Instagram/LinkedIn in the MVP.

**D. Out of MVP scope — ignore/hide, don't build:** Email, Team/roles, Facebook/TikTok/X.

> **— MVP LINE: A + B + C = a complete, usable internal tool. —**

### Phase 2 — OAuth auto-publishing  (post-MVP — replaces manual export)
- [ ] Meta + LinkedIn apps, OAuth connect, encrypted token storage, publish path.

### Phase 1 — Multi-tenancy  ⏸️ PARKED (only if this becomes a SaaS later)
- ~~n8n reads `workspace_id`~~ · ~~per-workspace webhook config~~ — not needed for an internal single-tenant tool.

### Phase 1 — Make it truly multi-tenant  🔴 (MVP)
- [ ] **n8n reads `workspace_id`** from trigger payloads and writes it onto every result row; remove the anon-legacy RLS exception once n8n authenticates per-workspace. **Done when:** a second test tenant can generate a post that lands in *their* workspace only.
- [ ] **Per-workspace webhook config in Supabase** (new `workspace_webhooks` table or columns; RLS-scoped). Update Settings → Integrations to read/write there; update every webhook read in IG/LI/`campaignPlanner` to use it. **Done when:** a fresh tenant on a fresh browser has working webhooks without pasting anything.
- [ ] **Verify RLS isolation** with two real test accounts (no cross-tenant read/write). **Done when:** tenant B cannot see tenant A's posts via the app or raw REST.

### Phase 2 — OAuth publishing  🔴 (MVP — the core promise)
- [ ] **Register Meta app** (Instagram Graph API: `instagram_content_publish`, `instagram_manage_insights`) and **LinkedIn app** (Marketing Developer Platform) with redirect URIs on a real domain. *Start the review process EARLY — it gates everything; while in dev-mode you can test against your own/test accounts without full review.*
- [ ] **Build the OAuth connect flow** → store tokens in `social_connections`, **encrypted**. **Done when:** a workspace can connect its IG + LinkedIn accounts.
- [ ] **Publish path:** approved post → actually posts to the platform (likely an n8n cron reading `approved` rows → Graph/LinkedIn API → write back the platform `post_id` + `published` status). **Done when:** approving a post results in a live post on a real (test) account, and the platform post id is stored.

### Phase 3 — Real analytics  🔴 (MVP — the feedback loop)
- [ ] **Add metric columns** to the post tables (likes, reach, impressions, comments, saves, `metrics_synced_at`).
- [ ] **n8n/cron pulls insights** per published post from the platform APIs into those columns. **Done when:** a published post shows real engagement numbers.
- [ ] **Rebuild the Analytics page** to read real metrics: per-post performance, per-platform, top performers. **Done when:** Analytics shows real reach/engagement, not record counts.

> **— MVP LINE — Phases 0–3 = a sellable, multi-tenant v1 (manual invoicing). —**

### Phase 4 — Billing  🟠 (DEFERRED — post-MVP, decision: manual invoicing first)
- [ ] **Stripe integration:** checkout + webhook → `subscriptions` table; meter `generation_credits_remaining`. **Done when:** a new tenant can subscribe and credits decrement on generation.
- [ ] **Plan gating** (trial/starter/growth/agency limits enforced). **Done when:** exceeding plan limits is blocked gracefully.

### Phase 5 — Credible-demo breadth  🟠 (post-MVP)
- [ ] Finish Facebook / TikTok / X generation pipelines (reuse the IG/LI engine).
- [ ] Basic engagement inbox (comments/DMs in one place).
- [ ] Real Team/roles invite system.

### Phase 6 — Differentiation  🟠 (post-MVP — the moat)
- [ ] **Arabic-native Brand Brain** + bilingual EN/AR generation.
- [ ] Deeper GCC calendar awareness; vertical starter templates (lighting/hospitality/industrial).
- [ ] **Start mining `brand_edit_feedback`** → prompt refinements / per-workspace voice tuning. (This is "brand/voice learning" from the vision.)

### Phase 7 — Intelligence & the agent  🟡 (north-star)
- [ ] Content intelligence (what works) → analytics-based strategy recommendations.
- [ ] Trend prediction; shallow competitor tracking.
- [ ] Conversational AI Manager Agent on top of all the above.

### Phase 8 — Agency / white-label  🟡 (post-MVP, only if the market pulls)
- [ ] Multi-client workspace management, white-label, per-client reporting.

---

## 7. External blockers (start these on day 1 — they run on someone else's clock)
- **Meta App Review** (`instagram_content_publish`, `instagram_manage_insights`) — 1–4 weeks; can reject. Dev-mode works against your own/test accounts meanwhile.
- **LinkedIn Marketing Developer Platform** access — application required.
- **Stripe account** approval.
- **A real domain** for OAuth redirect URIs (needed before Meta/LinkedIn review).
- **Data accrual:** the Phase 6–7 "learning" features need weeks–months of real engagement data before they produce anything useful — start collecting (Phase 3) ASAP.

---

## 8. Sequencing & realistic timeline (solo, AI-assisted dev)
- **Usable, sellable MVP (Phases 0–3, billing deferred):** ~6–10 weeks of focused work, *if* the Meta/LinkedIn API approvals are started on day 1 and overlap the build.
- **Full vision (through Phase 7):** ~6–9 months calendar time — the back half is design/integration/debugging-heavy where AI codegen helps least, plus data-accrual latency.
- **Overlap the waits:** file Meta/LinkedIn/Stripe + buy the domain immediately, build Phases 0–3 while they pend, plug them in when approved.

---

## 9. Open decisions
**Resolved (2026-06-29):**
- ✅ **Product scope:** **Internal Arak Lighting tool, single-tenant.** Not a SaaS for now. All multi-tenancy/billing/onboarding work is PARKED.
- ✅ **Billing:** Not applicable to the internal tool (parked entirely).
- ✅ **n8n hosting:** **n8n Cloud (hosted).** Workflows imported there.
- ✅ **First milestone:** verify everything already built works (full QA), starting by getting Instagram generation live via n8n.

**Still open:**
- [ ] **Which test IG/LinkedIn accounts** for dev-mode publishing? (real Arak access comes later)
- [ ] **Staging strategy:** separate Supabase project vs schema-in-same-project?
- [ ] **First-customer profile:** which 1–3 GCC brands are the design partners to build toward?
- [ ] **Access handover from Hafeez:** n8n Cloud login, Supabase project admin, the workflow definitions.

---

## 10. Guardrails while building
- Never test publishing/billing against the real Arak production data — use staging + test accounts.
- Encrypt `social_connections` tokens *before* any real token is ever stored.
- Keep the n8n webhook contract stable where possible (Brand Brain already flattens to the string n8n expects).
- The fire-and-forget + poll pattern is the template for any new long-running job.

## 11. Known issues to optimize (post-MVP — don't block the MVP on these)
- **LinkedIn image generation is inaccurate.** Caption/text quality is good, but the
  FLUX image often doesn't match the brief / expected visual. Likely the `image_prompt`
  construction in the LinkedIn workflow (`Build Image Prompt` node) or the style mapping.
  Revisit when optimizing generation quality. (Reported 2026-06-29.)
- **Instagram Reels stuck in Wan video generation.** Poll loop ran 86× without the
  Replicate prediction ever reaching `succeeded` (~30 min, then cancelled). Likely
  `num_frames: 480` for the default `30s` duration is unrealistically long for an i2v
  model (these do ~5s clips). Also: verify the `wan-video/wan-2.5-i2v-fast` model id /
  endpoint, and add a max-iteration cap to the poll loop (currently loops forever).
  Try a 5s reel (80 frames) to confirm. DEFERRED to post-MVP. (Reported 2026-06-29.)
- (Add new findings here as QA surfaces them.)

## 12. Requested features (post-MVP — net-new scope, not bugs/QA)
- **Reference images in Brand Brain + on post creation.** Let users upload reference
  image(s) so generated visuals match Arak's actual look. This is the *real* fix for
  the image-quality gap (reference conditioning >> prompt tuning). Touches all 4 layers:
  - DB/storage: store refs (Supabase storage + columns on `brand_profile` / post tables)
  - App UI: upload controls in Brand Brain and the create panel
  - n8n: pass the reference image into the generation call
  - **Model swap:** FLUX Schnell is text-to-image only → need an image-conditioned model
    (img2img / IP-Adapter / FLUX Redux-style reference model)
  Recommendation: first feature *after* the MVP loop is complete — unless current image
  quality is blocking team adoption, in which case pull forward. (Requested 2026-06-29.)

## 13. Brand Brain — knowledge centre tracking (updated 2026-07-01)

**Done this pass:**
- Brand Brain schema v2 + v3, UI, and real Arak content seeded from arak-sa.com
  (identity, market, personas, 24 suppliers incl. CLB, logo + 5 project photos).
- v3 "knowledge-centre" expansion: profile fields (contact_info, languages,
  brand_colors, compliance_notes, offers_ctas) + `brand_products` and
  `brand_message_templates` tables — built to also power WhatsApp + email later.
- **FAQ bank removed** per client (2026-07-01) — not wanted.
- **Competitors seeded (Riyadh):** Technolight, Alnasser Lighting, Arclight,
  Rayon/Al-Babtain, Huda Lighting, Alfanar Lighting.
- **CLB** listed as Arak's own in-house manufacturing brand; other products come
  from partner suppliers.
- **Brand colours are PROVISIONAL** (extracted from project photos): warm bronze
  #94765e + charcoal #1b1715 + cream #e0cfbc. Pending official palette from Arak.
- Contact email set to info@arak-sa.com (in v3 migration seed).

**Deferred / to implement later:**
- [ ] **Competitor Watch + Gap Analysis engine** (per strategy PDF) — competitors are
  now listed; the *watch + gap-analysis automation* is a later phase.
- [ ] **Product info via Google Search fallback** — most products are 3rd-party supplier
  brands. Rather than storing every SKU, add an on-demand web-search lookup so the AI can
  fetch info on a specific brand/product only when a post needs it. Client to provide the
  supplier/product list to seed this. (Low priority — "very irrelevant for now.")
- [ ] **2e — wire relational brain data into generation.** `buildInstructionsString()`
  flattens ALL profile text fields (incl. v3: contact/languages/colours/compliance/offers)
  — so the **text/caption brain is already fully wired.** What's NOT passed: the relational
  lists (products, suppliers, competitors, assets). **Client chose to DEFER these
  (2026-07-01)** — "we'll include this later." Half A therefore parked; Half B (photos +
  logo + colours → image pipeline) stays bundled with the reference-image model swap (§12).

**Waiting on Arak (use what we have until then — do NOT block on these):**
- [ ] Official brand colours (hex) + fonts/typography — replace provisional palette.
- [ ] Dark-on-light logo variant (only have white/transparent). *Client: ignore for now.*
- [ ] Product catalogue / SKUs + deeper project case-study details.
- [ ] Preferred WhatsApp opt-out wording + working hours.

## 14. Monthly Planning + Idea Approval (built 2026-07-01)

Client direction: complete the **planning** phase first (UI **and** its data). Plan a
month up front → planner proposes a full slate of post ideas incl. seasonal moments
(Ramadan, Eid, National Day…) → **approve which ideas** proceed → generation is a LATER
phase. Approval here is idea-level (which ideas to generate), separate from the later
content-approval.

**Built:**
- New tables `content_plans` + `plan_ideas` (migration `20260701_content_plans.sql`) —
  **must be run in Supabase SQL editor.** Plans + ideas + per-idea approval status are
  persisted (not ephemeral).
- Data layer `src/lib/contentPlans.js` (CRUD + bulk approve/reject).
- Rewrote `CampaignPlanner.jsx` into a 3-step monthly flow: **Setup** (pick month →
  auto date range, optional focus, platforms, count, seasonal toggle) → **Review &
  Approve** (idea cards with occasion/pillar badges + rationale, per-idea Approve/Reject,
  bulk approve/reject/reset, inline edit, live counts) → **Approved** (summary; queued
  for generation).
- New `ContentPlans.jsx` list page + route `/campaigns/plans` (open/reopen/delete saved
  plans) + "Content Plans" button on the campaigns page.
- Enhanced n8n **Arak Campaign Planner** workflow to emit `title, occasion,
  content_pillar, rationale, suggested_format` and to explicitly create a dedicated post
  per seasonal moment + vary pillars. **Must be re-imported into n8n Cloud** (backup:
  `Arak Campaign Planner.BACKUP.json`).

**Next (per client "after this we'll plan how to improve"):**
- [x] Content generation FROM approved ideas — built §15 below.
- [ ] Verify the planner + monthly-schedule workflows are live in n8n Cloud + URLs set.
- [ ] KSA holidays in the planner are hardcoded 2026–2027 — refresh later.

## 15. Plan → Content Generation + Post Approvals (built 2026-07-02 to 2026-07-04)

**⏸ PROJECT PAUSED HERE (2026-07-04).** This section is the checkpoint for
picking the work back up. Read this before touching plan/content generation again.

**What's built and working:**
- **Plan → Content Generation pipeline.** Approving ideas in the Campaign Planner
  no longer writes to the old schedule tables — it POSTs approved ideas to two new
  n8n **Plan Generation** webhooks (Instagram + LinkedIn), which generate the real
  caption (Claude) + image (FLUX `flux-dev`, image-to-image when references are
  attached) per idea in the background and save into `instagram_generated_posts` /
  `linkedin_generated_posts` with `status: 'pending_review'`, `source: 'plan'`.
  Workflow files: `/Users/junaid/Downloads/Workflows/Arak Lighting – Instagram Plan
  Generation.json` and `...LinkedIn Plan Generation.json` — **must be imported into
  n8n, Supabase credential attached, activated, webhook URLs pasted into
  Settings → Integrations** (`instagramPlanGen` / `linkedinPlanGen`).
- **Centralized review page** at `/social/approvals` ("Post Approvals" in the
  sidebar) — lists Instagram + LinkedIn generated posts together, filterable by
  status/platform, reuses each platform's own post-detail/regen UI. Client
  explicitly wanted this instead of scattering review across the per-platform pages.
- **Richer plan brief (Stage 1).** Setup step gained: featured-products multi-select,
  and an "add extra specific posts" (seed posts) list — each seed post can carry its
  own image(s) right there, with a generate-vs-use-image choice.
- **Editable plan board (Stage 3).** Each AI-proposed idea can be nudged before
  content generation: freeform "your vision for the image" box, a visual-style
  override, and the same per-post image control (attach references, or pick
  "use my image(s)" to skip AI entirely for that post).
- **Image mode, with real count rules.** Every idea has `image_mode`:
  `'generate'` (AI makes it, references just guide it, any count) or
  `'use_reference'` (no AI — the image(s) ARE the post; exactly 1 for a `post`,
  unlimited for a `carousel`). Enforced in `ReferencePicker.jsx`.
  **⚠ NOT YET WIRED on the n8n side** — the Plan Generation workflows still need
  an `image_mode` branch (skip FLUX entirely when `'use_reference'`). This is the
  single biggest gap before content generation is fully correct end-to-end.
- **Removed:** the earlier "campaign-wide reference pool" concept (loose photos,
  AI auto-assigns). Client's call — too ungrounded a decision to leave to silent
  AI assignment. Real photos now attach either to a specific seed post (planning
  time) or a specific card (review time) — same field, two moments to set it.
- **Campaign Planner n8n workflow hardened** (file renamed to `Arak Campaign
  Planner - IMPORT THIS (updated 2026-07-04).json` in the same Downloads/Workflows
  folder — 3 similarly-named files existed, this one is current):
  - Build Prompt now reads `featured_products`, `seed_posts` (build around them,
    don't duplicate), and `existing_ideas` (fixes a real pre-existing bug — the
    "Generate more with AI" top-up sent this field for months but it was never
    read, so top-ups could silently duplicate ideas already on the board).
  - **Found and fixed a live Anthropic API key hardcoded in plaintext** in the
    "Call Claude" node. Moved to an n8n credential reference (`httpHeaderAuth`,
    named "Anthropic API Key") — **user must create that credential in n8n and
    attach it to the node after import.**
  - Model bumped `claude-sonnet-5` → `claude-opus-4-8`, added
    `thinking: {type: "adaptive"}`, `max_tokens` 8000 → 16000, added
    `retryOnFail` (3 tries) — matches the resilience already added to the
    generation workflows' own nodes.
  - **Client-tested and confirmed working** (2026-07-04).
- Migration `supabase/migrations/20260703_plan_brief_and_vision.sql` — **run.**
  Adds `content_plans.featured_products/reference_pool` (latter now unused),
  widens `content_plans` status check (+`'generating'`), adds
  `plan_ideas.image_idea`, `plan_ideas.suggested_aspect_ratio`,
  `plan_ideas.image_mode`.

**Exactly where to resume (in order):**
1. **`image_mode` branch on the Plan Generation workflows** (IG + LI) — when
   `'use_reference'`, skip FLUX, use the given image(s) directly as the post
   (Storage download/store, no generation call). This is the one correctness
   gap blocking the "use my image, no AI" feature from actually working.
2. Reliability polish on the same workflows: FLUX poll loop (currently one 10s
   poll, risky for slower img2img), continue-on-fail per idea, dedup guard on
   `plan_idea_id`.
3. **Caption drafting at plan-review time** (discussed, not started): let the
   marketing person draft + "Edit with AI" a post's caption *before* content
   generation, using the same per-post caption node the generation workflow
   uses (build it once inside content-gen, then also call it from the review
   board) — so rejections at the final approval stage become purely a content-
   quality signal, not an idea/copy signal.
4. Longer-term (Phase 4+ of the overall roadmap — deliberately deferred, needs
   real usage data first): anti-repetition memory from rejection history,
   analytics ingestion, the AI monthly report. See the Claude memory file
   `arak-product-roadmap.md` for the full phased plan — not duplicated here.
