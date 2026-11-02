# Releasing the website SEO work (November 2026)

Everything from the SEO plan goes live together. Two repositories, one
database change, one box redeploy, then the steps only a signed-in person can do.

## What is in it

**Website** (`055-Junaid/arak-lighting-website`, branch `release/seo-2026-11`):

| PR | What |
|---|---|
| #5 | Lighting controls page, service links on the home page and footer, image alts, redirects |
| #6 | GA4 lead events: enquiry sent, phone tap, email tap |
| #7 | robots.txt unblocked, image loading, IndexNow on deploy |
| #8 | Titles in searched words, 19 FAQs, project "lighting in detail" |
| #9 | Structured data: Service, OfferCatalog, project images |
| #4 | Marketing consent box on the enquiry form |

The release branch merges all six. Its one conflict, in the contact form,
keeps both the lead event and the consent sign-up. The combined branch was
built, type-checked and linted clean on 2026-11-02. **The blog
(`feature/internal-blogs`) is not in it.**

**Marketing app** (`Hafeez-arak/MarketingMain`, PR #288): the Leads, AI visits,
Target searches and Named-in-AI-answers panels; migration
`20261108_ai_answer_checks.sql`; the agent handler `aiAnswers`; and the n8n
Website Agent workflow change.

## Steps, in order

| # | Step | Who | Check that it worked |
|---|---|---|---|
| 1 | Merge the website release PR into `main`. Netlify deploys arak-sa.com. | Owner's go, then Claude | The Netlify deploy is green and the deploy log says "IndexNow sent" (202 is normal the first time) |
| 2 | Spot-check the live site | Claude | `/robots.txt` has no Disallow. The `/a8b1d3fcca2ca85eb23ffdad0b41cdb2.txt` key file loads. `/ar` title says شركة إنارة. `/services/lighting-design` has the FAQ and Service JSON-LD. The enquiry form still sends. |
| 3 | Close #5–#9 and #4 as shipped in the release | Claude | GitHub shows them merged or closed with a link to the release |
| 4 | Merge PR #288. Vercel deploys the app. | Claude (API merge) | Analytics → Website shows Leads, AI visits and Target searches |
| 5 | Apply `supabase/migrations/20261108_ai_answer_checks.sql` | Owner in the Supabase SQL editor, or Claude if allowed | The Named-in-AI-answers panel stops saying "Past checks could not be read" |
| 6 | On the n8n box: `git pull`, rebuild the `agent` container, re-import `n8n/workflows/Arak Lighting – Website Agent.json` | Owner (box access) | The panel's Run check button returns answers instead of "Unsupported Website action" |
| 7 | Arak's Brand Brain → Knowledge Centre: add `seo_targets` and `ai_questions` (Multi-line text, "include in prompt" off), with the values in `WEBSITE-SETUP.md` | Owner, or Claude by SQL if allowed | Both panels show their lists |
| 8 | Research page: add Lightech, Technolight, Saudi Lighting Company and Amensmart as competitors | Owner | The next AI check counts them |
| 9 | Search Console → URL Inspection → Request indexing: lighting design, lighting controls, facade, outdoor, each in EN and AR | Owner | Index health shows them indexed within days to weeks |
| 10 | GA4: mark `generate_lead`, `phone_click` and `email_click` as key events; add the office IP as internal traffic and activate the filter | Owner | See `GA4-SETUP.md` steps 5–6 |
| 11 | Bing Webmaster Tools: import from Search Console | Owner | Bing shows the sitemap read |
| 12 | Google Business Profile, Wikidata, Clutch, KNX project database | Owner and team | See `WEBSITE-SEO-PLAN.md` §2 |

Steps 1–4 can happen in one sitting. Steps 5–7 make the AI check work in the
app; until then it can be run free in a Claude Code session.

## Rolling back

- **Website:** in Netlify → Deploys, "Publish deploy" on the previous production
  deploy. That takes effect at once, without a git revert. Then revert the merge
  commit on `main` at leisure.
- **App:** revert the #288 merge commit. The migration only adds a table and is
  safe to leave.
