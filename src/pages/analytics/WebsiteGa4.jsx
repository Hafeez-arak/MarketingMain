import { useNavigate } from 'react-router-dom'
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import { Card, Button, Empty, IconBadge } from '../../components/ui/index'
import { Icon } from '../../components/ui/icons'
import { MetricInfoDot, ScopeBanner } from '../../components/analytics/MetricLabel'
import { Collapsible } from '../dashboard/Collapsible'
import { fmt, pct, duration, plural } from './format'

// ─── GA4: what happens after the click ─────────────────────────────────────
//
// Search Console can tell you somebody chose your result. It cannot tell you
// what they did next, because what they did next happened on our site. This is
// that half.
//
// ── WHY THIS PANEL SHIPS BEFORE THE DATA DOES ──
//
// arak-sa.com carries no analytics tag at all — no GA4, no GTM, no Clarity in
// the served HTML — so this panel has nothing to draw on the day it is
// written, and will keep having nothing until somebody installs one.
//
// It ships anyway, showing the four steps that would make it work, because the
// alternative was the state this replaced: a dashboard card carrying a comment
// explaining why sessions and bounce rate are absent, which nobody reading the
// app ever sees. A panel that says "here is what is missing and here is how to
// get it" is the difference between a gap and a to-do. The moment the property
// exists and the service account is a Viewer on it, every number below appears
// with no further work.
//
// ── THE NUMBER THIS PANEL MUST NEVER PRINT ──
//
// Zero sessions, for a site that has visitors. Every state below is either a
// real measurement, a named setup step, or a named error. An unconfigured GA4
// rendering as a strip of zeroes would say the website is dead, which is both
// false and the single most expensive thing this page could get wrong.

const COLORS = { sessions: '#4c5e61', users: '#a3bf97' }
const axisTick = { fontSize: 11, fill: '#7a848c' }
const shortDate = iso => new Date(`${iso}T00:00:00Z`)
  .toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

function Tile({ label, metric, value, hint, delta }) {
  return (
    <div className="p-4">
      <p className="eyebrow mb-2 truncate flex items-center gap-1">
        {label}
        <MetricInfoDot metric={metric} label={label} />
      </p>
      <div className="flex items-baseline gap-2">
        <p className="text-2xl font-bold text-text leading-none tabular-nums">{value}</p>
        {delta}
      </div>
      {hint && <p className="text-[11px] text-text-tertiary mt-1.5 leading-tight">{hint}</p>}
    </div>
  )
}

function Delta({ value }) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) < 1) return null
  return (
    <span className={`text-[11px] font-semibold tabular-nums ${value > 0 ? 'text-sage-700' : 'text-rose-600'}`}>
      {value > 0 ? '+' : '−'}{Math.abs(value).toFixed(0)}
    </span>
  )
}

function ShareRow({ label, sub, share, right, color = '#4c5e61' }) {
  return (
    <li className="px-5 py-2.5">
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <span className="text-xs text-text truncate">{label}</span>
        <span className="text-[11px] text-text-secondary tabular-nums flex-shrink-0">{right}</span>
      </div>
      <div className="h-1.5 bg-surface-muted overflow-hidden">
        <div className="h-full" style={{ width: `${Math.max(1, Math.min(100, share))}%`, background: color }} />
      </div>
      {sub && <p className="text-[10px] text-text-tertiary mt-1 tabular-nums">{sub}</p>}
    </li>
  )
}

function Head({ title, subtitle, right }) {
  return (
    <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-3">
      <div className="flex items-start gap-2.5 min-w-0">
        <IconBadge tone="steel">{Icon.activity}</IconBadge>
        <div className="min-w-0">
          <h3 className="font-semibold text-text text-sm leading-tight">{title}</h3>
          {subtitle && <p className="text-xs text-text-tertiary mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  )
}

const shareOf = (rows, key) => {
  const all = rows.reduce((n, r) => n + (Number(r[key]) || 0), 0)
  return v => (all ? ((Number(v) || 0) / all) * 100 : 0)
}

export function Ga4Panels({ ga4, summary, days }) {
  const navigate = useNavigate()
  if (!ga4) return null

  // ── Not set up: the normal state until a tag exists ──
  if (!ga4.configured) {
    return (
      <Card className="overflow-hidden">
        <Head title="Website visits — not connected yet"
          subtitle="Google Analytics 4: sessions, visitors, traffic sources and what people read" />
        <div className="p-5">
          <p className="text-sm text-text-secondary mb-1">
            Search Console above ends at the click. Everything after it — how many people arrived, where they came
            from, which pages they read and whether they got in touch — only exists if a GA4 tag is on the site.
          </p>
          {(ga4.configError || ga4.error) && (
            <p className="text-xs text-rose-600 mt-2">{ga4.configError || ga4.error}</p>
          )}
          <p className="eyebrow mt-4 mb-2">To turn this on</p>
          <ol className="space-y-1.5 mb-4">
            {(ga4.setup || []).map((step, i) => (
              <li key={step} className="text-xs text-text-secondary flex gap-2.5">
                <span className="w-4 h-4 border border-border bg-surface-subtle flex items-center justify-center
                  text-[10px] font-bold text-text-tertiary flex-shrink-0 tabular-nums">{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <p className="text-[11px] text-text-tertiary mb-4 leading-relaxed">
            GA4 only reports from the day the tag goes live — it cannot backfill. Installing it today means this
            panel has a week of data next week, and a year of it next year.
          </p>
          <Button size="sm" variant="secondary" onClick={() => navigate('/brand-brain')}>Open Brand Brain</Button>
        </div>
      </Card>
    )
  }

  // ── Set up and failing ── Never folded into "nobody visited".
  if (!ga4.ok) {
    return (
      <Card className="overflow-hidden">
        <Head title="Website visits" subtitle={ga4.property} />
        <div className="p-5">
          <Empty icon={Icon.activity} title="GA4 did not answer"
            description={`${ga4.error} This is a connection problem, not an empty month — the numbers would be wrong, so none are shown.`} />
        </div>
      </Card>
    )
  }

  if (!summary) return null

  // Inclusive, and stated by the server — see the note in Website.jsx. GA4 is
  // handed the same window as Search Console on purpose, so this label and
  // that one must never differ.
  const label = `Last ${ga4.windows?.days || days} days`
  const channelShare = shareOf(ga4.channels || [], 'sessions')
  const pageShare = shareOf(ga4.pages || [], 'screenPageViews')
  const countryShare = shareOf(ga4.countries || [], 'sessions')
  const deviceShare = shareOf(ga4.devices || [], 'sessions')
  const keyEventRows = (ga4.keyEvents || []).filter(r => Number(r.keyEvents) > 0)

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <ScopeBanner
          title={`Google Analytics 4 · ${label}`}
          subtitle="What happens after the click, measured by the tag on the site. These are not Search Console's clicks and will never match them: ad blockers, refused consent, bots and people who leave before the tag fires all sit in the gap." />
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-border">
          <Tile label="Sessions" metric="web.sessions" value={fmt(summary.sessions)}
            hint="Visits to the site" delta={<Delta value={summary.sessionsDelta} />} />
          <Tile label="Visitors" metric="web.users" value={fmt(summary.users)}
            hint={`${fmt(summary.newUsers)} of them new`} delta={<Delta value={summary.usersDelta} />} />
          <Tile label="Engaged" metric="web.engagement_rate" value={pct(summary.engagementRate)}
            hint="Stayed, scrolled, or did something" />
          <Tile label="Avg visit" metric="web.avg_session" value={duration(summary.avgSessionSeconds)}
            hint={`${summary.pagesPerSession.toFixed(1)} pages per visit`} />
        </div>
        {summary.baseline && (
          <p className="px-5 py-2.5 text-[11px] text-text-tertiary border-t border-border bg-surface-subtle">
            The previous period holds no sessions, so nothing here is a rise or a fall. If the tag went live
            recently that is expected — GA4 cannot backfill the days before it existed.
          </p>
        )}
      </Card>

      {(ga4.daily || []).length > 0 && (
        <Card className="p-5">
          <div className="flex items-start gap-2.5 mb-4">
            <IconBadge tone="steel">{Icon.trending}</IconBadge>
            <div>
              <h3 className="font-semibold text-text text-sm leading-tight flex items-center gap-1.5">
                Visits over time
                <MetricInfoDot metric="web.sessions" label="Visits over time" />
              </h3>
              <p className="text-xs text-text-tertiary mt-0.5">Sessions and the people behind them, per day</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={ga4.daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e8e6e1" vertical={false} />
              <XAxis dataKey="date" tick={axisTick} tickLine={false} axisLine={{ stroke: '#e8e6e1' }}
                tickFormatter={shortDate} minTickGap={28} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={fmt} />
              <Tooltip labelFormatter={shortDate} formatter={(v, n) => [fmt(v), n]}
                contentStyle={{ fontSize: 12, border: '1px solid #e8e6e1', borderRadius: 0 }} />
              <Area type="monotone" dataKey="sessions" name="Sessions" stroke={COLORS.sessions}
                fill={COLORS.sessions} fillOpacity={0.16} strokeWidth={2} />
              <Line type="monotone" dataKey="totalUsers" name="Visitors" stroke={COLORS.users}
                strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="overflow-hidden">
          <Head title="Where visits came from"
            subtitle="GA4's own channel grouping — the answer to what marketing is actually doing" />
          {(ga4.channels || []).length === 0 ? (
            <p className="px-5 py-4 text-xs text-text-tertiary">No sessions to attribute in this window.</p>
          ) : (
            <ul className="divide-y divide-border">
              {ga4.channels.map(c => (
                <ShareRow key={c.sessionDefaultChannelGroup} label={c.sessionDefaultChannelGroup || 'Unassigned'}
                  share={channelShare(c.sessions)}
                  right={`${fmt(c.sessions)} · ${pct(channelShare(c.sessions))}`}
                  sub={`${plural(c.totalUsers, 'visitor')} · ${fmt(c.engagedSessions)} engaged`} />
              ))}
            </ul>
          )}
          <Collapsible title="Exact sources" subtitle="Source and medium, unfolded" count={(ga4.sources || []).length}>
            <ul className="divide-y divide-border border-t border-border">
              {(ga4.sources || []).map(s => (
                <li key={s.sessionSourceMedium} className="px-5 py-2 flex items-center justify-between gap-3">
                  <span className="text-xs text-text truncate font-mono">{s.sessionSourceMedium}</span>
                  <span className="text-[11px] text-text-tertiary tabular-nums flex-shrink-0">
                    {fmt(s.sessions)} · {plural(s.totalUsers, 'visitor')}
                  </span>
                </li>
              ))}
            </ul>
          </Collapsible>
        </Card>

        <Card className="overflow-hidden">
          <Head title="What they read" subtitle="Pages by views in this window" />
          {(ga4.pages || []).length === 0 ? (
            <p className="px-5 py-4 text-xs text-text-tertiary">No page views in this window.</p>
          ) : (
            <ul className="divide-y divide-border">
              {ga4.pages.slice(0, 10).map(p => (
                <ShareRow key={p.pagePath} label={p.pagePath} share={pageShare(p.screenPageViews)}
                  right={plural(p.screenPageViews, 'view')}
                  sub={plural(p.sessions, 'session')} color="#7d98a1" />
              ))}
            </ul>
          )}
          <Collapsible title="Landing pages" subtitle="Where visits started, and whether they stayed"
            count={(ga4.landings || []).length}>
            <ul className="divide-y divide-border border-t border-border">
              {(ga4.landings || []).map(l => (
                <li key={l.landingPage} className="px-5 py-2 flex items-center justify-between gap-3">
                  <span className="text-xs text-text truncate font-mono">{l.landingPage || '(not set)'}</span>
                  <span className="text-[11px] text-text-tertiary tabular-nums flex-shrink-0">
                    {fmt(l.sessions)} · engaged {pct((Number(l.engagementRate) || 0) * 100)}
                  </span>
                </li>
              ))}
            </ul>
          </Collapsible>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="overflow-hidden">
          <Head title="Who visited" subtitle="By country and by device" />
          <ul className="divide-y divide-border">
            {(ga4.countries || []).slice(0, 8).map(c => (
              <ShareRow key={c.country} label={c.country || 'Unknown'} share={countryShare(c.sessions)}
                right={`${fmt(c.sessions)} · ${pct(countryShare(c.sessions))}`}
                sub={plural(c.totalUsers, 'visitor')} color="#a3bf97" />
            ))}
          </ul>
          <div className="border-t border-border">
            <ul className="divide-y divide-border">
              {(ga4.devices || []).map(d => (
                <ShareRow key={d.deviceCategory} label={d.deviceCategory} share={deviceShare(d.sessions)}
                  right={`${fmt(d.sessions)} · ${pct(deviceShare(d.sessions))}`}
                  sub={`engaged ${pct((Number(d.engagementRate) || 0) * 100)}`} color="#c9a35e" />
              ))}
            </ul>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <Head title="Key events" subtitle="The actions you told GA4 actually matter" />
          {/* Three states, deliberately not two. "No key events configured" is
              a setup step nobody has taken; "the report failed" is a broken
              connection; "configured and none happened" is a real, quiet
              month. Collapsing them would make the first two read as the last. */}
          {!ga4.keyEventsAvailable ? (
            <p className="px-5 py-4 text-xs text-text-tertiary">
              GA4 would not report key events for this property. Usually that means none are configured yet —
              mark the form submit, the phone tap and the catalogue download as key events in GA4 → Admin → Events.
            </p>
          ) : keyEventRows.length === 0 ? (
            <p className="px-5 py-4 text-xs text-text-tertiary">
              No key events were recorded in this window. If nothing on the site is marked as a key event yet,
              that is a setup step rather than a quiet month — a website with no measured outcome cannot be judged.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {keyEventRows.map(r => (
                <ShareRow key={r.sessionDefaultChannelGroup} label={r.sessionDefaultChannelGroup || 'Unassigned'}
                  share={100} right={plural(r.keyEvents, 'key event')} color="#325130" />
              ))}
            </ul>
          )}
          <Collapsible title="Every event" subtitle="Everything the tag recorded, key or not"
            count={(ga4.events || []).length}>
            <ul className="divide-y divide-border border-t border-border">
              {(ga4.events || []).map(e => (
                <li key={e.eventName} className="px-5 py-2 flex items-center justify-between gap-3">
                  <span className="text-xs text-text truncate font-mono">{e.eventName}</span>
                  <span className="text-[11px] text-text-tertiary tabular-nums flex-shrink-0">
                    {fmt(e.eventCount)} · {plural(e.totalUsers, 'visitor')}
                  </span>
                </li>
              ))}
            </ul>
          </Collapsible>
        </Card>
      </div>
    </div>
  )
}
