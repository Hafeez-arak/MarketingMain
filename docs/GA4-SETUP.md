# Turning on the GA4 half of the Website tab

The Analytics page's **Website** tab has two halves.

**Search Console** is already working. It answers what happens in Google's
results — who searched, where we ranked, whether they chose us. It stops at
the click, because the next thing that happens happens on our site, which is
not Google's to report.

**GA4** is the other half, and it is not connected. It answers how many people
arrived, by which route, what they read, how long they stayed, and whether they
got in touch. Until it is connected, that panel shows these steps instead of
numbers — never zeroes, because a website with visitors reading "0 sessions"
would be a lie the page told on its own initiative.

The blocker is not this app. **arak-sa.com carries no analytics tag at all** —
no GA4, no GTM, no Clarity in the served HTML. There is nothing to read yet.

---

## What you need to do

### 1. Create a GA4 property

In [analytics.google.com](https://analytics.google.com) → **Admin** →
**Create** → **Property**.

- Name it `arak-sa.com`
- Time zone **Riyadh**, currency **SAR** — these cannot be changed later
  without the old data keeping the old setting
- Create a **Web** data stream for `https://arak-sa.com`

It will hand you a **Measurement ID** that looks like `G-ABC123XYZ`. Keep it
for step 2. It is **not** the number this app needs — see step 4.

### 2. Put the tag on the website

This is the step that actually starts collecting, and the one that needs
whoever maintains arak-sa.com. Paste this immediately after the opening
`<head>` of **every page**, including the `/ar` tree, with your own `G-` id:

```html
<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123XYZ"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-ABC123XYZ');
</script>
```

Then check it works: open arak-sa.com and look at GA4 → **Reports** →
**Realtime**. You should see yourself within about thirty seconds. If you do
not, the tag is not on the page you are looking at.

> **GA4 cannot backfill.** It reports from the day the tag goes live and not one
> day earlier. Installing it today means this panel has a week of data next
> week and a year of it next year; installing it in three months means starting
> the clock in three months. This is the step worth doing first.

### 3. Give this app read access

The app reads GA4 with the **same Google service account** it already uses for
Search Console. There is no "Connect Google" button and no consent screen — you
grant the account access once, by hand.

In GA4 → **Admin** → **Property access management** → **+** → **Add users**:

- Email: `search-console-reader@arak-marketing.iam.gserviceaccount.com`
- Role: **Viewer** (read-only — it is all the app needs, and all it should have)
- Untick "Notify new users by email" — it is a service account with no inbox

### 4. Tell the app which property

GA4 → **Admin** → **Property settings**. Copy the **Property ID**: a plain
number, around nine digits.

> **The number that trips everyone up.** `G-ABC123XYZ` is the *Measurement ID*
> — the one in the snippet above, and the only GA4 identifier most people ever
> see. The API has never accepted it. If you paste it anyway the app will tell
> you so by name rather than failing mysteriously, but the number you want is
> the digits-only one on this screen.

That number goes on the brand's `customFields.ga4_property_id`. There is no
screen for it today — Arak has no `brand_fields` defined, so `customFields`
values are set by writing the JSON directly. Either:

- ask me to set it (one line, takes a minute), **or**
- set `GOOGLE_GA4_PROPERTY` in the environment as a fallback for every
  workspace that has not set its own.

### 5. Mark what actually matters

Sessions alone cannot tell you whether the website is working. In GA4 →
**Admin** → **Events**, mark as **key events** the things a lead does:

- the contact form submitting
- a tap on the phone number or WhatsApp link
- a catalogue or datasheet download

The Website tab has a **Key events** panel that is waiting for these. Until
something is marked, it says so — "a website with no measured outcome cannot be
judged" — rather than showing a quiet zero.

---

## What appears once each step is done

| After | The Website tab gains |
|---|---|
| Step 2 (tag live) | Nothing yet — GA4 is collecting, but the app still cannot read it |
| Steps 3 + 4 | Sessions, visitors, new visitors, engagement rate, average visit, pages per visit; visits per day; traffic sources; pages read; landing pages; countries; devices |
| Step 5 | Key events, split by the channel that produced them |

## What GA4 will *not* do

It will not agree with Search Console, and the page says so on its face.
A Search Console **click** is Google's count of a result being chosen; a GA4
**session** is our tag's count of a visit. The gap between them is ad blockers,
refused consent, bots, redirects, and people who leave before the tag fires.
Expect GA4 sessions to be meaningfully lower than Search Console clicks. That
is normal and is not a bug in either.

---

## Separately: two things Search Console found

Neither needs GA4, and both are worth someone's afternoon.

1. **The sitemap is stale.** `https://www.arak-sa.com/sitemap.xml` was submitted
   in July 2021 and Google last downloaded it in **February 2025**. It also
   points at the `www` host, which redirects to the apex. Regenerate it, submit
   it on the canonical host, and Google starts reading it again.

2. **Image search is a fifth of our visibility and earns nothing.** 892
   impressions in 28 days at average position 39.9, for one click. Descriptive
   `alt` text and real filenames on the product and project photography is the
   cheapest work on this list.
