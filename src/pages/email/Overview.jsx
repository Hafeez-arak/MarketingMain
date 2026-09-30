import { useMemo, useState } from 'react'
import { Card, SectionHead, Button, Skeleton } from '../../components/ui/index'
import { brandDateKey, brandWallToUtcISO, formatBrandDateTime } from '../../lib/brandTime'
import { mailboxReadiness, mailboxCap, inSendingWindow, nextWindowStart } from '../../lib/email/cold'
import { Stat, CampaignStatus, AudienceTag, Notice } from './parts'
import { pct, shortDate } from './format'
import { StuckSends } from './StuckSends'

// ─── Overview ──────────────────────────────────────────────────────────────
// The first screen answers three questions, in this order:
//
//   1. Does anything need me?   stuck emails, outreach switched off while a
//                               campaign runs, a mailbox that stopped, a
//                               newsletter brake. Silent when all is well.
//   2. Outreach: what is going out today, and who answered?
//   3. Newsletters: how much may go today, and how is it landing?
//
// Each lane is its own card with its own numbers. Before 2026-09-30 this page
// showed newsletter numbers only (the Resend warm-up table, "Can send today
// 88 of 100"), which a person running outreach read as outreach's. Outreach
// carries no tracking pixel, so its card counts replies and sign-ups, never
// opens.
//
// One-time setup (Resend, DNS, Vercel, Microsoft) is deliberately NOT shown
// anywhere in the app; it lives in docs/EMAIL-SETUP.md for the person who
// runs it.

export function Overview({ data, status, loading, setTab, workspaceId, reload }) {
  // Read once per mount: "today" changing under an open page is not worth a
  // re-render.
  const [now] = useState(() => Date.now())
  const today = brandDateKey(now)

  const coldIds = useMemo(() => new Set(data.campaigns.filter(c => c.audience === 'cold').map(c => c.id)), [data.campaigns])

  const outreach = useMemo(() => {
    const mailboxes = data.mailboxes || []
    const ready = mailboxes.filter(m => mailboxReadiness(m, today).ready)
    const dayStart = Date.parse(brandWallToUtcISO(today, '00:00'))
    const o = {
      mailboxes: mailboxes.length, ready: ready.length,
      capToday: ready.reduce((n, m) => n + mailboxCap(m, today).cap, 0),
      sentToday: 0, sent: 0, replied: 0, signed: 0, bounced: 0,
      waiting: 0, running: data.campaigns.filter(c => c.audience === 'cold' && c.status === 'sending').length,
      broken: mailboxes.filter(m => m.status === 'error' || m.status === 'paused'),
    }
    for (const s of data.recentSends) {
      if (!coldIds.has(s.campaign_id) || !s.sent_at) continue
      o.sent++
      if (Date.parse(s.sent_at) >= dayStart) o.sentToday++
      if (s.replied_at) o.replied++
      if (s.subscribed_at) o.signed++
      if (s.bounced_at) o.bounced++
    }
    for (const st of data.stats) if (coldIds.has(st.campaign_id)) o.waiting += Number(st.queued || 0)
    return o
  }, [data.mailboxes, data.recentSends, data.stats, data.campaigns, coldIds, today])

  const coldOn = Boolean(data.settings?.cold_sending_enabled)
  const nextSend = useMemo(() => {
    if (!coldOn || !outreach.ready || !outreach.waiting) return null
    const at = new Date(now)
    if (!inSendingWindow(at)) return { when: nextWindowStart(at), opening: true }
    return { when: at, opening: false }
  }, [coldOn, outreach.ready, outreach.waiting, now])

  // Newsletter rates, over the same 30 days of sends.
  const rates = useMemo(() => {
    const r = { sent: 0, opened: 0, clicked: 0, bounced: 0, complained: 0 }
    for (const s of data.recentSends) {
      if (coldIds.has(s.campaign_id) || !s.sent_at) continue
      r.sent++
      if (s.opened_at) r.opened++
      if (s.clicked_at) r.clicked++
      if (s.bounced_at) r.bounced++
      if (s.complained_at) r.complained++
    }
    return r
  }, [data.recentSends, coldIds])

  const counts = useMemo(() => {
    const c = { marketing: 0, cold: 0, inactive: 0 }
    for (const x of data.contacts) {
      if (x.status !== 'active') c.inactive++
      else if (x.audience === 'cold') c.cold++
      else c.marketing++
    }
    return c
  }, [data.contacts])

  const cap = status?.cap
  const statsById = new Map(data.stats.map(s => [s.campaign_id, s]))
  const recent = data.campaigns.slice(0, 6)
  const toMailboxes = <Button size="sm" variant="secondary" onClick={() => setTab('cold', { section: 'mailboxes' })}>Mailboxes</Button>

  return (
    <div className="space-y-4">
      {/* 1 — anything that needs a person */}
      <StuckSends data={data} workspaceId={workspaceId} reload={reload} />
      {!loading && outreach.running > 0 && !coldOn && (
        <Notice tone="amber" title="Outreach is switched off" action={toMailboxes}>
          {outreach.running} outreach campaign{outreach.running === 1 ? ' is' : 's are'} running, but nothing goes to prospects until outreach sending is switched on.
        </Notice>
      )}
      {!loading && outreach.running > 0 && coldOn && !outreach.ready && (
        <Notice tone="amber" title="No outreach mailbox can send" action={toMailboxes}>
          Every outreach mailbox is paused, warming up, or needs reconnecting, so running campaigns are waiting.
        </Notice>
      )}
      {!loading && outreach.broken.map(m => (
        <Notice key={m.id} tone={m.status === 'error' ? 'red' : 'amber'} title={`${m.email} is ${m.status === 'error' ? 'not working' : 'paused'}`} action={toMailboxes}>
          {m.status_reason || m.last_error || 'It sends nothing until it is fixed.'}
        </Notice>
      ))}
      {cap?.health?.state === 'paused' && (
        <Notice tone="red" title="Newsletter sending is paused">{cap.health.reason}</Notice>
      )}
      {cap?.health?.state === 'hold' && (
        <Notice tone="amber" title="Newsletter volume is being held back">{cap.health.reason}</Notice>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        {/* 2 — outreach */}
        <Card>
          <SectionHead title="Outreach" subtitle="Personal emails to prospects, from your outreach mailboxes"
            action={<Button size="xs" variant="secondary" onClick={() => setTab('cold')}>Open</Button>} />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-border border-t border-border">
            <Stat loading={loading} label="Sent today" value={`${outreach.sentToday} of ${outreach.capToday}`}
              hint={outreach.ready ? `From ${outreach.ready} mailbox${outreach.ready === 1 ? '' : 'es'}` : 'No mailbox can send today'}
              info="Each mailbox starts at 5 a day and grows to its own limit. Emails leave one at a time, at uneven times, Sunday–Thursday 9:00–17:00 Riyadh." />
            <Stat loading={loading} label="Waiting to go" value={outreach.waiting.toLocaleString()} hint="First emails and follow-ups queued" />
            <Stat loading={loading} label="Next email"
              value={!coldOn ? 'Off' : !nextSend ? '—' : nextSend.opening ? shortDate(nextSend.when) : 'Today'}
              hint={!coldOn ? 'Outreach sending is switched off'
                : !nextSend ? (outreach.waiting ? 'No mailbox can send' : 'Nothing is waiting')
                  : nextSend.opening ? `When sending opens, ${formatBrandDateTime(nextSend.when)}` : 'Within sending hours, at an uneven time'} />
            <Stat loading={loading} label="Replied (30 days)" value={outreach.replied.toLocaleString()} hint={`Of ${outreach.sent.toLocaleString()} sent`}
              info="A reply stops that person's follow-ups and adds them to your newsletter list, unless they asked to stop." />
            <Stat loading={loading} label="Signed up (30 days)" value={outreach.signed.toLocaleString()} hint="Pressed Sign-up; now on the newsletter list" />
            <Stat loading={loading} label="Bounced (30 days)" value={pct(outreach.bounced, outreach.sent)} hint="Above 5% a mailbox pauses itself"
              tone={outreach.sent >= 20 && outreach.bounced / outreach.sent >= 0.05 ? 'text-red-600' : ''} />
          </div>
          <div className="px-5 py-2.5 border-t border-border">
            <button className="text-[11px] underline text-text-secondary hover:text-text" onClick={() => setTab('cold', { section: 'people' })}>
              See who replied or signed up
            </button>
          </div>
        </Card>

        {/* 3 — newsletters */}
        <Card>
          <SectionHead title="Newsletters" subtitle="Updates to people who know us or signed up"
            action={<Button size="xs" variant="secondary" onClick={() => setTab('marketing')}>Open</Button>} />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-border border-t border-border">
            <Stat loading={loading || !status} label="Can send today"
              value={cap ? `${cap.remaining} of ${cap.cap}` : '—'}
              hint={cap ? (cap.limitedBy ? `Limited by ${cap.limitedBy}` : 'Newsletters only') : (status?.error || 'Checking…')}
              info="Newsletters only. The lowest of: the warm-up step for this day, the health brake (bounces and spam reports), and the email service's plan. Anything over it goes the next morning." />
            <Stat loading={loading} label="Sent (30 days)" value={rates.sent.toLocaleString()} hint="Newsletters that left" />
            <Stat loading={loading} label="Open rate" value={pct(rates.opened, rates.sent)} hint={loading ? 'People who opened' : `${rates.opened} opened`}
              info="Apple Mail opens every email automatically to protect privacy, so opens run high and are a rough signal. Clicks are the honest number." />
            <Stat loading={loading} label="Click rate" value={pct(rates.clicked, rates.sent)} hint={loading ? 'People who clicked' : `${rates.clicked} clicked a link`} />
            <Stat loading={loading} label="Bounce rate" value={pct(rates.bounced, rates.sent)} hint="Keep under 2%"
              tone={rates.sent >= 20 && rates.bounced / rates.sent >= 0.02 ? 'text-red-600' : ''} />
            <Stat loading={loading} label="Spam reports" value={pct(rates.complained, rates.sent)} hint="Keep under 0.1%"
              tone={rates.complained > 0 ? 'text-red-600' : ''}
              info="Gmail starts sending you to spam above 0.3%. One report in a thousand is already worth looking at." />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-px bg-border border border-border">
        <Stat loading={loading} label="Newsletter contacts" value={counts.marketing.toLocaleString()} hint="Know us, and can get newsletters" />
        <Stat loading={loading} label="Outreach prospects" value={counts.cold.toLocaleString()} hint="Not opted in yet: outreach only" />
        <Stat loading={loading} label="Not emailable" value={counts.inactive.toLocaleString()} hint="Unsubscribed, bounced, or marked us as spam" />
      </div>

      <Card>
        <SectionHead title="Recent campaigns" subtitle="Both kinds, newest first" />
        {loading ? <div className="p-5"><Skeleton className="h-16 w-full" /></div> : recent.length === 0 ? (
          <p className="px-5 py-6 text-sm text-text-tertiary">No campaigns yet. Start one in Outreach or Newsletters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-text-tertiary border-b border-border">
                  <th className="text-left font-semibold px-5 py-2">Campaign</th>
                  <th className="text-left font-semibold px-3 py-2">Kind</th>
                  <th className="text-left font-semibold px-3 py-2">Status</th>
                  <th className="text-right font-semibold px-3 py-2">Sent</th>
                  <th className="text-right font-semibold px-5 py-2">Result</th>
                </tr>
              </thead>
              <tbody>
                {recent.map(c => {
                  const st = statsById.get(c.id) || {}
                  const sent = Number(st.sent || 0)
                  // Outreach is judged by replies, newsletters by clicks.
                  const result = c.audience === 'cold'
                    ? `${pct(Number(st.replied || 0), sent)} replied`
                    : `${pct(Number(st.clicked || 0), sent)} clicked`
                  return (
                    <tr key={c.id} className="border-b border-border last:border-0 hover:bg-surface-subtle cursor-pointer"
                      onClick={() => setTab(c.audience === 'cold' ? 'cold' : 'marketing', { campaign: c.id })}>
                      <td className="px-5 py-2.5 min-w-0">
                        <p className="font-medium text-text truncate max-w-[320px]">{c.name || c.subject || 'Untitled'}</p>
                        <p className="text-[11px] text-text-tertiary">{shortDate(c.launched_at || c.created_at)}</p>
                      </td>
                      <td className="px-3 py-2.5"><AudienceTag audience={c.audience} /></td>
                      <td className="px-3 py-2.5"><CampaignStatus status={c.status} /></td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{sent.toLocaleString()}</td>
                      <td className="px-5 py-2.5 text-right tabular-nums text-text-secondary">{sent ? result : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
