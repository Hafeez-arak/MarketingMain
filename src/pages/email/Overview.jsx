import { useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { Card, SectionHead, Button, Skeleton } from '../../components/ui/index'
import { brandDateKey } from '../../lib/brandTime'
import { WARMUP_STEPS } from '../../lib/email/warmup'
import { Stat, CampaignStatus, AudienceTag, Notice } from './parts'
import { pct, shortDate } from './format'
import { StuckSends } from './StuckSends'

// ─── Overview ──────────────────────────────────────────────────────────────
// The first screen answers two questions, in this order:
//   1. How much can go out today, and why that much? (the cap and its reason)
//   2. How is it landing?                            (rates over 30 days)
// One-time setup (Resend, DNS, Vercel) is deliberately NOT shown anywhere in
// the app; it lives in docs/EMAIL-SETUP.md for the person who runs it.

export function Overview({ data, status, loading, setTab, workspaceId, reload }) {
  // Read once per mount: the chart's 14 days end today, and "today" changing
  // under an open page is not worth a re-render.
  const [now] = useState(() => Date.now())

  const counts = useMemo(() => {
    const c = { marketing: 0, cold: 0, inactive: 0, total: data.contacts.length }
    for (const x of data.contacts) {
      if (x.status !== 'active') c.inactive++
      else if (x.audience === 'cold') c.cold++
      else c.marketing++
    }
    return c
  }, [data.contacts])

  // Rates are marketing-only: cold emails are not sent through Resend and
  // would otherwise dilute every number here with zeros.
  const marketingIds = useMemo(() => new Set(data.campaigns.filter(c => c.audience === 'marketing').map(c => c.id)), [data.campaigns])
  const rates = useMemo(() => {
    const r = { sent: 0, opened: 0, clicked: 0, bounced: 0, complained: 0 }
    for (const s of data.recentSends) {
      if (!marketingIds.has(s.campaign_id) || !s.sent_at) continue
      r.sent++
      if (s.opened_at) r.opened++
      if (s.clicked_at) r.clicked++
      if (s.bounced_at) r.bounced++
      if (s.complained_at) r.complained++
    }
    return r
  }, [data.recentSends, marketingIds])

  const series = useMemo(() => {
    const days = []
    for (let i = 13; i >= 0; i--) {
      const key = brandDateKey(now - i * 86_400_000)
      days.push({ key, label: key.slice(5).replace('-', '/'), sent: 0, opened: 0 })
    }
    const byKey = new Map(days.map(d => [d.key, d]))
    for (const s of data.recentSends) {
      if (!marketingIds.has(s.campaign_id) || !s.sent_at) continue
      const d = byKey.get(brandDateKey(s.sent_at))
      if (!d) continue
      d.sent++
      if (s.opened_at) d.opened++
    }
    return days
  }, [data.recentSends, marketingIds, now])

  const cap = status?.cap
  const statsById = new Map(data.stats.map(s => [s.campaign_id, s]))
  const recent = data.campaigns.slice(0, 6)

  return (
    <div className="space-y-4">
      <StuckSends data={data} workspaceId={workspaceId} reload={reload} />
      {cap?.health?.state === 'paused' && (
        <Notice tone="red" title="Marketing sending is paused">{cap.health.reason}</Notice>
      )}
      {cap?.health?.state === 'hold' && (
        <Notice tone="amber" title="Volume is being held back">{cap.health.reason}</Notice>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-border border border-border">
        <Stat loading={loading} label="Marketing contacts" value={counts.marketing.toLocaleString()} hint="Active, and can receive newsletters" />
        <Stat loading={loading} label="Cold prospects" value={counts.cold.toLocaleString()} hint="Active, for personal outreach only" />
        <Stat loading={loading} label="Not emailable" value={counts.inactive.toLocaleString()} hint="Unsubscribed, bounced, or marked us as spam" />
        <Stat loading={loading || !status} label="Can send today"
          value={cap ? `${cap.remaining} of ${cap.cap}` : '—'}
          hint={cap ? (cap.limitedBy ? `Limited by ${cap.limitedBy}` : '') : (status?.error || 'Checking…')}
          info="The lowest of: the warm-up step for this day, the health brake (bounces and spam reports), and Resend's own daily and monthly limits. Emails over the limit stay queued and go out the next morning." />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-px bg-border border border-border">
        <Stat loading={loading} label="Sent (30 days)" value={rates.sent.toLocaleString()} hint="Marketing emails that left" />
        <Stat loading={loading} label="Open rate" value={pct(rates.opened, rates.sent)} hint={`${rates.opened} opened`}
          info="Apple Mail opens every email automatically to protect privacy, so opens run high and are a rough signal. Clicks and replies are the honest numbers." />
        <Stat loading={loading} label="Click rate" value={pct(rates.clicked, rates.sent)} hint={`${rates.clicked} clicked a link`} />
        <Stat loading={loading} label="Bounce rate" value={pct(rates.bounced, rates.sent)} hint="Keep under 2%"
          tone={rates.sent >= 20 && rates.bounced / rates.sent >= 0.02 ? 'text-red-600' : ''} />
        <Stat loading={loading} label="Spam reports" value={pct(rates.complained, rates.sent)} hint="Keep under 0.1%"
          tone={rates.complained > 0 ? 'text-red-600' : ''}
          info="Gmail starts sending you to spam above 0.3%. One report in a thousand is already worth looking at: who reported, and what did they receive?" />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <SectionHead title="Last 14 days" subtitle="Marketing emails sent and opened, per day (Riyadh time)" />
          <div className="h-56 px-2 py-3">
            {loading ? <Skeleton className="h-full w-full" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={series} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#e5e7e8" />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#7a8587' }} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#7a8587' }} tickLine={false} axisLine={false} />
                  <Tooltip cursor={{ fill: 'rgba(76,94,97,0.06)' }} contentStyle={{ fontSize: 12, borderRadius: 0 }} />
                  <Bar dataKey="sent" name="Sent" fill="#4c5e61" />
                  <Bar dataKey="opened" name="Opened" fill="#9fb3a0" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card>
          <SectionHead title="Warm-up" subtitle="How the daily limit grows on a new sending domain" />
          <div className="px-5 py-3 space-y-2">
            {loading || !status ? <Skeleton className="h-24 w-full" /> : (
              <>
                <p className="text-xs text-text-secondary">
                  {data.settings?.warmup_started_on
                    ? <>Started {shortDate(data.settings.warmup_started_on)}. Today is <strong>day {cap?.day ?? 0}</strong>.</>
                    : 'Starts on the first real send.'}
                  {data.settings?.warmup_enabled === false && ' Warm-up is switched off in Settings.'}
                </p>
                <table className="w-full text-xs">
                  <tbody>
                    {WARMUP_STEPS.map((s, i) => {
                      const next = WARMUP_STEPS[i + 1]
                      const current = cap && cap.day >= s.fromDay && (!next || cap.day < next.fromDay)
                      return (
                        <tr key={s.fromDay} className={current ? 'font-semibold text-text' : 'text-text-tertiary'}>
                          <td className="py-0.5">{next ? `Days ${s.fromDay}–${next.fromDay - 1}` : `Day ${s.fromDay}+`}</td>
                          <td className="py-0.5 text-right tabular-nums">{s.perDay.toLocaleString()}/day</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <p className="text-[11px] text-text-tertiary">Never above Resend's own limit ({data.settings?.provider_daily_limit ?? 100}/day on your plan).</p>
              </>
            )}
          </div>
        </Card>
      </div>

      <Card>
        <SectionHead title="Recent campaigns" action={<Button size="xs" variant="secondary" onClick={() => setTab('marketing')}>All campaigns</Button>} />
        {loading ? <div className="p-5"><Skeleton className="h-16 w-full" /></div> : recent.length === 0 ? (
          <p className="px-5 py-6 text-sm text-text-tertiary">No campaigns yet. Write the first one in Marketing.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-text-tertiary border-b border-border">
                  <th className="text-left font-semibold px-5 py-2">Campaign</th>
                  <th className="text-left font-semibold px-3 py-2">Lane</th>
                  <th className="text-left font-semibold px-3 py-2">Status</th>
                  <th className="text-right font-semibold px-3 py-2">Sent</th>
                  <th className="text-right font-semibold px-3 py-2">Opened</th>
                  <th className="text-right font-semibold px-5 py-2">Clicked</th>
                </tr>
              </thead>
              <tbody>
                {recent.map(c => {
                  const st = statsById.get(c.id) || {}
                  return (
                    <tr key={c.id} className="border-b border-border last:border-0 hover:bg-surface-subtle cursor-pointer"
                      onClick={() => setTab(c.audience === 'cold' ? 'cold' : 'marketing', { campaign: c.id })}>
                      <td className="px-5 py-2.5 min-w-0">
                        <p className="font-medium text-text truncate max-w-[320px]">{c.name || c.subject || 'Untitled'}</p>
                        <p className="text-[11px] text-text-tertiary">{shortDate(c.launched_at || c.created_at)}</p>
                      </td>
                      <td className="px-3 py-2.5"><AudienceTag audience={c.audience} /></td>
                      <td className="px-3 py-2.5"><CampaignStatus status={c.status} /></td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{Number(st.sent || 0).toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{pct(Number(st.opened || 0), Number(st.sent || 0))}</td>
                      <td className="px-5 py-2.5 text-right tabular-nums">{pct(Number(st.clicked || 0), Number(st.sent || 0))}</td>
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
