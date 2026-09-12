import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../../store/app'
import { useAuth } from '../../store/auth'
import { Card, PageHeader, SectionHead, Button, Empty, Spinner, Input, Select } from '../../components/ui/index'
import {
  fetchBrandMemory, updateBrandMemory, deleteBrandMemory,
} from '../../lib/brandContext'
import { fetchRuns } from '../../lib/agentRun'
import { summarise, learningLine, ageLabel } from '../../lib/learnedSummary'
import {
  fetchIdeaEvents, fetchIdeasForInsights, fetchPerformance, requestInsightsReview,
  summariseDecisions, summarisePerformance,
  REJECT_REASON_LABELS, WEAK_SAMPLE, MEMORY_SCOPES, SCOPE_LABELS,
} from '../../lib/insights'

// ─── Insights ──────────────────────────────────────────────────────────────
// The far end of the loop. Everything else in the app writes: the planner
// logs decisions to idea_events, the sync writes post_analytics. This page is
// where those become something you can act on, and the action is always the
// same one — turn an observation into a brand_memory rule, which is what
// actually changes future generation.
//
// Four sections, in the order the argument runs: what people decided, what
// audiences did, what the system proposes because of it, and what is already
// steering output.

const pct = n => `${Math.round(n * 100)}%`
const round1 = n => (Math.round(n * 10) / 10).toFixed(1)

// A bar whose width is relative to the best row in its own table. Absolute
// engagement numbers differ by orders of magnitude between brands, so a
// shared scale would render most tables as a row of slivers.
function Bar({ value, max }) {
  const w = max > 0 ? Math.max(2, (value / max) * 100) : 0
  return (
    <span className="block h-1.5 rounded-full bg-surface-subtle overflow-hidden">
      <span className="block h-full rounded-full bg-sage-400" style={{ width: `${w}%` }} />
    </span>
  )
}

// Every performance row states how many posts it rests on, and anything under
// the threshold says so in words rather than leaving the reader to notice a
// small number. The whole failure mode of this section is a tidy average
// quietly built on two posts.
function BreakdownTable({ title, rows, empty }) {
  if (!rows.length) return (
    <div className="px-5 py-4">
      <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">{title}</p>
      <p className="text-xs text-text-tertiary mt-2">{empty}</p>
    </div>
  )
  const max = Math.max(...rows.map(r => r.avgEngagement))
  return (
    <div className="px-5 py-4">
      <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">{title}</p>
      <div className="mt-3 space-y-2.5">
        {rows.map(r => (
          <div key={r.key}>
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <span className="text-xs text-text truncate">{r.key}</span>
              <span className="text-[11px] text-text-tertiary shrink-0 tabular-nums">
                {round1(r.avgEngagement)} avg
                <span className={r.weak ? 'text-amber-600' : ''}>
                  {' · '}{r.sampleSize} post{r.sampleSize === 1 ? '' : 's'}
                  {r.weak ? ' — too few to trust' : ''}
                </span>
              </span>
            </div>
            <Bar value={r.avgEngagement} max={max} />
          </div>
        ))}
      </div>
    </div>
  )
}

// Like Stat, but for the summary grid: the hint is a sentence rather than a
// sample size, and it is never allowed to be absent — a number with nothing
// qualifying it is exactly the kind of confident, unreadable figure this app
// is organised against.
function SummaryStat({ label, value, hint }) {
  return (
    <div className="bg-white px-4 py-3">
      <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">{label}</p>
      <p className="text-lg font-bold text-text mt-0.5 tabular-nums">{value}</p>
      <p className="text-[10px] text-text-tertiary mt-0.5 leading-relaxed">{hint}</p>
    </div>
  )
}

function Stat({ label, value, hint }) {
  return (
    <div className="px-5 py-4">
      <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">{label}</p>
      <p className="text-xl font-bold text-text mt-1 tabular-nums">{value}</p>
      {hint && <p className="text-[11px] text-text-tertiary mt-1 leading-relaxed">{hint}</p>}
    </div>
  )
}

// A proposed rule is shown with its evidence attached, because approving one
// means agreeing to let it steer every future generation — and that is not a
// decision anyone can make from a single sentence with no provenance.
function ProposedRule({ rule, onActivate, onDismiss, busy }) {
  const [text, setText] = useState(rule.rule)
  const edited = text.trim() !== rule.rule
  const sample = rule.evidence?.sample_size

  return (
    <div className="rounded-xl border border-border bg-white p-3">
      <Input value={text} onChange={e => setText(e.target.value)} className="text-xs" />
      <p className="text-[10px] text-text-tertiary mt-1.5">
        {rule.scope} · from {rule.source}
        {sample ? ` · ${sample} post${sample === 1 ? '' : 's'}` : ''}
        {sample && sample < WEAK_SAMPLE ? ' — thin evidence' : ''}
        {rule.confidence != null ? ` · confidence ${pct(Number(rule.confidence))}` : ''}
      </p>
      {rule.detail && (
        <p className="text-[11px] text-text-secondary mt-2 leading-relaxed">{rule.detail}</p>
      )}
      <div className="flex items-center gap-2 mt-3">
        <Button size="sm" disabled={busy} onClick={() => onActivate(rule, text.trim())}>
          {edited ? 'Save & approve' : 'Approve'}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDismiss(rule)}>
          Dismiss
        </Button>
      </div>
    </div>
  )
}

export function Insights() {
  const { activeWorkspaceId, activeWorkspace, accessToken } = useAuth()
  // `state` is still read for the insights-review webhook URL. The brand
  // profile sync that used to sit here went with "Run research": its own
  // comment said the research query was the only thing on this page that
  // needed the profile, and that button is now a link to /insights/research.
  const { state } = useApp()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [reviewNote, setReviewNote] = useState('')
  const [events, setEvents] = useState([])
  const [ideas, setIdeas] = useState([])
  const [perf, setPerf] = useState({ metrics: [], posts: [] })
  const [memory, setMemory] = useState([])
  const [runs, setRuns] = useState([])
  const [loadError, setLoadError] = useState('')
  const [scopeFilter, setScopeFilter] = useState('all')

  // Bumped to re-run the loader after a rule is approved or retired. State is
  // set from the promise callback rather than from the effect body, which is
  // what keeps this out of the cascading-render trap — the same shape
  // useBrandContext uses.
  const [reloadTick, setReloadTick] = useState(0)
  const reload = useCallback(() => setReloadTick(t => t + 1), [])

  useEffect(() => {
    if (!activeWorkspaceId) return
    let alive = true
    Promise.all([
      fetchIdeaEvents(activeWorkspaceId, accessToken),
      fetchIdeasForInsights(activeWorkspaceId, accessToken),
      fetchPerformance(activeWorkspaceId, accessToken),
      fetchBrandMemory(activeWorkspaceId, accessToken, { status: 'all' }),
      // The page is called What We Learned and until now showed nothing the
      // research agent learned — which, on a brand with one measured post, is
      // nearly everything there is to know.
      fetchRuns(activeWorkspaceId, accessToken, 1),
    ]).then(([e, i, p, m, r]) => {
      if (!alive) return
      setEvents(e); setIdeas(i); setPerf(p); setMemory(m); setRuns(r || [])
      setLoading(false)
    }).catch(err => {
      // Without this the page is blank FOREVER on any network failure: the
      // spinner is only cleared inside .then, and a rejected Promise.all never
      // reaches it. Seen for real — the browser lost its connection and the
      // page rendered an empty rectangle with nothing to explain it.
      //
      // Same rule the run has server-side: every terminal path writes a state.
      // Failing loudly beats a spinner only a page reload can close.
      if (!alive) return
      console.error('[insights] load:', err)
      setLoadError(String(err?.message || err))
      setLoading(false)
    })
    return () => { alive = false }
  }, [activeWorkspaceId, accessToken, reloadTick])

  const decisions = useMemo(() => summariseDecisions(events, ideas), [events, ideas])
  const performance = useMemo(() => summarisePerformance(perf, ideas), [perf, ideas])
  const summary = useMemo(
    () => summarise({ run: runs[0] || null, memory, performance, decisions }),
    [runs, memory, performance, decisions],
  )

  const proposed = memory.filter(r => r.status === 'proposed')
  const active = memory.filter(r => r.status === 'active')
    .filter(r => scopeFilter === 'all' || r.scope === scopeFilter)

  async function activate(rule, text) {
    setBusy(true)
    await updateBrandMemory(accessToken, rule.id, {
      rule: text || rule.rule,
      status: 'active',
      reviewed_at: new Date().toISOString(),
    })
    setBusy(false)
    reload()
  }

  // Dismissing a proposal and retiring an active rule are the same write —
  // the row stops being injected but is kept, so the same suggestion is not
  // simply re-proposed next time the review runs.
  async function retire(rule) {
    setBusy(true)
    await updateBrandMemory(accessToken, rule.id, {
      status: 'retired', reviewed_at: new Date().toISOString(),
    })
    setBusy(false)
    reload()
  }

  // One Sonnet call over the two sections above. Text only — this workflow
  // has no image or video node, so the worst it can cost is a few cents.
  async function runReview() {
    setReviewing(true); setReviewNote('')
    const res = await requestInsightsReview(state.webhooks?.insightsReview, activeWorkspaceId)
    setReviewing(false)
    if (res.error) { setReviewNote(res.error); return }
    if (res.skipped) { setReviewNote(res.reason || 'Not enough history to review yet.'); return }
    setReviewNote(res.proposed
      ? `Proposed ${res.proposed} rule${res.proposed === 1 ? '' : 's'} — review them below.`
      : (res.note || 'The review found nothing worth proposing.'))
    reload()
  }

  // Searches the live web for this brand's market and rivals, then proposes
  // rules from what it finds. The only learning source that works before
  // there is any posting history — which is exactly the position both real
  // brands are in.
  //
  // The query is built from the Brand Brain here, in the browser, through the
  // same buildContext every other call uses. Assembling it inside n8n would
  // mean a second copy of the flattening logic, which is the drift
  // brandContext.js exists to prevent.

  async function remove(rule) {
    setBusy(true)
    await deleteBrandMemory(accessToken, rule.id)
    setBusy(false)
    reload()
  }

  if (loading) {
    return <div className="p-8 flex justify-center"><Spinner /></div>
  }

  if (loadError) {
    return (
      <Card className="p-6">
        <Empty
          title="Could not load this page"
          description={`${loadError}. This is a connection problem rather than a missing-data one — nothing has been lost.`}
          action={<Button onClick={() => { setLoadError(''); setLoading(true); reload() }}>Try again</Button>}
        />
      </Card>
    )
  }

  const noHistory = !events.length && !performance.postsWithMetrics

  return (
    <div className="space-y-5">
      <PageHeader
        title="Insights"
        subtitle={`What ${activeWorkspace?.name || 'this brand'} knows: what the market is doing, what our own posts did, and the rules those suggest.`}
      >
        <Link to="/insights/research"><Button variant="ghost" size="sm">Research brief</Button></Link>
        <Button variant="secondary" size="sm" disabled={busy}
          onClick={() => { setLoading(true); reload() }}>Refresh</Button>
      </PageHeader>

      {/* ── 0. Where we stand ──
          The summary this page never had. It leads with ONE instruction rather
          than a digest, because a screen of true facts with nothing to do about
          them is a report, and reports get skimmed. Everything below it is the
          evidence for this card. */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">
              Where we stand
            </p>
            {summary.next ? (
              <>
                <p className="text-base font-semibold text-text mt-1.5 leading-snug">{summary.next.text}</p>
                {summary.next.detail && (
                  <p className="text-xs text-text-secondary mt-1.5 leading-relaxed">{summary.next.detail}</p>
                )}
              </>
            ) : (
              /* A real state, and one this page must be able to say. Inventing
                 an urgent action every week is how people learn to ignore the
                 weeks something genuinely is urgent. */
              <p className="text-base font-semibold text-text mt-1.5 leading-snug">
                Nothing needs you right now. Research is current, nothing is waiting for review,
                and no deadline is close.
              </p>
            )}
          </div>
          {summary.next && (
            <Link to={summary.next.to} className="shrink-0">
              <Button size="sm">{summary.next.action}</Button>
            </Link>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border mt-4 border-t border-border">
          <SummaryStat
            label="Steering generation"
            value={summary.learned.active}
            hint={learningLine(summary)}
          />
          <SummaryStat
            label="Waiting on review"
            value={summary.learned.proposed}
            hint={summary.learned.proposed ? 'Approve one and it starts steering captions.' : 'Nothing pending.'}
          />
          <SummaryStat
            label="Market"
            value={summary.market.hasRun ? (summary.market.actNow || '—') : '—'}
            hint={
              !summary.market.hasRun ? 'No research has run yet.'
                : summary.market.actNow ? `dated action${summary.market.actNow === 1 ? '' : 's'} · researched ${ageLabel(summary.market.ageDays)}`
                  : `nothing dated · researched ${ageLabel(summary.market.ageDays)}`
            }
          />
          <SummaryStat
            label="Our own posts"
            value={summary.ourWork.postsMeasured}
            hint={summary.ourWork.usable
              ? 'enough history to draw on'
              : 'too few to conclude anything from — the tables below say so too'}
          />
        </div>

        {summary.market.headline && (
          <p className="text-xs text-text-secondary mt-4 leading-relaxed border-t border-border pt-3">
            <span className="font-semibold text-text">Last research: </span>{summary.market.headline}
          </p>
        )}

        {summary.blocking.length > 0 && (
          <div className="mt-3 border-t border-border pt-3">
            <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">
              Holding it back
            </p>
            <ul className="mt-2 space-y-1.5">
              {summary.blocking.map(g => (
                <li key={g.key} className="text-xs text-text-secondary leading-relaxed">
                  {g.what}{' '}
                  <Link to={g.to} className="text-sage-700 underline underline-offset-2">{g.fix}</Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {noHistory && (
        <Card>
          <Empty
            title="Nothing recorded yet"
            description="This page fills itself from two places: decisions you make on a plan's ideas, and analytics from posts that have gone out. Approve or reject some ideas in the planner and they will start showing up here."
            action={<Link to="/campaigns"><Button size="sm">Go to content plans</Button></Link>}
          />
        </Card>
      )}

      {/* ── 1. What happened ── */}
      {!!events.length && (
        <Card>
          <SectionHead
            title="What happened"
            subtitle={`${events.length} decision${events.length === 1 ? '' : 's'} recorded on this brand's ideas.`}
          />
          <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-border border-b border-border">
            <Stat
              label="Approval rate"
              value={decisions.approvalRate == null ? '—' : pct(decisions.approvalRate)}
              hint={decisions.decided ? `of ${decisions.decided} decided` : 'nothing decided yet'}
            />
            <Stat label="Approved" value={decisions.totals.approved || 0} />
            <Stat label="Rejected" value={decisions.totals.rejected || 0} />
            <Stat
              label="Re-drafted"
              value={decisions.totals.redrafted || 0}
              hint="copy asked for another take"
            />
          </div>

          <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
            <div className="px-5 py-4">
              <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Why ideas were turned down</p>
              {decisions.rejectReasons.length ? (
                <div className="mt-3 space-y-2">
                  {decisions.rejectReasons.map(([reason, count]) => (
                    <div key={reason} className="flex items-center justify-between gap-3">
                      <span className="text-xs text-text">{REJECT_REASON_LABELS[reason] || reason}</span>
                      <span className="text-[11px] text-text-tertiary tabular-nums">{count}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-xs text-text-tertiary mt-2">No rejections recorded.</p>}
            </div>

            <div className="px-5 py-4">
              <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Most-edited fields</p>
              <p className="text-[10px] text-text-tertiary mt-1">Where generation needed a human hand.</p>
              {decisions.editedFields.length ? (
                <div className="mt-3 space-y-2">
                  {decisions.editedFields.map(([field, count]) => (
                    <div key={field} className="flex items-center justify-between gap-3">
                      <span className="text-xs text-text">{field}</span>
                      <span className="text-[11px] text-text-tertiary tabular-nums">{count}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-xs text-text-tertiary mt-2">No edits recorded.</p>}
            </div>
          </div>

          {!!decisions.mostRedrafted.length && (
            <div className="px-5 py-4 border-t border-border">
              <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Needed the most re-drafts</p>
              <p className="text-[10px] text-text-tertiary mt-1">
                Repeated re-drafts usually mean the brief was thin, not the writing.
              </p>
              <div className="mt-3 space-y-2">
                {decisions.mostRedrafted.map(r => (
                  <div key={r.id} className="flex items-center justify-between gap-3">
                    <span className="text-xs text-text truncate">
                      {r.idea?.title || r.idea?.topic || 'Idea no longer in the plan'}
                    </span>
                    <span className="text-[11px] text-text-tertiary tabular-nums shrink-0">×{r.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* ── 2. What performed ── */}
      {!!performance.postsWithMetrics && (
        <Card>
          <SectionHead
            title="What performed"
            subtitle={
              `${performance.postsWithMetrics} post${performance.postsWithMetrics === 1 ? '' : 's'} with analytics` +
              `, ${performance.postsTracedToIdeas} traced back to a planned idea.`
            }
          />
          {performance.postsWithMetrics < WEAK_SAMPLE && (
            <p className="mx-5 mt-4 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 leading-relaxed">
              There is not enough posting history here to draw conclusions yet. These numbers are
              shown so the plumbing is visible, not because they mean anything at this size.
            </p>
          )}
          <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
            <BreakdownTable title="By content pillar" rows={performance.byPillar}
              empty="No published post traces back to a pillar yet." />
            <BreakdownTable title="By format" rows={performance.byFormat}
              empty="No published post traces back to a format yet." />
          </div>
          <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border border-t border-border">
            <BreakdownTable title="By weekday" rows={performance.byWeekday}
              empty="No scheduled dates to group by yet." />
            <BreakdownTable title="By platform" rows={performance.byPlatform}
              empty="No platform metrics yet." />
          </div>
        </Card>
      )}

      {/* ── 3. Proposed rules ── */}
      <Card>
        <SectionHead
          title="Proposed rules"
          subtitle="Suggestions waiting on you. Approving one adds it to the Brand Brain and it starts steering generation."
          action={
            <div className="flex items-center gap-2">
              {/* "Run research" is now a link, not a button. The one-shot
                  brand-research workflow it fired wrote `proposed` rows into
                  this same table from a second code path — three paths writing
                  one table is exactly the drift buildContext exists to prevent,
                  and the agent's run supersedes it with evidence attached.
                  "Run review" stays for now: its replacement is the agent's
                  `ourselves` lens, which cannot say anything until a real
                  Instagram account is connected. Removing a working button in
                  favour of one that returns nothing would be tidy and wrong. */}
              <Link to="/insights/research">
                <Button size="sm" variant="secondary">Research</Button>
              </Link>
              <Button size="sm" variant="secondary" disabled={reviewing || busy} onClick={runReview}>
                {reviewing ? 'Reviewing…' : 'Run review'}
              </Button>
            </div>
          }
        />
        <div className="p-5">
          {reviewNote && (
            <p className="text-[11px] text-text-secondary bg-surface-subtle border border-border rounded-lg px-3 py-2 mb-3 leading-relaxed">
              {reviewNote}
            </p>
          )}
          {proposed.length ? (
            <div className="space-y-2.5">
              {proposed.map(r => (
                <ProposedRule key={r.id} rule={r} busy={busy} onActivate={activate} onDismiss={retire} />
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-tertiary leading-relaxed">
              Nothing proposed. <strong className="font-semibold text-text-secondary">Run review</strong> reads
              the two sections above and suggests rules from them — it declines to run until there is
              enough history to say anything honest. <strong className="font-semibold text-text-secondary">Run
              research</strong> searches the web for this brand's market and competitors instead, so it works
              before there is any history at all. You can also write rules by hand under Learned Guidance
              in <Link to="/brand-brain" className="underline">Brand Brain</Link>.
            </p>
          )}
        </div>
      </Card>

      {/* ── 4. Active memory ── */}
      <Card>
        <SectionHead
          title="Steering generation now"
          subtitle={`${active.length} active rule${active.length === 1 ? '' : 's'} added to every matching prompt.`}
          action={
            <Select value={scopeFilter} onChange={e => setScopeFilter(e.target.value)}>
              <option value="all">All scopes</option>
              {MEMORY_SCOPES.map(s => (
                <option key={s} value={s}>{SCOPE_LABELS[s] || s}</option>
              ))}
            </Select>
          }
        />
        <div className="p-5">
          {active.length ? (
            <div className="space-y-2">
              {active.map(r => (
                <div key={r.id} className="flex items-start gap-2 rounded-xl border border-border bg-white px-3 py-2">
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs text-text leading-relaxed">{r.rule}</span>
                    <span className="block text-[10px] text-text-tertiary mt-0.5">
                      {r.scope} · from {r.source}
                      {r.evidence?.sample_size ? ` · ${r.evidence.sample_size} posts` : ''}
                    </span>
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => retire(r)}>Retire</Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => remove(r)}>Delete</Button>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-tertiary leading-relaxed">
              No active rules. Generation is running on the Brand Brain fields alone.
            </p>
          )}
        </div>
      </Card>
    </div>
  )
}
