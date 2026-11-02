# arak-sa.com: SEO, AEO and GEO plan

Updated 2026-11-02 with the first AI-answers baseline. This replaces the plan
written on 2026-11-01. Phases 0–4 of that plan are built, on branches, waiting
for the single merge.

## Where we start from

| Measure | Baseline | Source |
|---|---|---|
| Google clicks from searches that do not name ARAK | 9 in nine weeks (2,364 impressions) | Search Console, to 2026-10-30 |
| Pages in Google's index | 64 of 88 | URL Inspection, 2026-11-01 |
| Service pages in the index | lighting design, facade, outdoor and controls: **none** | URL Inspection |
| Visits from AI assistants | 67 in 28 days, 65 from ChatGPT | GA4 |
| **ARAK named in AI answers** | **0 of 15** | baseline below |
| **arak-sa.com cited in AI answers** | **0 of 15** | baseline below |
| Real leads tracked | none (only a contact-page load is counted) | GA4 |

## The AI-answers baseline, 2026-11-02

Fifteen buyer questions (the suggested list in `WEBSITE-SETUP.md`), answered
by an assistant with live web search that knew nothing about ARAK. Scored with
the app's own code (`src/lib/agent/aiAnswers.js`). Run free, inside a Claude
Code session, before the website changes deployed. Not stored in
`ai_answer_checks`, because that table does not exist yet.

**ARAK was named in none of the 15 answers. The site was cited in none.**

Who was named instead:

- Tracked rivals: Lumiere Group (4 answers), Nassli (3), Nouran (2), Al
  Babtain/Rayon (2), Huda Lighting (2), Armada, Al Nasser, NLC (1 each).
- **Not tracked, and named more than any tracked rival:** Lightech (5),
  Technolight (4), Saudi Lighting Company (4), Amensmart (3), WSP's lighting
  studio (3), Visual Energy (3), A-Control (2), plus ABB, Schneider and Signify
  as manufacturers. Add the first four to the Research page's competitors so
  the monthly check counts them.

What the answers were built from. **This is the finding that changes the plan:**

| Source | Answers | What it is |
|---|---|---|
| gulfconstructiononline.com | 5 | Trade magazine. Lightech's company feature alone was used in 5 answers. |
| knx.org / projects.knx.org | 3 (every KNX question) | The KNX Association's project database. Integrators submit their own projects. |
| new.abb.com references | 3 | ABB's project case studies, naming the local partner. ARAK carries ABB. |
| linkedin.com company pages | 4 | Company "About" pages. |
| sabbar.com | 4 | Job ads. Competitors' hiring posts read as evidence they exist. |
| architizer.com, design-middleeast.com, meconstructionnews.com | 1–2 each | Firm profiles and trade news. |

Not one answer used a company's own service page as its main source. Assistants
answer "who does X in Riyadh" from **third parties that name companies**.
ARAK's own site is necessary (it is what a cited source links to, and what
Google indexes), but on its own it does not get ARAK into the answer.

## The plan, in order

### 1. Ship what is built (this week)

All of it goes live in one merge. The steps are in `docs/WEBSITE-SEO-RELEASE.md`.

- **Website:** `release/seo-2026-11`, which combines PRs #5, #6, #7, #8, #9 and
  #4. It covers:
  - internal links and indexing fixes
  - lead events
  - technical fixes and IndexNow
  - titles, FAQs and project detail
  - structured data
  - the consent box

  The blog is left out.
- **Marketing app:** #288, which adds the Leads, AI visits, Target searches and
  Named-in-AI-answers panels.
- **Then:** request indexing for the four service pages (EN and AR), mark the
  three lead events as key events in GA4, add the staff-traffic filter, and set
  up Bing Webmaster Tools.

### 2. Get named where the answers come from (the next four weeks)

Ordered by what the baseline showed assistants actually read.

1. **KNX project database: the fastest win.** Every KNX question was answered
   from it, and ARAK has named KNX projects the database does not list: Riyadh
   Air Head Office, Four Points by Sheraton, Milling Company MC-2, Delfino
   Mayfair and Naba AlSaha Hospital. Submit each one (projects.knx.org, through
   the company's KNX partner account) with photos, scope and year, linking to
   its page on arak-sa.com.
2. **Manufacturer reference pages.** Ask ABB (and Zennio and Lutron) for a
   reference case study on one ARAK KNX project. ABB's references were used in
   3 answers and name the local partner.
3. **Trade press.** Pitch a company feature to Gulf Construction Online. ARAK
   has two stories ready: fifty years (1976–2026) and the Naba AlSaha Hospital
   smart-system contract. Send the same release to Design Middle East and Arab
   News. Each article is a third-party source naming ARAK, with a link.
4. **Profiles and directories:**
   - Google Business Profile
   - Architizer firm profile
   - Clutch
   - Muqawil contractor registry
   - Wikidata
   - Correct the wrong ones: Yandex Maps calls ARAK a "management company";
     GulfTalent says "Retail".

   See `AI-CITATIONS.md` and the website repo's `docs/ENTITY-SETUP.md`.
5. **LinkedIn company page.** Assistants read the About section and
   specialties. Make them say, in plain words, what the website says:
   lighting design consultancy, KNX lighting control, facade and outdoor
   lighting, smart poles, Riyadh, since 1976.

### 3. Make the website the page those sources link to (weeks 3–8)

1. **Project pages become case studies.** Year, client, consultant,
   contractor, systems and scope for each project, in the same shape a KNX
   database entry or a trade article uses, so either can cite it. This needs
   the facts from the team, Riyadh Air and LADUN first.
2. **A News page.** The fifty-years story and contract wins, each with a date.
   A press release needs a page to link to.
3. **Blog.** To discuss. The `feature/internal-blogs` branch stores posts on
   disk, which is switched off in production, so it needs a storage decision
   before it can go live.
4. **Smart pole pages.** These wait for the owner's update of the C°LB content.
5. **Speed.** Netlify's edge never serves the pages from cache (TTFB about 1 s).
   This is a dashboard setting to look at.

### 4. Measure every month

- **Named in AI answers:** the same 15 questions on the first of each month.
  Either press the app's button (about $1) or ask for a free run in a Claude Code
  session. One check is a sample; read the trend across three.
- Analytics → Website covers the rest:
  - target searches moving onto their own pages
  - non-brand clicks
  - AI visits
  - real leads by channel
- Index health: re-run after each release until all 88 pages are indexed.

## Targets for 2027-02-01 (90 days)

| Measure | Now | Target |
|---|---|---|
| Pages indexed | 64 / 88 | 88 / 88 |
| "lighting consultant riyadh" | homepage, about position 15 | the lighting design page, top 5 |
| Non-brand Google clicks a month | about 3 | 40+ |
| Named in AI answers (15 questions) | 0 | 4+, starting with the three KNX questions |
| Real leads tracked by channel | none | every enquiry, phone tap and email tap |
