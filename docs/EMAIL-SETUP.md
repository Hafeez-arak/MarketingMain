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

App → Email → Settings → Test sending → your address → **Send test**.

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

---

## Rules to keep

- **Warm-up:** the app starts at 30/day and grows over six weeks. Send the
  first campaigns to the people most likely to open: existing customers.
- **Health brake:** sending pauses by itself at 0.3% spam reports or 5% bounces
  in a week, and holds low above 2% bounces. If it pauses, clean the list
  before resuming.
- **Marketing lane = people who know us.** No bought or scraped lists in it.
- **Cold lane never goes through Resend.**

## Later: cold outreach setup (not started)

1. Buy a separate domain (not a subdomain of arak-sa.com), e.g. `araklighting.com`, ~$12/year.
2. Point its website at arak-sa.com.
3. Google Workspace mailbox on it (~$7/month). Not in the company Microsoft 365.
4. SPF, DKIM and DMARC for that domain (Google Workspace shows the records).
5. Warm the mailbox for 2–3 weeks with normal, low-volume email before any cold send.
6. App → Email → Settings → Cold outreach sender: fill in the address, keep 20–40/day.
7. Then the cold sender gets built and connected (see PENDING.md).
