# Arak company hub: plan (not started)

Written 2026-10-19 on the owner's idea: split the app into sections by type of
work (Marketing, Sales, CEO, …) instead of one long sidebar, each person given
only the sections they need, and one AI assistant that knows every part.
**Nothing is built yet. Start only when the owner says so.**

## What the owner means (clarified 2026-10-19)

Not a second Odoo. The aim is to **split our own app into sections by type of
work**, because one long sidebar holding everything (dashboard, CEO, sales,
brand, marketing, social, insights, admin, assets, settings) is confusing
already and will not survive more features.

## The navigation pattern: app rail + per-module sidebar

Three patterns are common in business software:

| Pattern | Who uses it | Good | Bad |
|---|---|---|---|
| Launcher only: home screen of tiles, each app its own menu | Odoo, Zoho One | very clear separation | switching apps always goes back through the home screen: an extra click every time |
| Hubs in a top bar with drop-down menus | HubSpot, Salesforce (tabs) | familiar, wide pages | top bars get crowded, and drop-downs are poor on phones |
| **App rail + module sidebar** | Slack, Linear, Microsoft Teams, Notion, Shopify admin | one click between modules, and each module shows only its own pages | needs icons people learn |

**Recommended: the third, plus a launcher Home.** It is the current standard
for multi-module business apps.

- **The rail:** a narrow icon column on the far left, one icon per module:
  Home, CEO, Sales, Marketing, Insights, Admin. It shows only the modules that
  person has.
- **The module sidebar:** next to the rail, the pages of the open module only.
  Marketing shows ~8 pages instead of everyone seeing all 20.
- **Home:** a launcher page of tiles, as in the Odoo screenshot. It is the
  first screen and the phone layout, and each tile shows one live hint (for
  example, "3 posts waiting").
- **Always present, whatever the module:**
  - the assistant (drawer)
  - the bell
  - Requests
  - search, as a ⌘K command bar that jumps to any page, lead or post
  - the account menu (Settings, change password, sign out)
- **One-module people** (sales reps today) get no rail at all: they land
  straight in Sales, as the Leads-only app does now.
- **URLs carry the module** (`/sales/leads`, `/marketing/schedule`), so a link
  always opens in the right section. Every old URL redirects, so no bookmark
  or email link breaks.
- **Phone:** the rail becomes the top of the drawer as a module picker, and
  Home shows the tiles.

### Where today's pages go

| Module | Pages |
|---|---|
| Home | launcher tiles, today's to-dos |
| CEO | control panel (Home, Sales team, Key accounts, Opportunities, Marketing, Targets, Brief) |
| Sales | Leads (Inbox / Pipeline), Target accounts, Opportunities sent to sales; settings: lead agent, Agent Brief / battle cards |
| Marketing | Content Planning, Creative Studio, Schedule, Post Queue, Social media, Auto-replies, Email, Media Library, Brand Brain |
| Insights | Research, Analytics (social + website), competitors |
| Admin | Team & Access, AI spending, connections |
| Global (not a module) | Assistant, Requests, bell, search, account |

This is mostly a navigation change: the pages themselves stay as they are.
Later modules (Finance, Projects over Odoo data) slot in as new rail icons.

## Later: data from Odoo

The CEO's rule 7 still holds: anything Odoo owns (deals, invoices, projects) is
**shown** from Odoo, never re-entered here.

## The modules

| Module | For | Exists today | New work |
|---|---|---|---|
| Home (launcher) | everyone | — | the tile screen, showing only your modules |
| CEO | CEO, admins | `/ceo` panel (branch `claude/ceo-control-panel-analysis-a08891`, not merged) | live Odoo numbers |
| Sales | sales team; sales admin manages | Leads, lead agent, battle cards, Targets, Agent Brief, Pipeline (#244, open) | Odoo deals and quotes read back |
| Marketing | Shadia and the marketing team | Brand Brain, Studio, Content Planning, Schedule, Social, Post Queue, Auto-replies, Analytics, Email, Media | none, regrouping only |
| Research | marketing, sales admin, CEO | Research runs, competitors, opportunities | none |
| Finance | CEO, finance person | — | read-only: invoices, collections, overdue >60 days, margin per project (needs Odoo Accounting in use) |
| Projects | project managers (own projects), CEO (all) | — | read Odoo Project; PM's weekly update written into Odoo (needs Odoo Project in use) |
| Requests | everyone | `/requests` board, tagging, bell | none |
| Assistant | everyone, limited to their modules | the company assistant (#239–#243) | tools grouped by module |
| Admin | app admin | Team & Access, AI spending, agent settings | the module-access screen |

## Access: one model instead of four

- **Today:**
  - `user_access.role`: admin / member / sales
  - `leads_approver` flag
  - `sales_seats`
  - sidebar `adminOnly`
  - an admin check repeated in each server action
- **Plan:**
  - A table `module_access(workspace_id, user_id, module, level)`, with
    `level` = `view` | `work` | `manage`.
  - One SQL function, `has_module(ws, module, level)`, used in every module
    table's RLS policy.
  - The same check in every server action, and in which tools the assistant is
    offered.
  - The launcher, sidebar and routes show only granted modules. The database
    is what actually refuses.
- **Migration from today:**
  - admin → every module at `manage`
  - member → Marketing and Research at `work`
  - sales seat → Sales at `work`
  - `leads_approver` → Sales at `manage`
  - Nobody loses or gains access on day one.
- **Audit log:** every write made through the assistant or a module action
  records who, when and what changed. The CEO asked for this for WhatsApp
  commands (item 36), and it suits everything.

## "Internally linked": the shared key

The link is **Odoo's customer id (`res.partner`) as the shared key**:
- on leads, once approved
- on key accounts (`sales_accounts`)
- on research opportunities, once matched
- on Odoo deals, projects and invoices, natively

An hourly Odoo read keeps a small local copy (partners, deals, quotes,
invoices, projects). Screens and the assistant are then fast and never wait on
Odoo. Each module adds its **tools** to one registry:
- **read tools** for anyone with `view`;
- **action tools** for `work` / `manage`, always behind a Yes / No
  confirmation and logged.

## The model: DeepSeek V4 Flash, from a secure host

Checked on OpenRouter on 2026-10-19 (USD per million tokens, input / output):

| Model | Host | In / out | Note |
|---|---|---|---|
| Claude Opus 5.5 (today, chat and briefs) | Anthropic | 4.00 / 20.00 | current |
| Claude Sonnet 5.5 (today, search and extract) | Anthropic | 2.00 / 10.00 | current |
| DeepSeek V4 Flash | **Azure (US)** | 0.21 / 0.56 | Microsoft, which already holds Arak's mail |
| DeepSeek V4.1 Flash (newer) | Fireworks (US), Together, BaseTen (US) | 0.30–0.45 / 1.20–1.80 | US hosts. Not on Azure yet |

None of these is DeepSeek's own API, so the data never goes to DeepSeek. That
is the "secure provider" requirement. OpenRouter can be pinned to one host with
zero data retention and no training on prompts (`provider.only`, `zdr`,
`data_collection: deny`). The lead agent already uses OpenRouter.

**Honest notes before switching:**
- **Cost is not the problem it looks like.** Real spend has been about
  $10–30 a month. A Flash model makes chat roughly 20–30× cheaper, which is
  real but small in money. The CEO's heavy use (about $70 a month on Opus)
  would become a few dollars.
- **Quality is the risk.** The CEO gets numbers and judgement in Arabic, and
  the assistant works through multi-step tool calls. The lead qualifier
  bake-off showed cheap models can match on a narrow task (DeepSeek V4.1 Flash
  scored 68/68 there). Open-ended company questions are harder.
- **Features we lose by leaving Anthropic:**
  - its built-in web search: Firecrawl takes over, as it already does as the backup
  - prompt caching as built today
  - structured output, which varies by host

  `src/lib/agent/models.js` is the one place models are chosen. A second,
  OpenAI-style adapter (beside the existing Anthropic one) makes the switch per
  job.
- **The proposal:** a bake-off like the lead qualifier's. About 40 real CEO and
  team questions in Arabic and English, each with a known right answer, run on
  Flash and on today's model, scored on correct numbers, correct tool use, Arabic
  quality, cost and speed. Expected result: Flash for the high-volume jobs
  (lookups, WhatsApp short answers, routing, titles, summaries), and a stronger
  model kept for the weekly brief and research synthesis. **The bake-off
  decides, not the price.**

## Before starting: decisions and blockers

1. **Odoo permanent API key** from an Odoo Settings admin. Sales, CEO, Finance
   and Projects all hang off it.
2. **Which Odoo apps Arak will really use.** Finance needs Accounting, and
   Projects needs Project. Neither was seen installed on 2026-10-11.
3. **Hosting limits.** Vercel's free plan is at 12 of 12 functions and runs
   timers once a day. A multi-module app needs either **Vercel Pro (about $20 a
   month, spending)** or its APIs moved onto the n8n box's agent container.
4. **Make the GitHub repo private.** `Hafeez-arak/MarketingMain` is public.
   A company system with finance, HR links and sales logic should not be
   readable by anyone.
5. **Model bake-off approval.** It spends a few dollars on test calls.
6. **PR #244** (lead stages in Campai) against rule 7. Decide with the CEO.
7. **Who gets which module.** A first list: CEO, Shadia, Arif, Ammar, Haitham,
   Hafeez, Junaid.

## Build order, once the owner says go

1. **Navigation:** rail, module sidebars, launcher Home, ⌘K search, module URLs
   with redirects from the old ones. Access is still today's roles. One PR, no
   new features.
2. **Access by module:** `module_access` + `has_module()`, and the Admin screen
   to give people modules. Maps today's roles one-to-one.
3. **Odoo read sync:** partners, deals, quotes, invoices; the shared partner key.
4. **Assistant by module:** tool registry, audit log, model adapter + bake-off.
5. **CEO panel live** on Odoo numbers; then Finance and Projects as new modules.
6. **WhatsApp** as another way into the same assistant.

Step 1 needs none of the decisions above, so it can start the day the owner says go.

## Progress

**Step 1 (navigation) built 2026-10-19 on branch `v2`.** Not merged; v1 stays live and untouched, and nothing in the database changed.
- Registry: `src/lib/modules.js`, the one place a section or page is named (tested in `modules.test.js`).
- Shell: `components/layout/Rail.jsx` (sections), `Sidebar.jsx` (the open section's pages only), `useNavBadges.js` (counts read once and shared), and `pages/home/index.jsx` (tiles).
- Routes: every page lives under its section in `App.jsx`. v1 addresses fall through to `LegacyOrNotFound`, which redirects with the path tail, query, hash and navigation state kept. The sales team's own app keeps `/leads`.
- The assistant's page context reads v2 paths in v1's words (`toLegacy`), so it knows every page as before.
- To check it without signing in: `/dev/v2.html` (`?page=/schedule` for a v1 address, `?as=member` for a member's view).

**Before v2 can replace v1:**
1. Sweep the links inside pages to the new addresses. They work today through the redirect, but each one costs a hop.
2. The CEO panel's migration (`20261025_ceo_control.sql`), which this branch carries.
3. Step 2: per-person section access.

## v2 look (decided 2026-10-19, second try)

The first try, Arak's black and gold, was rejected as "weird". On the owner's
request ("look on the internet for simple, clean, professional ones with a
similar format") the reference is now **shadcn/ui's sidebar blocks**, the
open-source design system behind Vercel's dashboards and many SaaS apps. Its
`sidebar-09` is our exact layout: an icon rail beside a second panel. The
look follows Linear, Stripe and Attio, which every 2026 roundup cites as the
clean, professional standard. Their shared rules: a light, quiet frame,
neutral greys, near-black for the main action, and colour only for state.

- **Frame:** the rail and the section menu sit on `#fafafa` with 1px
  `#e4e4e7` lines. The page is a **white rounded panel** inset on that frame
  (shadcn's "inset" layout), edge to edge on a phone.
- **Navigation:** grey icons. The current item is a soft grey pill
  (`.nav-active`) with no marker bar and no colour.
- **Actions:** near-black buttons (`#18181b`) with white text. Secondary
  buttons are white with a border.
- **Corners:** 6px controls, 8px boxes, 10–12px cards and modals. Every white
  bordered box gets the radius from one CSS rule (`index.css`), because v1
  drew 136 of them by hand.
- **Type:** Inter, with IBM Plex Sans Arabic for Arabic.
- **Colour = state only:** green good, yellow watch, red bad. Shown as small
  dots, never as fills or thick edges. Notification counts are red.
- **No gradients, glows or purple.**

All of it is in `tailwind.config.js`. The class names v1 uses stay and only
their values change: `amber` is now the neutral accent scale (light end =
hover/selection grey, dark end = ink), and `stone`/`clay` are neutral greys.
So every v1 page takes the look without edits.

## Progress, 2026-10-19 (continued)

- **Step 2, section access:** built and verified on the local database
  (migration 20261101).
- **Tasks, follow-ups and meetings:** built (docs/TASKS-PLAN.md, 20261102).
- **Step 3, the Odoo read sync:** built against a fake Odoo (20261103). It
  covers:
  - an hourly, incremental read of deals, stages, quotes and orders,
    invoices and projects, for whichever Odoo apps are installed;
  - the CEO's six numbers, live;
  - key accounts' last order and open deals;
  - the weekly email's quotes and win rate;
  - "To fix in Odoo" with links (requirements 16, 17, 32, 33).

  It goes live when a permanent Odoo key is saved on Leads → Agent
  settings → CRM.
