import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../store/auth'
import { Empty, Skeleton } from '../../components/ui/index'
import { ReportDoc, ReportToolbar, ReportMasthead, ReportSection } from '../../components/report/ReportShell'
import { useReportFilename } from '../../lib/reports/print'
import { fetchIntel, fetchCompetitorIntel } from '../../lib/marketIntel'
import { businessView, DECIDED_BY_LABEL } from '../../lib/businessView'

// ─── /insights/business — where we stand, per business line ────────────────
//
// The weekly brief answers "what happened". This answers "where do we stand",
// which is a different question, for a different reader, on a different clock.
//
// The reader here does not want a feed. They want a position and a decision,
// and they want to know what the position rests on. So every block on this
// page is a conclusion, the evidence sits under it rather than in front of it,
// and any block with nothing behind it says so in a sentence instead of being
// quietly left out — an absent section reads as "fine", and a gap is not fine.
//
// ── ONE PAGE PER LINE, NOT A FILTER ──
//
// The weekly report filters one document by line, because its top three are
// genuinely company-wide. This does not, because lighting and controls are not
// two catalogues — they are two buying centres. Lighting is specified by
// architects and lighting designers; controls by MEP and ELV consultants and
// bought through the main contractor. The rivals barely overlap, and the axes
// that decide a bid are different on each side. Flattening them into one page
// would hide the most useful thing the competitor work established.
//
// Printing is the same mechanism as the brief — the browser's own dialog, via
// ReportToolbar — so there is no second PDF path to keep in step with this one.

const RELATIONSHIP_LABEL = {
  exclusive: 'exclusive', non_exclusive: 'non-exclusive',
  claimed: 'claimed by them', unconfirmed: 'unconfirmed', ended: 'ended',
}

/** A block with nothing behind it. Stated, never hidden. */
function Gap({ children }) {
  return (
    <p className="text-[11px] text-text-tertiary leading-relaxed italic border-l-2 border-border pl-3">
      {children}
    </p>
  )
}

function Losing({ block }) {
  if (!block.established) return <Gap>{block.why}</Gap>
  return (
    <ul className="space-y-1.5">
      {block.rows.map(r => (
        <li key={r.competitor} data-print-keep className="text-[12px] text-text leading-snug">
          <span className="font-semibold">{r.competitor}</span>
          {' — '}
          {r.lost > 0 && <>lost {r.lost} of {r.contested}</>}
          {r.lost === 0 && <>won all {r.contested}</>}
          {r.topReason && <>, usually on {DECIDED_BY_LABEL[r.topReason] || r.topReason}</>}
          {r.value > 0 && <span className="text-text-tertiary"> · {Math.round(r.value).toLocaleString()} SAR contested</span>}
        </li>
      ))}
    </ul>
  )
}

function Board({ block }) {
  if (!block.established) return <Gap>{block.why}</Gap>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide text-text-tertiary border-b border-border">
            <th className="py-1.5 pr-3 font-semibold">Rival</th>
            <th className="py-1.5 pr-3 font-semibold">What they are</th>
            <th className="py-1.5 pr-3 font-semibold">Brands held</th>
            <th className="py-1.5 pr-3 font-semibold">Tier</th>
            <th className="py-1.5 font-semibold">What we know</th>
          </tr>
        </thead>
        <tbody>
          {block.rows.map(r => (
            <tr key={r.name} data-print-keep className="border-b border-border/60 align-top">
              <td className="py-1.5 pr-3">
                <span className="font-semibold text-text" dir="auto">{r.name}</span>
                {r.domain
                  ? <span className="block text-text-tertiary">{r.domain}</span>
                  : <span className="block text-text-tertiary italic">no confirmed domain</span>}
              </td>
              <td className="py-1.5 pr-3 text-text-secondary">
                {r.kinds.join(', ') || '—'}{r.city ? <span className="block text-text-tertiary">{r.city}</span> : null}
              </td>
              <td className="py-1.5 pr-3 text-text-secondary">
                {r.brands.length
                  ? r.brands.map(b => `${b.brand} (${RELATIONSHIP_LABEL[b.relationship] || b.relationship})`).join(', ')
                  : '—'}
              </td>
              <td className="py-1.5 pr-3 text-text-secondary tabular-nums">{r.tier ?? '—'}</td>
              <td className="py-1.5 text-text-secondary">
                {r.resolution === 'unresolvable'
                  ? <span className="italic">cannot be identified</span>
                  : r.researched
                    ? <>{r.signals} finding{r.signals === 1 ? '' : 's'}{r.lastSeenDays != null && <span className="text-text-tertiary">, last {r.lastSeenDays}d ago</span>}</>
                    : <span className="italic">not yet researched</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Moved({ block }) {
  if (!block.established) return <Gap>{block.why}</Gap>
  return (
    <>
      <ul className="space-y-2">
        {block.rows.map((r, i) => (
          <li key={i} data-print-keep className="text-[11px] text-text-secondary leading-relaxed">
            <p className="text-[12px] text-text leading-snug" dir="auto">
              <span className="font-semibold">{r.competitor}</span> — {r.summary}
            </p>
            <p className="text-[10px] text-text-tertiary">{r.category} · {r.channel} · {r.days}d ago</p>
          </li>
        ))}
      </ul>
      {block.more > 0 && (
        <p className="text-[10px] text-text-tertiary mt-2">
          {block.more} more not shown. This block deliberately shows only the three that matter most.
        </p>
      )}
    </>
  )
}

function Unknown({ items }) {
  if (!items.length) {
    return <p className="text-[11px] text-text-secondary">Nothing missing. Every rival in this line has a confirmed website, a tier, and a bid history.</p>
  }
  return (
    <ul className="space-y-2">
      {items.map((u, i) => (
        <li key={i} data-print-keep className="text-[11px] text-text-secondary leading-relaxed">
          <p className="text-[12px] text-text font-medium leading-snug">{u.gap}</p>
          <p>{u.detail}</p>
          <p className="text-text-tertiary"><span className="font-semibold">Closed by: </span>{u.ask}</p>
        </li>
      ))}
    </ul>
  )
}

export function BusinessView() {
  const { activeWorkspaceId, activeWorkspace, accessToken } = useAuth()
  const [state, setState] = useState({ loading: true, available: false, watchlist: [], brands: [], deals: [], signals: [] })

  useEffect(() => {
    if (!activeWorkspaceId) return undefined
    let alive = true
    // No setState(loading) here — `loading` starts true, this effect runs once
    // per workspace, and switching workspaces remounts the subtree. Same
    // reasoning as ResearchReport, and the same lint rule enforces it.
    Promise.all([
      fetchCompetitorIntel(activeWorkspaceId, accessToken),
      fetchIntel(activeWorkspaceId, accessToken),
    ]).then(([comp, intel]) => {
      if (!alive) return
      setState({
        loading: false,
        available: comp.available,
        watchlist: comp.watchlist, brands: comp.brands, deals: comp.deals,
        signals: intel.signals || [],
      })
    })
    return () => { alive = false }
  }, [activeWorkspaceId, accessToken])

  const now = useMemo(() => new Date(), [])
  const pages = useMemo(
    () => businessView({ watchlist: state.watchlist, signals: state.signals, brands: state.brands, deals: state.deals, now }),
    [state, now])

  const asOf = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  useReportFilename(`${activeWorkspace?.name || 'Brand'} — business view — ${now.toISOString().slice(0, 10)}`)

  if (state.loading) {
    return <ReportDoc><ReportToolbar backTo="/insights" backLabel="Back to Research" /><Skeleton className="h-64 w-full" /></ReportDoc>
  }

  if (!state.available) {
    return (
      <ReportDoc>
        <ReportToolbar backTo="/insights" backLabel="Back to Research" />
        <Empty
          title="The competitor tables cannot be read"
          description="Either the database change has not been applied yet, or the request failed. We show nothing rather than an empty market, because that would be a claim built on a missing table."
        />
      </ReportDoc>
    )
  }

  return (
    <ReportDoc>
      <ReportToolbar backTo="/insights" backLabel="Back to Research" />
      <ReportMasthead
        kind="Business view"
        brand={activeWorkspace?.name || 'Brand'}
        line="Where we stand against the competition, by business line"
        meta={[asOf, `${state.watchlist.length} rivals watched`, `${state.deals.length} contested bid${state.deals.length === 1 ? '' : 's'} recorded`]}
      />

      {pages.map((p, i) => (
        <div key={p.line || 'unassigned'} className={i > 0 ? 'break-before-page' : ''}>
          <ReportSection title={p.label} keep breakBefore={i > 0}>
            <p className="text-[13px] text-text leading-snug font-medium">{p.verdict}</p>
          </ReportSection>

          <ReportSection title="Who is beating us, and on what"
            note="Taken from bids our own team recorded. No website can tell us this, so we do not guess it.">
            <Losing block={p.losing} />
          </ReportSection>

          <ReportSection title="The board"
            note={p.line === 'controls'
              ? 'Controls work is chosen by MEP and ELV consultants, then bought through the main contractor. So what counts is which protocols a rival supports, what they are certified for, and who they commission for.'
              : 'Lighting is chosen by architects and lighting designers. So what counts is which brands a rival can supply, and what they have already lit.'}>
            <Board block={p.board} />
          </ReportSection>

          <ReportSection title="What changed" note="The three that matter most. A quiet month is shown as quiet.">
            <Moved block={p.moved} />
          </ReportSection>

          <ReportSection title="What we still cannot answer"
            note="Listed here rather than left out. A missing section looks like nothing is wrong.">
            <Unknown items={p.unknown} />
          </ReportSection>
        </div>
      ))}
    </ReportDoc>
  )
}
