import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../store/auth'
import { Card, Skeleton } from '../ui/index'
import { fetchLinkedInAudience } from '../../lib/zernioConnect'
import { fmt, pct } from '../../pages/analytics/format'
import { ScopeBanner } from '../analytics/MetricLabel'
import { audienceMix, compareRows, latestPair, pointChange } from '../../lib/linkedinAudience'

// ─── Who follows the LinkedIn page ─────────────────────────────────────────
// The CEO's question: are the followers potential customers, or mostly job
// seekers and suppliers? Answered with LinkedIn's follower demographics,
// snapshotted weekly and compared with the week before. The rules — which
// industries count as customer sectors, which as the lighting trade — are in
// src/lib/linkedinAudience.js.

const MIX = [
  { key: 'customer_sectors', label: 'Customer sectors',
    hint: 'Construction, contracting, engineering, architecture and design, real estate, hospitality' },
  { key: 'lighting_trade', label: 'Lighting & electrical trade',
    hint: 'Lighting and electrical makers, wholesalers, import/export — suppliers and peers, not buyers' },
  { key: 'decision_makers', label: 'Decision makers', hint: 'Manager, director, VP, C-level, owner, partner' },
  { key: 'early_career', label: 'Entry level and below', hint: 'Entry level, training and unpaid' },
]

const LISTS = [
  { key: 'industry', label: 'Industry', rows: 10 },
  { key: 'function', label: 'Job function', rows: 8 },
  { key: 'seniority', label: 'Seniority', rows: 10 },
  { key: 'company_size', label: 'Company size', rows: 9 },
]

const weekLabel = ymd => new Date(`${ymd}T00:00:00Z`)
  .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

function Change({ value, unit = ' pts' }) {
  if (value === null || value === undefined) return null
  if (value === 0) return <span className="text-[11px] text-text-tertiary">no change</span>
  const up = value > 0
  return (
    <span className={`text-[11px] font-medium tabular-nums ${up ? 'text-emerald-700' : 'text-red-700'}`}>
      {up ? '+' : '−'}{Math.round(Math.abs(value) * 10) / 10}{unit}
    </span>
  )
}

export function LinkedInAudience({ account }) {
  const { activeWorkspaceId } = useAuth()
  const accountId = account?.zernio_account_id || ''
  const [res, setRes] = useState(null)
  const seq = useRef(0)

  useEffect(() => {
    if (!activeWorkspaceId || !accountId) return
    const n = ++seq.current
    fetchLinkedInAudience(activeWorkspaceId, accountId).then(out => {
      if (n === seq.current) setRes({ ...out, accountId })
    })
  }, [activeWorkspaceId, accountId])

  const current = res && res.accountId === accountId ? res : null
  const { current: now, previous: before } = useMemo(() => latestPair(current?.snapshots || []), [current])
  const mixNow = now ? audienceMix(now.demographics) : null
  const mixBefore = before ? audienceMix(before.demographics) : null

  return (
    <Card className="overflow-hidden">
      <ScopeBanner
        title="Who follows the page"
        subtitle="LinkedIn's breakdown of all the page's followers, saved every week so this week can be compared with the last."
        right={now ? `Week of ${weekLabel(now.week_start)}` : ''}
      />

      {!current ? (
        <div className="p-5 space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : current.error ? (
        <p className="px-5 py-4 text-sm text-text-secondary">Follower demographics did not load: {current.error}</p>
      ) : !now ? (
        <p className="px-5 py-4 text-sm text-text-secondary">
          {current.liveError
            ? `Follower demographics did not load: ${current.liveError}`
            : 'LinkedIn has no follower demographics for this page yet.'}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-border">
            {MIX.map(m => (
              <div key={m.key} className="p-5 bg-white">
                <p className="text-xs font-medium text-text-secondary mb-1">{m.label}</p>
                <p className="text-2xl font-bold text-text tabular-nums">
                  {pct(mixNow[m.key].pct)}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[11px] text-text-tertiary tabular-nums">{fmt(mixNow[m.key].count)} followers</span>
                  <Change value={mixBefore ? pointChange(mixNow[m.key].pct, mixBefore[m.key].pct) : null} />
                </div>
                <p className="text-[11px] text-text-tertiary mt-1.5 leading-snug">{m.hint}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-border border-t border-border">
            {LISTS.map(l => (
              <Breakdown key={l.key} label={l.label}
                rows={compareRows(now.demographics[l.key] || [], before ? (before.demographics[l.key] || []) : null).slice(0, l.rows)} />
            ))}
          </div>

          <div className="px-5 py-2.5 border-t border-border text-[11px] text-text-tertiary space-y-1">
            <p>
              {before
                ? `Changes are against the week of ${weekLabel(before.week_start)}. `
                : 'The first comparison appears once next week’s snapshot is saved. '}
              Shares are of the followers who list that field on their profile; LinkedIn leaves the rest out and
              gives the top 100 values at most, so a breakdown does not add up to the follower count.
            </p>
            <p>
              Location is not shown: LinkedIn’s follower locations are not available through Zernio, so the share
              of followers in Saudi Arabia cannot be measured here.
            </p>
            {current.liveError && <p>This week’s numbers did not load ({current.liveError}); showing the last saved week.</p>}
          </div>
        </>
      )}
    </Card>
  )
}

function Breakdown({ label, rows }) {
  const top = rows[0]?.pct || 0
  return (
    <div className="p-5 bg-white">
      <p className="text-xs font-semibold text-text mb-3">{label}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-text-tertiary">Nothing reported.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map(r => (
            <li key={r.id || r.label}>
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="text-text truncate" title={r.label}>{r.label}</span>
                <span className="flex items-baseline gap-2 flex-shrink-0 tabular-nums">
                  <span className="text-text-tertiary">{fmt(r.value)}</span>
                  <span className="font-semibold text-text w-12 text-right">{pct(r.pct)}</span>
                  <span className="w-16 text-right"><Change value={r.pct_change} /></span>
                </span>
              </div>
              <div className="h-1.5 mt-1 bg-surface-subtle">
                <div className="h-full bg-[#4c5e61]" style={{ width: `${top ? (r.pct / top) * 100 : 0}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
