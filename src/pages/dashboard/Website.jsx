import { useNavigate } from 'react-router-dom'
import { Card, Button, Skeleton, IconBadge, Empty } from '../../components/ui/index'
import { Icon } from '../../components/ui/icons'
import { Collapsible } from './Collapsible'
import { fmt } from '../analytics/format'

// ─── The website half of the dashboard ─────────────────────────────────────
//
// Search Console, and the recommendations that follow from it by arithmetic.
// Nothing here asks a model anything, so it costs nothing to draw and says the
// same thing twice in a row.
//
// ── WHY THERE ARE NO SESSIONS, USERS OR BOUNCE RATE ──
//
// There is no analytics tag on the site — no GA4, no GTM, no Clarity in the
// served HTML. Those numbers do not exist to be read, by this card or by
// anyone. Showing an empty "Sessions" tile would imply a working integration
// with no traffic behind it, which is the opposite of true. What it would take
// to have them is written down in changes_suggested.md rather than hinted at
// by a permanently blank tile.
//
// ── WHY CLICKS ARE NOT THE HEADLINE ──
//
// arak-sa.com took roughly 122 web-search clicks in a quarter. At that volume
// 3 → 6 is not a doubling, it is two people. Impressions, query text and
// position are stable at low volume and are the useful half anyway — see the
// header of src/lib/agent/searchConsole.js, which this inherits rather than
// re-argues.

const PRIORITY = {
  high: { label: 'Now', classes: 'bg-red-50 text-red-600 border-red-200' },
  medium: { label: 'Soon', classes: 'bg-amber-50 text-amber-700 border-amber-200' },
  low: { label: 'Watch', classes: 'bg-stone-100 text-stone-600 border-stone-300' },
}

const KIND_NOTE = {
  'missing-page': 'Missing page',
  'new-page': 'Missing page',
  rewrite: 'Title & description',
  rising: 'Demand appearing',
  falling: 'Visibility lost',
}

function Tile({ label, value, hint, delta }) {
  return (
    <div className="p-4">
      <p className="eyebrow mb-2 truncate">{label}</p>
      <div className="flex items-baseline gap-2">
        <p className="text-2xl font-bold text-text leading-none tabular-nums">{value}</p>
        {delta}
      </div>
      {hint && <p className="text-[11px] text-text-tertiary mt-1.5 leading-tight">{hint}</p>}
    </div>
  )
}

/**
 * A change, in the units of the tile it sits under.
 *
 * `invert` is for average position, where the arithmetic and the meaning point
 * opposite ways: the number going UP means we rank WORSE. Rendering the
 * improvement instead (a green "+1.1" on a tile reading 14.1) makes the two
 * numbers on one tile contradict each other, so the shift is shown in the
 * tile's own units and only the colour carries the judgement.
 */
function Delta({ value, digits = 0, suffix = '', invert = false }) {
  if (typeof value !== 'number' || Math.abs(value) < (digits ? 0.05 : 1)) return null
  const good = invert ? value < 0 : value > 0
  return (
    <span className={`text-[11px] font-semibold tabular-nums ${good ? 'text-sage-700' : 'text-red-600'}`}>
      {value > 0 ? '+' : '−'}{Math.abs(value).toFixed(digits)}{suffix}
    </span>
  )
}

function Header({ children, site }) {
  return (
    <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <IconBadge tone="sage">{Icon.trending}</IconBadge>
        <div className="min-w-0">
          <h3 className="font-semibold text-text text-sm leading-tight">Website search</h3>
          <p className="text-xs text-text-tertiary mt-0.5 truncate">
            {site ? site.replace(/^sc-domain:/, '') : 'Google Search Console'}
          </p>
        </div>
      </div>
      {children}
    </div>
  )
}

export function WebsiteCard({ data, loading, summary, recommendations, pages }) {
  const navigate = useNavigate()

  if (loading) {
    return (
      <Card className="overflow-hidden" aria-busy="true">
        <Header />
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-border">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="p-4"><Skeleton className="h-2.5 w-16 mb-2.5" /><Skeleton className="h-7 w-14" /></div>
          ))}
        </div>
        <div className="p-4 space-y-2.5">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      </Card>
    )
  }

  // ── Not set up ──
  // The steps, not a shrug. This is a credential somebody has to create by
  // hand once, and a card that just says "no data" gives them nothing to do.
  if (data && !data.configured) {
    return (
      <Card className="overflow-hidden">
        <Header site={data.site} />
        <div className="p-5">
          <p className="text-sm text-text-secondary mb-3">
            Search Console is not connected yet, so there is nothing to read.
            {data.error ? <span className="text-text-tertiary"> ({data.error})</span> : null}
          </p>
          <ol className="space-y-1.5 mb-4">
            {(data.setup || []).map((step, i) => (
              <li key={step} className="text-xs text-text-secondary flex gap-2.5">
                <span className="w-4 h-4 border border-border bg-surface-subtle flex items-center justify-center
                  text-[10px] font-bold text-text-tertiary flex-shrink-0 tabular-nums">{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <Button size="sm" variant="secondary" onClick={() => navigate('/brand-brain')}>Open Brand Brain</Button>
        </div>
      </Card>
    )
  }

  // ── Set up and failing ──
  // Never folded into "no data". A dead credential that reads as "nobody is
  // searching for us" is the silent failure this project has paid for twice.
  if (data && !data.ok) {
    return (
      <Card className="overflow-hidden">
        <Header site={data.site} />
        <div className="p-5">
          <Empty
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>}
            title="Search Console did not answer"
            description={`${data.error} This is a connection problem, not an empty week — the numbers below would be wrong, so none are shown.`} />
        </div>
      </Card>
    )
  }

  const noRows = !summary || summary.all.queries === 0

  return (
    <Card className="overflow-hidden">
      <Header site={data?.site}>
        {/* Points at the expansion of THIS card, not at a different subject.
            It used to open /insights — the research agent's findings, which
            are a separate thing that happens to also mention the website. The
            Website tab on /analytics is where these four tiles go deeper:
            Search Console in full, plus the GA4 half that says what happened
            after the click. */}
        <Button variant="ghost" size="sm" onClick={() => navigate('/analytics?channel=website')}>
          Detailed analytics
        </Button>
      </Header>

      {noRows ? (
        <div className="p-5">
          <Empty title="No search queries in this window"
            description="The property answered and had nothing to report. For a site with very little search presence that is a real answer, not a failure." />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 divide-x divide-border">
            <Tile label="Impressions" value={fmt(summary.all.impressions)}
              hint="Times we appeared in search"
              delta={<Delta value={summary.impressionsDelta} />} />
            {/* The number nobody thinks to ask for, and the one that matters.
                On a small site most clicks are people typing the company name,
                so counting those as demand makes a brand look like it is
                winning a category it has not entered. */}
            <Tile label="Non-brand" value={fmt(summary.nonBrand.impressions)}
              hint="People not searching our name"
              delta={<Delta value={summary.nonBrandDelta} />} />
            <Tile label="Clicks" value={fmt(summary.all.clicks)}
              hint={summary.thin ? 'Too few to read as movement' : 'Visits from search'} />
            <Tile label="Avg position" value={summary.position === null ? '—' : summary.position.toFixed(1)}
              hint="Weighted by impressions"
              delta={<Delta value={summary.positionDelta === null ? null : -summary.positionDelta} digits={1} invert />} />
          </div>

          {summary.baseline && (
            <p className="px-4 py-2.5 text-[11px] text-text-tertiary border-t border-border bg-surface-subtle">
              This is the first measured period — there is nothing before it to compare against, so nothing here is a rise or a fall.
            </p>
          )}

          {/* ── The recommendations ──
              Folded away by default. The urgent ones already appear at the top
              of the page in "What to do now"; this is the full list, which is
              reference material rather than an alert. */}
          <Collapsible
            title="What to do about it"
            subtitle="Computed from the numbers above — no guesswork"
            count={recommendations.length}>
            {recommendations.length === 0 ? (
              <p className="px-4 py-5 text-xs text-text-tertiary border-t border-border">
                Nothing clears the reporting floor this period. That is a real answer at this volume, not a gap.
              </p>
            ) : (
              <ul className="divide-y divide-border border-t border-border">
                {recommendations.map(r => {
                  const tone = PRIORITY[r.priority] || PRIORITY.low
                  return (
                    <li key={r.id} className="px-4 py-3">
                      <div className="flex items-start gap-2.5">
                        <span className={`text-[10px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 border
                          leading-[1.4] flex-shrink-0 mt-0.5 ${tone.classes}`}>{tone.label}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-text leading-snug">{r.title}</p>
                          <p className="text-xs text-text-secondary mt-1 leading-relaxed">{r.action}</p>
                          <p className="text-[11px] text-text-tertiary mt-1.5 tabular-nums">
                            {KIND_NOTE[r.kind] || r.kind}
                            {typeof r.impressions === 'number' && ` · ${fmt(r.impressions)} impressions`}
                            {typeof r.position === 'number' && r.position > 0 && ` · position ${r.position.toFixed(1)}`}
                          </p>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Collapsible>

          {/* ── Which pages are doing any work ── */}
          {pages.length > 0 && (
            <Collapsible
              title="Pages taking impressions"
              subtitle="Arabic and English folded together"
              count={pages.length}>
              <ul className="divide-y divide-border border-t border-border">
                {pages.map(p => (
                  <li key={p.path} className="px-4 py-2.5 flex items-center justify-between gap-3">
                    <span className="text-xs text-text truncate font-mono">{p.path}</span>
                    <span className="text-[11px] text-text-tertiary tabular-nums flex-shrink-0">
                      {fmt(p.impressions)} · pos {p.position === null ? '—' : p.position.toFixed(1)}
                    </span>
                  </li>
                ))}
              </ul>
            </Collapsible>
          )}
        </>
      )}
    </Card>
  )
}
