# Email — one-time setup

Private runbook for the Email section. None of this is shown in the app.
Status as of 2026-09-27.

| # | Step | Where | Status |
|---|------|-------|--------|
| 1 | Resend API key on the server | Vercel | Done (key added) |
| 2 | Redeploy so the key takes effect | Vercel | Check |
| 3 | Sending domain DNS records | Resend + GoDaddy | In progress |
| 4 | Open and click tracking on | Resend | To do |
| 5 | Sender details in the app | App → Email → Settings | To do |
| 6 | Webhook (opens, clicks, bounces, spam reports) | Resend + Vercel | To do |
| 7 | Morning sending run | Vercel | To do |
| 8 | Test email + deliverability score | App + mail-tester.com | To do |
| 9 | Tighten DMARC on arak-sa.com | GoDaddy | Recommended |
| 10 | Google Postmaster Tools | Google | Recommended |
| 11 | Weekly AI drafts on the n8n box | WSL box | To do (after merge) |
| 12 | Outreach (cold) mailboxes: domain, Google mailboxes, DNS, app passwords | Registrar + Google | To do |
| 13 | Warm-up service on each outreach mailbox | TrulyInbox (or similar) | To do |
| 14 | Connect the mailboxes in the app | App → Email → Settings | To do |
| 15 | Cold sender schedule on the n8n box | WSL box | To do (after merge) |
| 16 | Switch outreach sending on, 14 days after warm-up starts | App → Email → Settings | Later |

---

## 1. Resend API key

Vercel → project **marketing-main** → Settings → Environment Variables →
`RESEND_API_KEY`, targets Production and Preview.

- Use a **Sending access** key. It can send and nothing else.
- The key was pasted in a chat on 2026-09-27. When convenient: create a new
  one in Resend → API Keys, replace the value in Vercel, redeploy, then delete
  the old key in Resend.

## 2. Redeploy

Environment variables only reach a new deployment.
Vercel → Deployments → the latest Production deployment → ⋯ → **Redeploy**.
Do this after every environment variable change below.

## 3. Sending domain: `email.arak-sa.com`

Resend → Domains → `email.arak-sa.com` shows three records (region: EU, which
is fine).

**Easiest:** press **Auto configure** (or **Go to GoDaddy**), sign in to
GoDaddy, approve. It adds exactly these three records under the `email.`
subdomain and nothing else.

**By hand:** GoDaddy → My Products → arak-sa.com → DNS → Add New Record.
Copy each value with Resend's copy button; the screen truncates them with `[…]`.

| Type | Name (exactly) | Value | TTL |
|------|----------------|-------|-----|
| TXT | `resend._domainkey.email` | `p=MIGfMA…wIDAQAB` (full value from Resend) | default |
| CNAME | `rsend.email` | `rsend-eu…mta.net` (full value) | default |
| CNAME | `send.email` | `send.for…mta.net` (full value) | default |

- GoDaddy adds `.arak-sa.com` to the name itself. Do not type it.
- Leave **Enable Receiving** off. Replies go to the Reply-to address instead.
- These records do not touch the MX, SPF or DMARC records that staff Outlook
  email uses on `arak-sa.com`.
- Then press **I've already added the records** in Resend. Verification takes
  minutes to a few hours.

Check from a terminal (each should print a value once added):

```bash
dig +short TXT resend._domainkey.email.arak-sa.com
```

```bash
dig +short CNAME rsend.email.arak-sa.com
```

```bash
dig +short CNAME send.email.arak-sa.com
```

## 4. Tracking

Resend → Domains → `email.arak-sa.com` → turn on **Open tracking** and
**Click tracking**. Without them, open and click rates stay at 0%.

## 5. Sender details in the app

App → Email → Settings → Marketing sender:

- From name: `Arak Lighting`
- From address: `updates@email.arak-sa.com` (any name, but it must end in
  `@email.arak-sa.com`)
- Replies go to: a real inbox someone reads, e.g. `marketing@arak-sa.com`
- Company address: the postal address printed in every footer

Resend plan: **Resend Free** (100/day, 3,000/month). Switch to Pro ($20/month,
50,000 emails) when the monthly limit starts to bind. Keep warm-up **on**.

## 6. Webhook

Without it email still sends, but opens, clicks, bounces and spam reports are
not recorded, and bounced addresses are not retired automatically.

1. Resend → Webhooks → Add endpoint.
2. URL: `https://marketing-main-ten.vercel.app/api/email/webhook`
   (the production address; if the app moves to its own domain, update this).
3. Events: `email.sent`, `email.delivered`, `email.opened`, `email.clicked`,
   `email.bounced`, `email.complained`, `email.failed`, `email.suppressed`.
4. Save, copy the **signing secret** (starts with `whsec_`).
5. Vercel → Environment Variables → `RESEND_WEBHOOK_SECRET` = that secret.
6. Redeploy.

## 7. Morning sending run

Every day at 09:00 Riyadh the app sends scheduled campaigns and the next share
of large ones (the daily limit spreads big sends over several mornings).

1. Make a long random string (a password generator, 40+ characters).
2. Vercel → Environment Variables → `CRON_SECRET` = that string.
3. Redeploy.

Without it, due emails still go out, but only when someone opens the Email page.

## 8. Test

The app has no test-send button (removed for production, 2026-09-30). Check
with the first real marketing campaign: put yourself in a small group of your
own addresses and send it to that group first.

- Arrived in the inbox (not spam): done.
- Error "domain is not verified": step 3 is not finished yet.
- Also send one to the address shown at https://www.mail-tester.com and aim for
  9/10 or better.

## 9. DMARC on arak-sa.com (recommended)

Today: `v=DMARC1; p = none;` with no reporting address, so nobody would notice
someone sending as `@arak-sa.com`.

GoDaddy → DNS → TXT record named `_dmarc` → change the value to:

```text
v=DMARC1; p=none; rua=mailto:dmarc@arak-sa.com; adkim=r; aspf=r
```

Use any mailbox you can read for `rua`. After a few weeks of clean reports,
change `p=none` to `p=quarantine`.

## 10. Google Postmaster Tools (recommended)

https://postmaster.google.com → add `email.arak-sa.com` → verify with the TXT
record it gives you (GoDaddy, same as step 3). After a few days of sending it
shows Gmail's view of the domain's reputation and the spam-report rate.

## 11. Weekly AI drafts on the n8n box

The Monday drafts run only on the box: n8n workflow **Agent — weekly email
drafts** (Monday 07:30 UTC = 10:30 Riyadh, after the 06:00 research run) calls
the agent container's `/api/agent/emailWeekly`, which uses Claude Sonnet. The
app's "Write this week's drafts now" button goes through the same workflow.

On the box (WSL, in the repo folder), after the PR is merged:

```bash
git pull
```

```bash
(cd n8n/docker && docker compose up -d --build agent)
```

```bash
./n8n/redeploy.sh "Agent — weekly email drafts"
```

Check it is registered (anything but 404 means yes):

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:5680/webhook/arak-email-weekly
```

And that the rebuilt agent has the new route (400 "workspace_id is required"
means yes; 404 means the agent was not rebuilt):

```bash
curl -s -X POST http://127.0.0.1:5690/api/agent/emailWeekly -d '{}'
```

Needs nothing new: it uses the `AGENT_RUN_SECRET`, `AGENT_BASE_URL` and
`ANTHROPIC_API_KEY` the research run already uses. Cost: a few cents a week,
counted against the workspace's monthly AI cap.

First run: n8n → Agent — weekly email drafts → **Execute workflow** (Run now),
or the button in App → Email → Marketing. The drafts appear at the top of the
Marketing tab.

---

## Rules to keep

- **Warm-up:** the app starts at 30/day and grows over six weeks. Send the
  first campaigns to the people most likely to open: existing customers.
- **Health brake:** sending pauses by itself at 0.3% spam reports or 5% bounces
  in a week, and holds low above 2% bounces. If it pauses, clean the list
  before resuming.
- **Marketing lane = people who know us.** No bought or scraped lists in it.
- **Cold lane never goes through Resend.**

## 12. Outreach mailboxes (the cold lane)

Cold email never goes through Resend. There are two kinds of outreach mailbox:

- **Microsoft 365, the company's own accounts** (section 17): renamed
  arak-sa.com accounts, connected by signing in. No domain to buy, no warm-up
  service. The owner chose this on 2026-09-28, knowing that outreach from
  arak-sa.com puts the company domain's reputation on the line.
- **Google, on a separate outreach domain** (this section): an app password,
  SMTP/IMAP. The app refuses a Google mailbox on the marketing domain, on the
  signed-in person's domain, or on gmail.com / outlook.com.

Either kind sends one email at a time, within the ramp and ceilings of
section 16.

1. **Domain.** Buy one or two domains that are clearly Arak but not
   arak-sa.com, e.g. `araklighting.com`, `arak-lighting.co` (~$12–15/year
   each). Point each one's website at https://arak-sa.com (a redirect), so a
   prospect who types it lands on the real site.
2. **Mailboxes.** 2–5 mailboxes with real people's names (`ahmed@…`), never
   `info@` or `sales@`. Either:
   - Google Workspace Business Starter (~$7–8/user/month), a NEW Workspace
     account, not connected to the company Microsoft 365; or
   - a reseller of Google mailboxes (Zapmail via Smartlead or Instantly,
     ~$4.50–5/month). Choose the option **with admin access**, so app
     passwords can be turned on.
3. **DNS on the outreach domain** (at its registrar):
   - SPF, TXT on `@`: `v=spf1 include:_spf.google.com ~all`
   - DKIM: Google Admin → Apps → Google Workspace → Gmail → Authenticate email
     → Generate new record → add the TXT it shows (`google._domainkey`) →
     back in Google Admin, **Start authentication**.
   - DMARC, TXT on `_dmarc`: `v=DMARC1; p=none; rua=mailto:<a mailbox you read>`
4. **App passwords.** Google Admin → Security → Authentication → 2-Step
   Verification → allow users to turn it on. Then, signed in as each mailbox:
   https://myaccount.google.com/signinoptions/twosv (turn on), then
   https://myaccount.google.com/apppasswords → name it "Arak outreach" → copy
   the 16 letters. That is what the app asks for; the account password never
   leaves Google.
   If Google ever stops accepting app passwords for Workspace, the mailbox
   shows "Needs reconnecting" in the app and the send is not lost: it waits.

## 13. Warm-up service

Warm-up needs a network of thousands of other mailboxes, so it cannot be built
into the app. Use TrulyInbox (~$29/month, unlimited mailboxes) or any warm-up
service, connect every outreach mailbox to it **the day it is created**, and
leave it running for as long as the mailbox sends. Note the date: the app asks
for it.

## 14. Connect the mailboxes in the app

App → Email → Settings → Outreach mailboxes → **Connect mailbox**: address,
sender name, app password, signature, most per day (15 is a good start), the
warm-up start date. The app logs in to both sending (SMTP) and reading (IMAP)
before it stores anything, and stores the password encrypted where no page
can read it.

To check a mailbox lands in the inbox (the app has no test-send button any
more), send one email by hand from it, in Outlook or Gmail, to your own
address and to the one shown at https://www.mail-tester.com, and aim for 9/10.

The password is encrypted with a key derived from `SUPABASE_SERVICE_ROLE_KEY`.
If that key is ever rotated, every mailbox shows "Needs reconnecting": paste
its app password again.

## 15. Cold sender schedule on the n8n box

The app's sending run is `GET /api/email/cold-tick`, called every 10 minutes by
the n8n workflow **Email — cold sender**. It needs `CRON_SECRET` on Vercel
(section 7) AND the same value on the box.

On the box (WSL, in the repo folder), after the PR is merged:

```bash
git pull
```

Add the secret to the box's n8n environment (same value as Vercel's
`CRON_SECRET`):

```bash
nano n8n/docker/.env
```

Line to add: `CRON_SECRET=<the same long string>`

Restart n8n so it picks up `CRON_SECRET` and the new `APP_BASE_URL`
(docker-compose.yml):

```bash
(cd n8n/docker && docker compose up -d n8n)
```

```bash
./n8n/redeploy.sh "Email — cold sender"
```

Then n8n → Email — cold sender → make sure it is **Active** → **Execute
workflow** once. "What happened" should say "Outside sending hours…" or list
each mailbox. "CRON_SECRET is not set on the box" or "The app refused" means
the secret is missing or different.

## 16. Switch outreach sending on

Only once at least one mailbox shows **Ready** (14 days after its warm-up
started): App → Email → Settings → Outreach mailboxes → **Switch on**. The same
button is the emergency stop.

How sending behaves, all enforced in code (`src/lib/email/cold.js`):

- Sunday–Thursday, 09:00–17:00 Riyadh only; one email per mailbox per run,
  with a random gap so a day's emails are spread out.
- Per mailbox: 5/day in its first week of real sending, 10/day in the second,
  then its own limit. Never more than 40/day per mailbox or 200/day in total,
  whatever is typed in.
- Follow-ups go from the same mailbox, in the same thread, after their wait.
  A contact marked as replied, unsubscribed or bounced gets nothing more.
- Nobody gets a second outreach sequence within 90 days.
- A mailbox pauses itself if 5% of its week's emails bounce, and stops if its
  login is refused. **Verify every bought list** (MillionVerifier, ZeroBounce)
  before importing it: bounces are the fastest way to burn a domain.
- Reading replies and bounces from the inboxes is the next build (PENDING.md).
  Until then, mark a contact who replied as replied by hand, so their
  follow-ups stop.

## 17. Microsoft 365 mailboxes (company accounts)

Former employees' arak-sa.com accounts, renamed, send outreach through
Microsoft Graph. Someone signs in as each one once; the app keeps Microsoft's
refresh token (encrypted, like an app password) and never sees a password.
Replies and bounces are read from each inbox on every sending run: a reply
stops that person's follow-ups, a bounce marks the address bad.

### The app registration (Microsoft Entra, once)

Its own app registration in the ARAK-SA.COM tenant. (The Lighting app's
registration lives in another directory and is not used.)

1. https://entra.microsoft.com → Entra ID → App registrations → **New
   registration**. Name `Arak Marketing Outreach`; account types **this
   organizational directory only (single tenant)**; Redirect URI platform
   **Web** (not single-page, not public client), URL exactly
   `https://marketing-main-ten.vercel.app/api/email/ms-callback`
   (if the app moves, add `<address>/api/email/ms-callback` under
   Authentication). **Register.**
2. Overview: copy **Application (client) ID** and **Directory (tenant) ID**.
3. **Certificates & secrets → New client secret**, 24 months. Copy the
   **Value** (not the Secret ID). Note its expiry date: when it expires,
   Microsoft mailboxes stop sending until a new one is set on Vercel.
4. **API permissions → Add a permission → Microsoft Graph → Delegated**:
   `Mail.Send`, `Mail.Read`, `Mail.ReadWrite`, `offline_access`, `openid`,
   `profile`, `email`
   (`User.Read` is there already). Then **Grant admin consent for
   ARAK-SA.COM**; every row shows a green tick.
5. Authentication: leave implicit grant unticked and public client flows off.

Why a Web (confidential) app and not a single-page one: a refresh token
issued to a single-page app expires after 24 hours and can only be used from
a browser. The sender runs on a server every 10 minutes, so it needs the web
flow's, which lasts 90 days and renews itself with every use.

### Vercel (Production), then redeploy

- `MICROSOFT_CLIENT_ID` = the Application (client) ID
- `MICROSOFT_TENANT_ID` = the Directory (tenant) ID
- `MICROSOFT_CLIENT_SECRET` = the secret's Value

Until all three are set, "Connect Microsoft 365" is greyed out.

### Each account (Microsoft 365 admin center)

https://admin.microsoft.com → Users → Active users → the account:

1. Rename it: display name and primary address, e.g. "Sales Team",
   `sales1@arak-sa.com`. A real current person's name reads best.
2. **Manage email aliases:** remove the former employee's old address, or
   their old contacts keep writing into the outreach inbox.
3. **Licenses:** Exchange Online (Plan 1) or Business Basic. Without one
   there is no mailbox, and connecting says so.
4. Unblock sign-in if it was blocked when the person left, and reset the
   password to one you hold (you sign in once to connect it).
5. Old mail: export it rather than delete it; it may be under retention.

### Connect in the app

App → Email → Settings → Outreach mailboxes → **Connect Microsoft 365** → sign
in as the mailbox (not as yourself: the screen asks which account). It comes
back connected, named from Microsoft; **Edit** sets the signature and the
daily limit. Before switching outreach on, send one email by hand from the
mailbox (in Outlook) to your own address to check it lands in the inbox.

Company mailboxes need no warm-up date: they start at 5 a day and ramp up as
in section 16. Keep the limit at 15–30: a burst of cold email from arak-sa.com
can get the account blocked by Microsoft, and complaints hurt every
colleague's mail on the domain. If Microsoft blocks one, the app stops it
and says so; a Microsoft 365 admin releases it in the Defender portal →
Restricted entities.

"Needs reconnecting" on a Microsoft mailbox (password changed, access
removed, 90 days unused, or the client secret expired and was replaced):
press **Reconnect** and sign in as that mailbox again.

## 18. Website enquiries → marketing contacts

The contact form on arak-sa.com (repo `055-Junaid/arak-lighting-website`) posts
every enquiry to its Sheet, and, when the marketing box is ticked, also to
`POST https://marketing-main-ten.vercel.app/api/email/website-signup` with the
workspace's `email_settings.website_signup_key`. The contact lands in the
marketing lane, opted in, in the group **Website enquiries**. Anyone who is
unsubscribed, bounced or marked us as spam is left as they are.

- Arak's key is set (2026-09-29). Read it with
  `select website_signup_key from email_settings where workspace_id = '00000000-0000-0000-0000-000000000001'`.
- The website carries the URL and key as defaults in `src/lib/enquiry.ts`.
  Override them with `NEXT_PUBLIC_SIGNUP_ENDPOINT` / `NEXT_PUBLIC_SIGNUP_KEY`.
- Only `https://arak-sa.com`, `https://www.arak-sa.com` and `http://localhost:*`
  may post (CORS, in `api/email/[action].js`).
- To cut the site off: set a new key in the table, then change it on the website.
