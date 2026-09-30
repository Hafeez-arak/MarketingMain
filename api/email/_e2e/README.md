# Cold outreach, end to end

`cold.e2e.test.js` runs the real `/api/email` handler and engine against:

- **a real Postgres**: PGlite, built from the same migration files applied to production (`db.js`). The column set was checked against live on 2026-09-29, table by table, by md5.
- **PostgREST over it** (`postgrest.js`). Like the real one, it decodes `+` as a space and sends timestamps in Postgres's own JSON format.
- **a fake Microsoft 365 tenant** (`world.js`), with sign-in codes, refresh tokens, Drafts, Sent Items, Inbox and threads. Per-account switches make it fail the ways Microsoft really does.

Time is frozen with fake Dates and only ever moves forward, as it does in production.

Run with `npx vitest run api/email/_e2e`. It takes about a second and needs no network.

## The checklist

| | Part | Scenarios |
|---|---|---|
| A | Connecting mailboxes | sign in; a second one; the same one again; reconnecting only as the same account; a personal Outlook account; no Exchange licence; another browser or a forged state; test email; editing name, signature and limit (not the address); outsiders refused |
| B/C | Prospects, groups, launch | a marketing group refused; an empty follow-up or unknown tag stops the launch; overlapping groups (everyone once, the unsubscribed never); the 90-day rule; switch off (nothing sends); "What goes out next" sends nothing |
| D | Sending runs | one per mailbox per run, spread; the gap; merge tags, signature, sign-up link, no tracking; the rest go out, follow-ups on the same mailbox 3 days on; night |
| E | Inbox | a reply (quoting our "reply stop" line) moves them to marketing; "please stop" unsubscribes; an NDR bounces; an out-of-office changes nothing and the follow-up threads correctly; the campaign closes |
| F | Failures | missing Mail.ReadWrite; reconnect after the fix; throttling; an address Microsoft refuses; the run dying after and before Microsoft took the email; in neither folder (a person answers); a revoked sign-in; a spam block |
| G | Controls, links, the rest | Arabic only, right-to-left; pause, resume, cancel; scheduled; the sign-up link (GET asks, POST acts); mailbox pause and delete; the bounce brake; the marketing lane through Resend only; website sign-up; Friday |
| H | Edges | another company's workspace; a colleague replying; a reply the same run a follow-up falls due; a contact deleted or moved while queued; a follow-up removed after launch; a daily limit of 0 |
| Z | Whole run | no database request refused; no prospect sent the same step twice |

## Bugs this found (fixed in the same change)

1. **A refused login kept its claimed gap.** A mailbox reconnected minutes later sat idle for up to three hours, having sent nothing.
2. **Throttling parked a mailbox until the next morning.** A Graph 429 or `ApplicationThrottled` was treated like a spent daily quota. It is now a 15-minute pause, and only `ErrorExceededMessageLimit` waits for tomorrow.
3. **One mailbox's crash stopped every mailbox.** A dropped connection mid-send aborted the whole workspace's run, including every other mailbox and campaign closing. It is now contained to that mailbox.
4. **Deleting a prospect with a queued email left it stuck.** The run claimed the orphaned row, and the lookup of contact "null" failed. The row stuck in `sending`, and the stuck check then advised sending it again. Orphaned rows are now cancelled ("Contact deleted"), as the delete dialog promises.

In the UI:

5. **The outreach list showed Opened and Clicked.** Outreach carries no tracking, so those could only read "—". It now shows Replied and Subscribed.
6. **The editor's From line named mailboxes that won't send.** Warming-up or paused mailboxes are now listed as "not yet".

## Not covered here

- **SMTP/Google mailboxes.** Parked by the owner.
- **Row-level security for the browser's own reads and writes.** The server always uses the service key. That needs a two-account check against the real project.
