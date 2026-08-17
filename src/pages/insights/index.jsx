import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../../store/app'
import { useAuth } from '../../store/auth'
import { Card, PageHeader, SectionHead, Button, Empty, Spinner, Input, Select } from '../../components/ui/index'
import {
  fetchBrandMemory, updateBrandMemory, deleteBrandMemory, buildContext,
} from '../../lib/brandContext'
import { fetchBrandSchema, fetchDirectoryRows } from '../../lib/brandSchema'
import { useBrandProfileSync } from '../../lib/brandBrain'
import {
  fetchIdeaEvents, fetchIdeasForInsights, fetchPerformance, requestInsightsReview,
  requestBrandResearch, competitorNamesFrom,
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
  const { state, dispatch } = useApp()
  // The research query is built from the brand profile, and nothing else on
  // this page needs it — so without this the profile is simply absent when you
  // land here directly, buildContext returns an empty descriptor, and the
  // workflow correctly refuses to research a brand it was told nothing about.
  // Same sync the planner and the Instagram page use; it no-ops once loaded.
  useBrandProfileSync(state, dispatch)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [reviewNote, setReviewNote] = useState('')
  const [researching, setResearching] = useState(false)
  const [researchNote, setResearchNote] = useState('')
  const [events, setEvents] = useState([])
  const [ideas, setIdeas] = useState([])
  const [perf, setPerf] = useState({ metrics: [], posts: [] })
  const [memory, setMemory] = useState([])
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
    ]).then(([e, i, p, m]) => {
      if (!alive) return
      setEvents(e); setIdeas(i); setPerf(p); setMemory(m)
      setLoading(false)
    })
    return () => { alive = false }
  }, [activeWorkspaceId, accessToken, reloadTick])

  const decisions = useMemo(() => summariseDecisions(events, ideas), [events, ideas])
  const performance = useMemo(() => summarisePerformance(perf, ideas), [perf, ideas])

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
  async function runResearch() {
    setResearching(true); setResearchNote('')
    const [schema, dirRows] = await Promise.all([
      fetchBrandSchema(activeWorkspaceId, accessToken),
      fetchDirectoryRows(activeWorkspaceId, accessToken),
    ])
    const rowsBySection = {}
    for (const r of dirRows) (rowsBySection[r.section_key] ||= []).push(r)
    const directory = { rowsBySection, assets: [] }
    const ctx = buildContext(state.brandProfile, schema, directory, memory, { task: 'research' })

    const res = await requestBrandResearch(state.webhooks?.brandResearch, {
      workspace_id: activeWorkspaceId,
      brand_name: ctx.brandName,
      brand_descriptor: ctx.brandDescriptor,
      instructions: ctx.instructions,
      competitors: competitorNamesFrom(schema, directory),
    })
    setResearching(false)
    if (res.error) { setResearchNote(res.error); return }
    if (res.skipped) { setResearchNote(res.reason || 'Nothing to research yet.'); return }
    setResearchNote([
      res.proposed
        ? `Proposed ${res.proposed} rule${res.proposed === 1 ? '' : 's'} from the web — review them below.`
        : (res.note || 'The research found nothing worth proposing.'),
      res.warning ? `Some searches failed: ${res.warning}` : '',
    ].filter(Boolean).join(' '))
    reload()
  }

  async function remove(rule) {
    setBusy(true)
    await deleteBrandMemory(accessToken, rule.id)
    setBusy(false)
    reload()
  }

  if (loading) {
    return <div className="p-8 flex justify-center"><Spinner /></div>
  }

  const noHistory = !events.length && !performance.postsWithMetrics

  return (
    <div className="space-y-5">
      <PageHeader
        title="Insights"
        subtitle={`What ${activeWorkspace?.name || 'this brand'} has decided, what its posts did, and the rules those suggest.`}
      >
        <Button variant="secondary" size="sm" disabled={busy}
          onClick={() => { setLoading(true); reload() }}>Refresh</Button>
      </PageHeader>

      {noHistory && (
        <Card>
          <Empty
            title="Nothing recorded yet"
            description="This page fills itself from two places: decisions you make on a plan's ideas, and analytics from posts that have gone out. Approve or reject some ideas in the planner and they will start showing up here."
            action={<Link to="/campaigns/plans"><Button size="sm">Go to content plans</Button></Link>}
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
              <Button size="sm" variant="secondary" disabled={researching || reviewing || busy} onClick={runResearch}>
                {researching ? 'Searching…' : 'Run research'}
              </Button>
              <Button size="sm" variant="secondary" disabled={reviewing || researching || busy} onClick={runReview}>
                {reviewing ? 'Reviewing…' : 'Run review'}
              </Button>
            </div>
          }
        />
        <div className="p-5">
          {researchNote && (
            <p className="text-[11px] text-text-secondary bg-surface-subtle border border-border rounded-lg px-3 py-2 mb-3 leading-relaxed">
              {researchNote}
            </p>
          )}
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
