import { Link } from 'react-router-dom'
import { Card, SectionHead, Button, Input, Select } from '../../components/ui/index'
import { REJECT_REASON_LABELS, WEAK_SAMPLE, MEMORY_SCOPES, SCOPE_LABELS } from '../../lib/insights'
import { datedRule } from '../../lib/agent/brief'
import { useState } from 'react'

// ─── The What We Learned tab — what we now know about ourselves ────────────
// The inward, durable half. Research expires; this accumulates. Decisions we
// made on ideas, how our own posts did, and the rule book that steers every
// future generation.
//
// APPROVAL HAPPENS HERE AND ONLY HERE. Proposed rules were briefly rendered on
// the research half too, and Brand Brain's Learned Guidance carried its own
// Activate button for months — two live gates onto one table, which is
// precisely the drift RESEARCH-AGENT.md §8b guards against when it says "no
// new approval surface". Approving a rule means letting it steer every future
// generation, and that is not a decision anyone should make from a bare
// sentence: the evidence, the sample size and the dated-rule warning exist
// only on this card. Brand Brain still LISTS proposed rules, so the whole rule
// book stays readable in one place — it just links here to act on them.

const pct = n => `${Math.round(n * 100)}%`
// Where a rule came from, in words: a rule from research was argued from
// sources, one from analytics from our own numbers.
const SOURCE_LABEL = { research: 'from research', analytics: 'from our own numbers', human: 'written by hand', review: 'from a review' }
const ruleMeta = r => [SCOPE_LABELS[r.scope] || r.scope, SOURCE_LABEL[r.source] || (r.source ? `from ${r.source}` : '')].filter(Boolean).join(' · ')
const round1 = n => (Math.round(n * 10) / 10).toFixed(1)

// A bar whose width is relative to the best row in its own table. Absolute
// engagement numbers differ by orders of magnitude between brands, so a
// shared scale would render most tables as a row of slivers.
function Bar({ value, max }) {
  const w = max > 0 ? Math.max(2, (value / max) * 100) : 0
  return (
    <span className="block h-1.5 bg-surface-subtle overflow-hidden">
      <span className="block h-full bg-sage-400" style={{ width: `${w}%` }} />
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
                  {r.weak ? ' — too few to rely on' : ''}
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
  // Checked against what is in the BOX, not against what was proposed, so
  // editing the date out of a rule clears the warning as you type — and
  // re-derived at render rather than read from `evidence.dated`, so the rules
  // already sitting in this queue from before the run started stamping it are
  // warned about too. The INDEX Saudi proposal sat here from 17 Aug to the day
  // before the event with nothing on the card saying it had a clock.
  const dated = datedRule(text)

  return (
    <div className="rounded-xl border border-border bg-white p-3">
      <Input value={text} onChange={e => setText(e.target.value)} className="text-xs" />
      <p className="text-[10px] text-text-tertiary mt-1.5">
        {ruleMeta(rule)}
        {sample ? ` · based on ${sample} post${sample === 1 ? '' : 's'}` : ''}
        {sample && sample < WEAK_SAMPLE ? ' — not much to go on' : ''}
        {rule.confidence != null ? ` · confidence ${pct(Number(rule.confidence))}` : ''}
      </p>
      {rule.detail && (
        <p className="text-[11px] text-text-secondary mt-2 leading-relaxed">{rule.detail}</p>
      )}
      {dated && (
        <p className="text-[11px] text-amber-700 mt-2 leading-relaxed">
          This mentions a date, but a rule never expires — once approved it keeps shaping
          content long after that date passes. If it is a one-off, add it to a content plan
          as an idea instead, or edit the date out to make it a lasting rule.
        </p>
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

export function LearnedTab({
  events, decisions, performance, proposed, active, noHistory,
  busy, reviewing, reviewNote, onRunReview, onActivate, onRetire, onRemove,
}) {
  const [scopeFilter, setScopeFilter] = useState('all')
  const shown = active.filter(r => scopeFilter === 'all' || r.scope === scopeFilter)

  if (noHistory && !proposed.length && !active.length) {
    return (
      <Card className="p-6">
        <p className="text-sm text-text-secondary leading-relaxed">
          Nothing learned yet. This fills up from two places: the ideas you approve or reject in a
          content plan, and the numbers from posts that have gone out. Approve or reject a few
          ideas in the planner and they will start showing up here.
        </p>
        <div className="mt-3">
          <Link to="/campaigns"><Button size="sm">Go to content plans</Button></Link>
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-5">
      {/* ── 1. What happened ── */}
      {!!events.length && (
        <Card>
          <SectionHead
            title="What happened"
            subtitle={`${events.length} decision${events.length === 1 ? '' : 's'} made on this brand's content ideas.`}
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
              hint="asked for another version"
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
              <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">What people edit most</p>
              <p className="text-[10px] text-text-tertiary mt-1">Where the first draft most often needed a person to fix it.</p>
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
              `, ${performance.postsTracedToIdeas} of them from a planned idea.`
            }
          />
          {performance.postsWithMetrics < WEAK_SAMPLE && (
            <p className="mx-5 mt-4 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 leading-relaxed">
              There are not enough posts yet to draw conclusions. The numbers below are early
              and will become meaningful as more posts go out.
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
          title="Suggested rules"
          subtitle="Suggestions waiting for you. Approving one adds a rule alongside the Brand Brain — it never changes what you wrote about the company."
          action={
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" disabled={reviewing || busy} onClick={onRunReview}>
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
                <ProposedRule key={r.id} rule={r} busy={busy} onActivate={onActivate} onDismiss={onRetire} />
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-tertiary leading-relaxed max-w-3xl">
              Nothing waiting. <strong className="font-semibold text-text-secondary">Run review</strong> looks
              at the decisions and numbers above and suggests rules — it only does so once there is enough
              history to go on. You can also write rules yourself under Learned Guidance
              in <Link to="/brand-brain" className="underline">Brand Brain</Link>.
            </p>
          )}
        </div>
      </Card>

      {/* ── 4. Active memory ── */}
      <Card>
        <SectionHead
          title="Rules in use"
          subtitle={`${active.length} rule${active.length === 1 ? '' : 's'} applied whenever matching content is written.`}
          action={
            <Select value={scopeFilter} onChange={e => setScopeFilter(e.target.value)}>
              <option value="all">All kinds</option>
              {MEMORY_SCOPES.map(s => (
                <option key={s} value={s}>{SCOPE_LABELS[s] || s}</option>
              ))}
            </Select>
          }
        />
        <div className="p-5">
          {shown.length ? (
            <div className="space-y-2">
              {shown.map(r => (
                <div key={r.id} className="flex items-start gap-2 rounded-xl border border-border bg-white px-3 py-2">
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs text-text leading-relaxed">{r.rule}</span>
                    <span className="block text-[10px] text-text-tertiary mt-0.5">
                      {ruleMeta(r)}
                      {r.evidence?.sample_size ? ` · based on ${r.evidence.sample_size} posts` : ''}
                    </span>
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => onRetire(r)}>Retire</Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => onRemove(r)}>Delete</Button>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-tertiary leading-relaxed">
              No rules in use. New content is written from the Brand Brain alone.
            </p>
          )}
        </div>
      </Card>

    </div>
  )
}
