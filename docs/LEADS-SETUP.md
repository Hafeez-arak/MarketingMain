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

## 3. Connect the info@ mailbox (about 1 minute)

The owner's decision (2026-10-06): info@arak-sa.com only, **read only**.

1. Lead Agent page → Connection → **Connect a mailbox**.
2. Microsoft asks which account: sign in **as info@arak-sa.com** (its own
   password), not as yourself.
3. You come back to the page with "info@arak-sa.com is connected".

What happens then:

- The last 7 days of its inbox are read first, 8 emails per round, then new
  mail as it arrives. A round runs with every website Sheet call (every 5
  minutes, on Google's servers) and once more each morning from the app's
  daily job, as a backup.
- Free filters in code skip, without storing anything: colleagues
  (@arak-sa.com), automatic senders (no-reply, notifications…), newsletters
  (List-Unsubscribe / List-Id), out-of-office and delivery failures, calendar
  replies, the website form's own copies ("Lighting enquiry — …", already in
  the Sheet), and replies in a conversation already sorted.
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

No Entra change is needed: it uses the existing "Arak Marketing Outreach" app
registration and its registered callback (`/api/email/ms-callback`), which
already has delegated `Mail.Read` with admin consent.

## 4. The master leads workbook (about 3 minutes)

One Google workbook with every lead from every source, kept up to date every
5 minutes (the owner's decisions, 2026-10-07):

- **All enquiries**: every lead (website, email, later sources), whatever the
  verdict.
- **Qualified**: the qualified leads only. The sales team works from this tab.

Columns on both tabs: Received · Source · Name · Company · Email · Phone ·
Brief · AI verdict · Type · AI reason · Link · **Status · Assigned to ·
Notes** · Lead ID (hidden).

The script writes Received to Link. It never writes Status, Assigned to or
Notes. Brief is everything they wrote (an email's subject and body; a website
enquiry's project type and brief). Source says where it came from, such as
"Website" or "Email (info@arak-sa.com)". AI verdict shows a correction made
on the Lead Agent page, if there is one. One-way: what the team types in the
workbook does not go back.

1. Create a new, empty Google Sheet, for example "ARAK Leads".
2. **Extensions → Apps Script**, delete what is there, paste all of
   `scripts/lead-qualifier/LeadsMaster.gs`.
3. Replace `PASTE-THE-MASTER-SHEET-KEY-HERE` with Lead Agent → Connection →
   **Master Sheet key** (Copy). Save.
4. Choose `installLeadsMaster` → **Run** → allow Google's prompt.

Done when both tabs appear and fill with every lead so far, and the Lead
Agent page says "Leads workbook: checked … ago".

- Sort and filter freely: rows are matched by the hidden Lead ID.
- A qualified lead later corrected to something else stays on Qualified with
  the new verdict shown, so nobody's notes vanish.
- `resyncLeadsMaster` refreshes every agent column from scratch; team columns
  are kept.
- Share it as **Restricted**: it holds clients' contact details. The master
  key can read every lead; **New key** on the page cuts an old copy off.

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
