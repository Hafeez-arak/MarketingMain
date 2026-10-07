# Lead agent: setup

The lead agent reads every enquiry and decides whether it is a real buyer
(qualified), not one (unqualified: vendor pitches, jobs, marketing, spam), or
one a person should look at (needs review). Resends from the same sender are
marked duplicate without asking the model. Admin only: **Lead Agent** in the
sidebar.

## Where it lives and why it is always on

| Piece | Where it runs | Always on? |
|---|---|---|
| The timer that sends new rows | Google Apps Script, inside the enquiries Sheet (`LeadAgent.gs`) | Yes. Google runs it every 5 minutes; no computer of ours needs to be on. |
| The agent (masking, duplicates, rules, storing) | Vercel, `api/leads/[action].js` | Yes. It wakes for each call. |
| The model | OpenRouter → GPT-6 Luna (OpenAI, Azure or Amazon) | Yes. |
| What it decided | Supabase, table `leads` | Yes. |
| Reading info@ | Vercel, woken by the Sheet's call (and the daily job) | Yes. |

The n8n box at home is **not** involved, so everything keeps working if that
PC is off. The website Sheet's call is also the info@ mailbox's five-minute
heartbeat (section 3), with the app's daily job as a backup.

Names, email addresses and phone numbers are masked before the model sees an
enquiry (`src/lib/leads/qualify.js`). Each call is recorded in `agent_usage`,
so it counts against the company's monthly AI cap (Arak: $15). About $0.00016
per enquiry.

## 1. The OpenRouter key

Lead Agent page → Connection → OpenRouter key → Save. It is checked with
OpenRouter, then stored sealed; nobody can read it back. (Alternatively set
`OPENROUTER_API_KEY` in Vercel; a key saved on the page wins.)

In OpenRouter → Settings → Privacy, turn off providers that train on or keep
prompts. The agent also asks for that on every call.

## 2. Connect the website Sheet (about 3 minutes)

1. Open the enquiries Sheet → **Extensions → Apps Script**.
2. Click **+** next to Files → **Script**, name it `LeadAgent`. Leave `Code.gs`
   alone.
3. Paste all of `scripts/lead-qualifier/LeadAgent.gs` into it.
4. Replace `PASTE-THE-WEBSITE-SHEET-KEY-HERE` with the key from Lead Agent →
   Connection → Website Sheet key (Copy). Save.
5. Pick `installLeadAgent` in the function list and press **Run**. Google asks
   for permission (the Sheet, and calling the lead agent's address); allow it.

Done when two columns, **AI verdict** and **AI reason**, appear after Status
and fill within a minute, and the Lead Agent page shows "Checked … ago". The
first run reads the existing rows 20 at a time, so a backlog takes a few
5-minute rounds.

## 3. Connect the mailboxes (about 1 minute each)

The owner's decisions (2026-10-06/07): **info@arak-sa.com** and
**info@clb-sa.com**, **read only**, every folder including Junk.

### info@arak-sa.com (our own Microsoft 365)

1. Lead Agent page → Connection → **Connect a mailbox**.
2. Microsoft asks which account: sign in **as the mailbox** (its own
   password), not as yourself. info@arak-sa.com is an alias of
   a.rak@arak-sa.com, so that is the account; the page shows it as
   info@arak-sa.com.
3. You come back to the page with "… is connected".

### info@clb-sa.com (a different Microsoft 365)

clb-sa.com is part of Arak but its email is on its own Microsoft 365, so the
app must be allowed there first. Three steps, once:

1. **Arak's Entra admin** (arak-sa.com): Entra admin center → App
   registrations → **Arak Marketing Outreach** → Authentication → Supported
   account types → **Accounts in any organizational directory (Multitenant)**
   → Save. Outreach is unaffected: it still signs in at Arak's own tenant.
2. **CLB's Microsoft 365 admin**: open the approval link from Lead Agent →
   Connection (Copy, under "Connect a mailbox from another Microsoft 365"),
   sign in as a CLB admin, and **Accept**. It grants read-only mail access
   (Mail.Read) for the accounts that later sign in; nothing else. They come
   back to the Lead Agent page with "The other organisation approved the app"
   (an Arak admin login is not needed for that message).
3. Lead Agent → **Connect a mailbox from another Microsoft 365** → sign in as
   info@clb-sa.com.

### What happens then

- New mail from **1 October 2026** onwards is read every round (the
  workbook's "New leads" tab starts there). A round runs with every website
  Sheet call (every 5 minutes, on Google's servers) and once more each morning
  from the app's daily job, as a backup. Up to 18 model calls per round (OpenRouter allows a new account 20 a minute),
  4 at a time.
- **July–September 2026 history** is imported in the background with
  whatever budget a round has left after new mail, oldest first, until done.
  The page shows how far it has got ("importing, up to 2026-08-14" →
  "imported").
- **Every folder is read** (/me/messages), Junk and Deleted Items included,
  because good enquiries land in Junk too. Sent, Outbox and Drafts are ours:
  their mail is from our own domain or is a draft, and is skipped.
- Free filters in code skip, without storing anything: colleagues on **any
  connected company domain** (arak-sa.com and clb-sa.com), automatic senders
  (no-reply, notifications…), newsletters (List-Unsubscribe / List-Id),
  out-of-office and delivery failures, calendar replies, the website form's
  own copies ("Lighting enquiry — …", already in the Sheet), and replies in a
  conversation already sorted.
- What is left goes through the same qualifier as the website. Email leads
  show on the Lead Agent page with the mailbox and an **Open in Outlook** link.

Security:

- The sign-in asks Microsoft for `Mail.Read` only, and every renewal asks for
  the same (`READ_SCOPES` in `api/email/_graph.js`). The stored token cannot
  send, move, flag or delete mail. Attachments are never downloaded.
- It is not an outreach mailbox: it lives in `lead_mailboxes`, apart from
  `email_mailboxes`, so the outreach sender can never pick it up.
- The token is sealed in `lead_mailbox_secrets`, which no signed-in person
  can read. **Disconnect** on the page deletes it; revoking the app in
  Microsoft 365 (or changing info@'s password) also stops it at once, and the
  page then says "Connect it again".
- The model sees the masked text only (names, emails, phones, links hidden),
  like the website path.

It uses the existing "Arak Marketing Outreach" app registration and its
registered callback (`/api/email/ms-callback`), which already has delegated
`Mail.Read` with admin consent in Arak's tenant. Only clb-sa.com needs the
multitenant switch and CLB's approval (above). A mailbox from another
organisation keeps its tenant id and renews its token there.

## 4. The leads workbook (about 3 minutes)

One Google workbook with every lead from the website, info@arak-sa.com and
info@clb-sa.com, kept up to date every 5 minutes (the owner's decisions,
2026-10-07):

- **New leads**: everything that arrived from 1 October 2026.
- **Jul–Sep 2026**: everything from 1 July to 30 September 2026, filled in
  as the background history import runs. (The website form went live on
  27 August, so its history starts then.)

**Qualified and doubtful leads** (the owner's decisions, 2026-10-07): the
workbook shows qualified leads and those the agent was unsure about ("Needs
review", the whole row in light yellow). Pitches, partnership and
collaboration offers, commission deals, job seekers, spam and duplicates stay
out of the workbook and remain on the Lead Agent page.

**The team decides in the Sheet** with the **Decision** column, right after
AI verdict: **Unqualified** removes the row at the next update (within 5
minutes), **Qualified** keeps it and turns it green. Each choice is sent to
the lead agent as a person's correction (`/api/leads/sheet_decisions`, by the
workbook's key), exactly like "Is the agent right?" on the Lead Agent page,
so it counts in the accuracy figures. A lead the agent itself later moves out
of the Sheet is removed unless someone wrote in its Status, Assigned to or
Notes; a person's Unqualified always removes it.
Tabs from the first version ("All enquiries", "Qualified") are left alone;
delete them once the new tabs are filled.

Columns on both tabs: Received · Source · Name · Company · Email · Phone ·
Brief · AI verdict · Type · AI reason · Link · **Status · Assigned to ·
Notes** · Lead ID (hidden).

The script writes Received to Link. It never writes Status, Assigned to or
Notes. Brief is everything they wrote (an email's subject and body; a website
enquiry's project type and brief). Source says where it came from, such as
"Website" or "Email (info@arak-sa.com)". AI verdict shows a correction made
on the Lead Agent page, if there is one. One-way: what the team types in the
workbook does not go back.

1. Use the workbook made for the first version, or create a new, empty
   Google Sheet (for example "ARAK Leads").
2. **Extensions → Apps Script**, delete what is there, paste all of
   `scripts/lead-qualifier/LeadsMaster.gs`.
3. Replace `PASTE-THE-MASTER-SHEET-KEY-HERE` with Lead Agent → Connection →
   **Master Sheet key** (Copy). Save.
4. Choose `installLeadsMaster` → **Run** → allow Google's prompt.

Done when both tabs appear and fill with every lead so far, and the Lead
Agent page says "Leads workbook: checked … ago".

- The script lays the tabs out itself: a dark frozen header with filter
  buttons, alternating rows of equal height (about three lines; click a cell
  to read all of it), newest first, "Open email" links, and a **Status**
  dropdown (New · Contacted · Quotation sent · Won · Lost · Not relevant),
  coloured by value. `formatLeadsMaster` re-applies the layout if someone
  changes it by accident.
- Sort and filter freely: rows are matched by the hidden Lead ID.
- If the page says "Leads workbook: last checked … ago" (more than 20
  minutes), the 5-minute timer is not running: in Apps Script open
  **Triggers** (the clock icon) and check that `syncLeads` is listed, or run
  `installLeadsMaster` again.
- `resyncLeadsMaster` refreshes every agent column from scratch; team columns
  are kept.
- Share it as **Restricted**: it holds clients' contact details. The master
  key can read every lead; **New key** on the page cuts an old copy off.

## 5. Health alerts

When something stops, an email goes to the alert address (Lead Agent →
Connection → Health alerts; junaid@arak-sa.com, the owner's choice on
2026-10-07). Again once a day while it lasts, and once when it works again.

It checks: either Sheet silent for 30+ minutes; a mailbox needing reconnecting,
failing to read (20 minutes' grace, as Microsoft is sometimes briefly busy),
or unread for 45+ minutes; enquiries the AI could not check; OpenRouter
refusing the key or credit under $5; the month's AI budget at 80% or used up.

Who checks: the website Sheet's 5-minute call checks on the workbook, the
workbook's call checks on the website Sheet (each catches the other
stopping), and the app's daily job checks everything in case both stop. At
most one check runs per 10 minutes (`lead_agent_settings.last_health_at`).

The email is sent through a connected Microsoft 365 outreach mailbox (the
alert address's own if connected, else the first), via Graph; it shows in
that mailbox's Sent Items. **Send test alert** on the page proves the path;
**Check now** runs the check on the spot.

## Changing or stopping it

- **Pause:** the On/Off switch on the Lead Agent page. Rows wait, blank, and
  are read when it is on again.
- **Stop the timer:** run `uninstallLeadAgent` in Apps Script.
- **Re-check a row:** clear its AI verdict cell. It is sent again on the next
  round (if the agent already decided it, the stored answer comes back free).
- **New key:** Lead Agent → New key, then paste it into `LeadAgent.gs`. The old
  one stops working at once.

## When something is wrong

- Page says "Not connected yet" or "Last checked … ago": open Apps Script →
  **Executions**. A failed run says why (wrong key, agent switched off...).
- A row says *needs review* with "AI budget is used up": raise the company's
  monthly cap.
- A row stays blank: the model call failed; it is retried every 5 minutes. The
  Lead Agent page lists it under **Not checked** with the error.
