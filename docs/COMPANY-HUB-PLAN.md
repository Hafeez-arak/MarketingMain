# Arak company hub: plan (not started)

Written 2026-10-19 on the owner's idea: one app with an Odoo-style home screen
of modules (Marketing, Sales, CEO, Finance, …), internally linked, each person
given only the modules they need, and one AI assistant that knows every part.
**Nothing is built yet. Start only when the owner says so.**

## Verdict

The idea is right, with one boundary.

**Right:**
- **One front door.** Today the app is a long sidebar of mixed sections, and
  access is a patchwork: admin / member / sales seat / `leads_approver`, plus
  `adminOnly` sections. A home screen of modules with per-person access is
  cleaner for users and safer, because each module's data is locked in the
  database, not just hidden in the menu.
- **One assistant across everything.** This is where "internally linked" pays
  off. If a lead, a key account, an Odoo deal, a project and an invoice all
  carry the same customer key, the assistant can answer "what is going on
  with this client?" in one step. Today it would need several guesses.

**The boundary: don't rebuild Odoo.** The screenshot is Odoo, which Arak already
pays for, and it already does CRM, Sales, Employees, Time Off, Expenses and
Approvals.
- Building our own **accounting** would be a real risk. Saudi e-invoicing
  (ZATCA / Fatoora) is a legal requirement that Odoo already handles.
- Running two systems is exactly what the CEO's rule 7 forbids: "Odoo is the
  single source of truth, no data entered in both."

So the hub's modules come in three kinds:

| Kind | Meaning | Modules |
|---|---|---|
| **Ours** | Campai is the system of record, because Odoo has nothing for it | Marketing, Research, Requests, Assistant |
| **Over Odoo** | Our screens, Odoo's data. Read from Odoo; any write goes back into Odoo | CEO, Sales (after a lead is approved), Finance, Projects |
| **Link out** | A tile that opens Odoo itself | Employees, Time Off, Expenses, Approvals |

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

1. **Foundation:** `module_access`, `has_module()`, the launcher, and routes and
   sidebar by module. It maps today's roles one-to-one, with no new features.
2. **Odoo read sync:** partners, deals, quotes, and invoices if Accounting is
   used. Hourly, with the shared partner key filled in.
3. **Assistant by module:** the tool registry and the audit log for actions.
   Then the model adapter and the bake-off, and switching jobs where Flash wins.
4. **CEO panel goes live** on Odoo numbers (the branch above, plus the sync).
5. **Finance and Projects** screens, once their Odoo apps hold data.
6. **WhatsApp** as another way into the same assistant (number, Meta
   verification and budget first).
