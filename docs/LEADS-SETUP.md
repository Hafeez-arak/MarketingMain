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

The n8n box at home is **not** involved, so the website path keeps working if
that PC is off. The info@ mailbox (next step) will need a clock to read mail
and will use the box's 10-minute tick, like outreach does.

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
