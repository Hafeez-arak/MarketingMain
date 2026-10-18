# The CEO control panel

Built 2026-10-18 from the CEO's requirements (`Campai_Requirements.xlsx`, 36
items). **Not merged**: the owner asked for it to stay on its branch until the
CEO agrees the phased plan below.

## His rule that shapes everything

> Odoo is the single source of truth. Campai is for display and alerts only;
> no data is entered in both systems.

So most of his list is a CEO screen that reads Odoo. Until Odoo is connected:

- the numbers Odoo will own say **"Waiting for Odoo"**. They never show a
  zero that looks like a fact.
- the few facts Odoo will later provide (first reply sent, quote sent and its
  value, last contact with a key account) are marked by hand. The Odoo sync
  will write the same columns, so nothing has to change on the screens.

## What is built (Phase 1a)

| # | Requirement | Where |
|---|---|---|
| 1, 15 | Six numbers, coloured against his targets | `/ceo` Home. `controlKpis` in `src/lib/control/panel.js`. Pipeline, revenue, projects at risk and overdue invoices wait for Odoo. |
| 2 | At most three decisions, each with one button | Home. `controlDecisions`, in this order: late quote (Remind), lead with no owner (Assign, the routing rule's person preselected), late first reply (Remind), quiet key account (Contacted today), new research project (Send to sales). |
| 3 | Auto-assign by customer type or region | `/ceo` → Targets. Rules table, fallback person, on/off switch. `routeWaiting` in `api/leads/_control.js` runs on the website Sheet's 5-minute call and the daily cron. Region is read from the lead's location text (`src/lib/control/region.js`). Only leads arriving after it is switched on are assigned. Assigning forwards the email, as a sales admin's Assign does. |
| 4 | First reply in 4h, quote in 72h, manager told | The clocks run from arrival (`deadlines`). Reps mark "first reply sent" / "quote sent" on the opened lead. Lateness goes into the daily alert and onto Home. |
| 5 | New → Assigned → Quoted → Won/Lost | **Not here.** That is PR #244 (lead Pipeline), still open and to be decided with the CEO. The panel reads `leads.stage` when #244's columns exist. |
| 6 | Approved leads pushed to Odoo | Already built (#186). Waits on the Odoo key. |
| 7 | One row per rep | `/ceo` → Sales team. Open, quotes this month, late (with names), won this month. Won value needs #244's stages or Odoo. |
| 8 | Top 10 customers, red after 30 quiet days | `/ceo` → Key accounts. From `sales_accounts` (the October analysis) plus `last_contact_at`. Amber when no contact was ever recorded. |
| 9 | Five research projects a week, "Send to sales" | `/ceo` → Opportunities. The salesperson gets it in their bell with the details. |
| 10 | Marketing in three numbers | `/ceo` → Marketing. Posts this month against the plan, website leads this month, LinkedIn followers. Leads from social media are not tracked, and the tile says so. |
| 12 | One daily alert | The daily cron (05:00 UTC = 08:00 Riyadh) emails `alert_emails`: late quotes, late first replies, unowned leads, quiet key accounts. Each lateness is told once. The owner also gets it in their bell. |
| 13 | Five-line Sunday summary | The same cron on Sundays, an hour after the brief: improved, got worse, ≤3 decisions, win rate, quotes sent. Sent to `brief_emails`, Arabic first, then English. |
| 14 | Targets page | `/ceo` → Targets. Admin only. Values are checked again on the server. |
| 15 (mobile) | Works on a phone | The app's sidebar is a drawer below `md`. Home fits a phone screen. |
| Hide from CEO | Views, impressions, engagement | The brief is no longer given them (`socialFacts`). The CEO lands on `/ceo` once per visit (`user_access.landing = 'ceo'`). |

Bugs from his "Fix first" sheet, all fixed in this branch:
- **#ERROR! phones:** `LeadAgent.gs` reads the formula text, and the server drops a phone that starts with `#`.
- **Project column:** shows its value as text; the options appear only when opened.
- **Plan named "November":** the auto-name follows the month.
- **29 vs 30 days:** the dashboard uses one 28-day window and one label.

Bug 6 (Sumood Tower shown as lost, Solitaire at "RFQ received") is data in Odoo.
Sales fixes it there.

## Before merging (in order)

1. **The CEO agrees the phased plan.**
2. Apply `supabase/migrations/20261025_ceo_control.sql` by hand. Until then the
   panel says its tables are not set up, and routing and alerts stay quiet. The
   Leads page also needs it, because it now reads `first_reply_at`,
   `quote_sent_at` and `deal_value_sar`.
3. Apply the website form fix. In the website enquiries Sheet's own
   `Code.gs`, write the phone as `"'" + phone` (see LEADS-SETUP §2). Two stored
   website leads have `#ERROR!` and need their number typed in by hand.
4. Fill in the routing rules on `/ceo` → Targets, then switch routing on.
5. The fixed content-plan name (`e99e979b…`, month 2026-09, named November)
   can be renamed in the app.

The daily cron moved from 06:00 to 05:00 UTC, so the newsletter run moves an
hour earlier too.

## Phase 1b: once Odoo has a permanent key

An hourly read of `crm.lead` and `sale.order` fills `odoo` in `controlPanel()`:
pipeline SAR, quotes, win rate, revenue vs target, live key accounts, "Open in
Odoo" links, and missing-data alerts. Vercel Hobby crons run once a day, so the
hourly timer has to be the website Sheet's 5-minute call or the n8n box.

## Phase 2

- Projects (items 10–14, 18) and Finance (30–31): only once Arak actually uses
  Odoo Project and Accounting. On 2026-10-11 neither app was seen installed.
- WhatsApp (19–22, 34–36): needs a dedicated number, Meta business
  verification, approved message templates, a provider, and per-message costs.
  It runs on the n8n box, because Vercel is at 12 of 12 functions.
- Arabic across the whole app: about 115 screens and 1,200 strings, plus
  right-to-left layout.

## Checking it without signing in

`/dev/requests.html?page=/ceo` renders the panel against a made-up company,
run through the real `panel.js`:
- `&mode=clear`: nothing needs a decision.
- `&mode=nomigration`: before the migration.
- `?page=/ceo%3Ftab%3Dteam`: another tab.

Serve the worktree with `npx vite --port 5199` from its folder.
