import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { Card, PageHeader, SectionHead, Button, Empty, Spinner, Badge } from '../../components/ui/index'
import { AgentSteering } from '../../components/AgentSteering'
import { startResearchRun, fetchRuns } from '../../lib/agentRun'
import { fetchBrandMemory, updateBrandMemory, deleteBrandMemory } from '../../lib/brandContext'
import {
  partitionByClock, deadlineLabel, urgencyOf, lensStates, lensHeadline,
  emptiness, setupGaps, pct, compact, signed,
} from '../../lib/researchBrief'

// ─── /insights/research — the brief someone actually reads ─────────────────
// RESEARCH-AGENT.md §11, AGENT.md build step 4. The run has produced a full
// report since 2026-08-20 and until now nothing rendered one: `/agent` shows a
// single line per run — the headline — while the movements, the gaps, the
// dated actions and the proposed ideas sat in a jsonb column no screen opened.
//
// ── THE ORDER IS THE ARGUMENT ──
//
// This is not a report to read top to bottom. It is a queue, and the sections
// are ordered by how long you have:
//
//   1. ACT — findings with a live deadline, soonest first.
//   2. What it means for us — the gaps.
//   3. Proposals — rules and ideas, each with an approve action.
//   4. Standing observations — true, undated, informs planning.
//   5. The board — measured competitor numbers.
//   6. What each lens did, INCLUDING the ones that found nothing.
//   7. What it could not answer.
//
// Section 6 is the one that is easy to leave out and must not be. A lens that
// looked and found nothing and a lens that broke produce an identical empty
// section, and a reader who cannot tell them apart will either distrust a
// genuinely quiet week or trust a run that did not finish.

const fmtDate = iso => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

const URGENCY = {
  now: 'bg-red-50 text-red-700 border-red-200',
  soon: 'bg-amber-50 text-amber-700 border-amber-200',
  later: 'bg-slate-50 text-slate-600 border-slate-200',
  passed: 'bg-slate-50 text-slate-400 border-slate-200',
  none: 'bg-slate-50 text-slate-600 border-slate-200',
}

const LENS_STATE = {
  found: { tone: 'text-emerald-700 bg-emerald-50', label: 'found something' },
  quiet: { tone: 'text-slate-500 bg-slate-100', label: 'looked, found nothing' },
  failed: { tone: 'text-red-700 bg-red-50', label: 'could not answer' },
}

// Sources are the difference between a finding and an opinion, so they are
// always visible — never behind a disclosure. An uncited finding says so.
function Sources({ sources, uncited }) {
  if (uncited) {
    return (
      <p className="text-[11px] text-amber-700 mt-2">
        No source survived verification — carried as an observation, not as evidence.
      </p>
    )
  }
  if (!sources?.length) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {sources.slice(0, 5).map((s, i) => (
        <a
          key={i}
          href={typeof s === 'string' ? s : s.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] px-1.5 py-0.5 rounded border border-border text-text-tertiary hover:text-text hover:border-slate-400 truncate max-w-[220px]"
          title={(typeof s === 'string' ? s : s.quote || s.title || s.url) || ''}
        >
          {(() => {
            try { return new URL(typeof s === 'string' ? s : s.url).hostname.replace(/^www\./, '') }
            catch { return 'source' }
          })()}
        </a>
      ))}
    </div>
  )
}

// A dated finding. The deadline is the loudest thing on the card, because it
// is the only reason this one is above the others.
function ActCard({ finding, now }) {
  const label = deadlineLabel(finding, now)
  const urgency = urgencyOf(finding, now)
  return (
    <div className={`rounded-xl border p-3.5 ${URGENCY[urgency]}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold leading-snug">{finding.headline}</p>
        {label && (
          <span className="text-[11px] font-semibold shrink-0 tabular-nums whitespace-nowrap">
            {label}
          </span>
        )}
      </div>
      {finding.suggested_action && (
        <p className="text-xs mt-2 leading-relaxed opacity-90">
          <span className="font-semibold">Do: </span>{finding.suggested_action}
        </p>
      )}
      {finding.detail && (
        <p className="text-[11px] mt-2 leading-relaxed opacity-75">{finding.detail}</p>
      )}
      <div className="flex items-center gap-2 mt-2 text-[10px] opacity-70">
        <span className="uppercase tracking-wide">{finding.lens}</span>
        {finding.confidence != null && <span>· confidence {pct(finding.confidence)}</span>}
        {finding.novelty && <span>· {finding.novelty}</span>}
      </div>
      <Sources sources={finding.sources} />
    </div>
  )
}

function CompetitorCard({ c }) {
  const measured = c.data === 'instagram'
  return (
    <div className="rounded-xl border border-border bg-white p-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-text truncate">{c.name}</p>
        {c.handle && <span className="text-[11px] text-text-tertiary shrink-0">@{c.handle}</span>}
      </div>
      {!measured ? (
        <p className="text-[11px] text-text-tertiary mt-2">
          No Instagram account we can measure. Web evidence only.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 mt-3">
            <div>
              <p className="text-[10px] text-text-tertiary uppercase tracking-wide">Followers</p>
              <p className="text-sm font-semibold tabular-nums">{compact(c.followers)}</p>
              {c.followers_delta != null && (
                <p className="text-[10px] text-text-tertiary tabular-nums">{signed(c.followers_delta)}</p>
              )}
            </div>
            <div>
              <p className="text-[10px] text-text-tertiary uppercase tracking-wide">Posts/wk</p>
              <p className="text-sm font-semibold tabular-nums">{c.posts_per_week ?? '—'}</p>
              {c.posts_per_week_prev != null && (
                <p className="text-[10px] text-text-tertiary tabular-nums">was {c.posts_per_week_prev}</p>
              )}
            </div>
            <div>
              <p className="text-[10px] text-text-tertiary uppercase tracking-wide">Eng/1k</p>
              <p className="text-sm font-semibold tabular-nums">{c.engagement_per_1k ?? '—'}</p>
            </div>
          </div>
          {/* vs_us is null unless our own account clears a baseline. Rendering
              a percentage against a 1-follower test account would be worse
              than rendering nothing, so the absence is stated in words. */}
          <p className="text-[11px] text-text-tertiary mt-2">
            {c.vs_us ? `Versus us: ${c.vs_us}` : 'No comparable account of ours is connected.'}
          </p>
        </>
      )}
      {c.read && <p className="text-[11px] text-text-secondary mt-2 leading-relaxed">{c.read}</p>}
    </div>
  )
}

function ProposedRuleCard({ rule, onApprove, onDismiss, busy }) {
  return (
    <div className="rounded-xl border border-border bg-white p-3">
      <p className="text-xs font-medium text-text">{rule.rule}</p>
      <p className="text-[10px] text-text-tertiary mt-1.5">
        {rule.scope || 'trend'}
        {rule.confidence != null ? ` · confidence ${pct(rule.confidence)}` : ''}
      </p>
      {rule.detail && <p className="text-[11px] text-text-secondary mt-2 leading-relaxed">{rule.detail}</p>}
      <Sources sources={rule.evidence?.sources || rule.sources} />
      <div className="flex items-center gap-2 mt-3">
        <Button size="sm" disabled={busy} onClick={() => onApprove(rule)}>Approve</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDismiss(rule)}>Dismiss</Button>
      </div>
    </div>
  )
}

export default function Research() {
  const { activeWorkspaceId, activeWorkspace, accessToken } = useAuth()
  const [runs, setRuns] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [rules, setRules] = useState([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  // One clock for the whole render. Recomputing `new Date()` per card would
  // let two findings a millisecond apart disagree about what "today" means,
  // and it is the sort of thing that only ever shows up at midnight.
  const now = useMemo(() => new Date(), [])

  // Returns the rows rather than setting them, so the effect below can drop a
  // response that landed after the reader switched brands. A fetch that
  // resolves into a component showing a different workspace is how one brand's
  // competitors appear under another's name.
  const fetchAll = useCallback(async () => {
    if (!activeWorkspaceId) return null
    const [rows, memory] = await Promise.all([
      fetchRuns(activeWorkspaceId, accessToken, 12),
      // 'proposed' explicitly: fetchBrandMemory defaults to 'active', which is
      // the opposite of what an approval queue wants.
      fetchBrandMemory(activeWorkspaceId, accessToken, { status: 'proposed' }).catch(() => []),
    ])
    return { rows, rules: (memory || []).filter(m => m.source === 'research') }
  }, [activeWorkspaceId, accessToken])

  const load = useCallback(async () => {
    const out = await fetchAll()
    if (!out) return
    setRuns(out.rows)
    setRules(out.rules)
    setLoading(false)
  }, [fetchAll])

  useEffect(() => {
    let cancelled = false
    fetchAll().then(out => {
      if (cancelled || !out) return
      setRuns(out.rows)
      setRules(out.rules)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [fetchAll])

  // A run in flight is the one case where the page has to keep looking: the
  // browser opened the spinner and only the server can close it.
  const selected = useMemo(
    () => runs.find(r => r.id === selectedId) || runs[0] || null,
    [runs, selectedId],
  )
  const live = selected?.status === 'running'
  useEffect(() => {
    if (!live) return undefined
    const t = setInterval(load, 10_000)
    return () => clearInterval(t)
  }, [live, load])

  const run = useCallback(async () => {
    if (running) return
    setRunning(true); setNote('')
    const out = await startResearchRun({ workspaceId: activeWorkspaceId, accessToken })
    setNote(
      out.already_running ? out.reason
        : out.ok ? 'Measuring — the numbers are committed. The investigation continues in the background.'
          : out.error || 'The run failed to start.',
    )
    setRunning(false)
    load()
  }, [running, activeWorkspaceId, accessToken, load])

  const approve = useCallback(async rule => {
    setBusy(true)
    await updateBrandMemory(accessToken, rule.id, { status: 'active' }).catch(() => {})
    setBusy(false); load()
  }, [load, accessToken])

  const dismiss = useCallback(async rule => {
    setBusy(true)
    await deleteBrandMemory(accessToken, rule.id).catch(() => {})
    setBusy(false); load()
  }, [load, accessToken])

  // Memoised rather than recomputed inline: `selected?.report || {}` builds a
  // NEW empty object on every render when a run has no report, which changes
  // the identity of every dependency below it and defeats all four useMemos.
  const report = useMemo(() => selected?.report || {}, [selected])
  const { act, standing, passed } = useMemo(
    () => partitionByClock(report.findings || [], now),
    [report, now],
  )
  const states = useMemo(() => lensStates(report), [report])
  const empty = useMemo(() => emptiness(report), [report])
  const gaps = useMemo(
    () => setupGaps(report, { hasOwnAccount: Boolean(report.competitor_board?.some(c => c.is_us)) }),
    [report],
  )

  if (!activeWorkspaceId) {
    return <Empty title="No workspace selected" description="Pick a brand to see its research." />
  }
  if (loading) return <div className="py-16 flex justify-center"><Spinner /></div>

  return (
    <div className="space-y-4">
      <PageHeader
        title="Research"
        subtitle={`What is happening around ${activeWorkspace?.name || 'this brand'}, and what to do about it.`}
      >
        <Link to="/insights"><Button variant="ghost">Insights</Button></Link>
        <Button variant="secondary" onClick={run} disabled={running || live}>
          {running ? 'Starting…' : live ? 'Running…' : 'Run research'}
        </Button>
      </PageHeader>

      {note && <Card className="p-3"><p className="text-sm text-text-secondary">{note}</p></Card>}

      {!runs.length ? (
        <Empty
          title="No research has been run for this brand yet"
          description="A run measures every competitor with a verified Instagram handle, then investigates what changed. The numbers are computed in code, never by a model."
          action={<Button onClick={run} disabled={running}>Run research</Button>}
        />
      ) : (
        <>
          {/* ── The headline, and how the run actually went ── */}
          <Card className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[11px] text-text-tertiary uppercase tracking-wide">
                  {fmtDate(report.period?.start)} – {fmtDate(report.period?.end)}
                  {report.baseline ? ' · first measurement, nothing to compare against yet' : ''}
                </p>
                <p className="text-base font-semibold text-text mt-1.5 leading-snug">
                  {selected.error || report.headline || 'No headline.'}
                </p>
              </div>
              {/* Badge renders STATUS_META's own label when the status is one
                  it knows, so the run's vocabulary is mapped onto it rather
                  than passed through — 'complete' is not a key, 'completed' is. */}
              <Badge status={
                selected.status === 'complete' ? 'completed'
                  : selected.status === 'failed' ? 'failed' : 'pending'
              } />
            </div>
            {lensHeadline(states) && (
              <p className="text-xs text-text-tertiary mt-3">{lensHeadline(states)}</p>
            )}
          </Card>

          {/* ── Setup gaps: the run already found these, buried in unanswered ── */}
          {gaps.length > 0 && (
            <Card className="p-4 border-amber-200 bg-amber-50/40">
              <SectionHead
                title="This run was working with one hand tied"
                subtitle="Each of these is costing the findings below some accuracy, and each is a field someone can set."
              />
              <ul className="mt-3 space-y-2">
                {gaps.map(g => (
                  <li key={g.key} className="text-xs text-text-secondary leading-relaxed">
                    <span className="text-text">{g.what}</span>{' '}
                    <Link to={g.to} className="text-sage-700 underline underline-offset-2">{g.fix}</Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {empty.empty ? (
            <Card className="p-5">
              <p className="text-sm text-text-secondary leading-relaxed">{empty.reason}</p>
            </Card>
          ) : null}

          {/* ── 1. ACT — the only section with a clock on it ── */}
          {act.length > 0 && (
            <Card className="p-4">
              <SectionHead
                title="Act on these"
                subtitle="Everything here has a date. Soonest first — the rest of the brief keeps."
              />
              <div className="mt-3 space-y-2.5">
                {act.map((f, i) => <ActCard key={i} finding={f} now={now} />)}
              </div>
            </Card>
          )}

          {/* ── 2. What it means for us ── */}
          {(report.gaps || []).length > 0 && (
            <Card className="p-4">
              <SectionHead
                title="What this means for us"
                subtitle="Where the market and our own position do not line up."
              />
              <div className="mt-3 space-y-3">
                {report.gaps.map((g, i) => (
                  <div key={i} className="rounded-xl border border-border bg-white p-3.5">
                    <p className="text-sm text-text leading-snug">{g.gap}</p>
                    {g.our_position && (
                      <p className="text-[11px] text-text-tertiary mt-2 leading-relaxed">
                        <span className="font-semibold">Us: </span>{g.our_position}
                      </p>
                    )}
                    {g.suggested_response && (
                      <p className="text-xs text-text-secondary mt-2 leading-relaxed">
                        <span className="font-semibold">Response: </span>{g.suggested_response}
                      </p>
                    )}
                    {g.basis && (
                      <p className="text-[10px] text-text-tertiary mt-2 uppercase tracking-wide">
                        evidence: {g.basis}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* ── 3. Proposals ── */}
          {(rules.length > 0 || (report.proposed_ideas || []).length > 0) && (
            <Card className="p-4">
              <SectionHead
                title="Proposed"
                subtitle="Nothing here is active. A rule steers every future caption, so it takes a person to say yes."
              />
              {rules.length > 0 && (
                <div className="mt-3 space-y-2">
                  <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Rules</p>
                  {rules.map(r => (
                    <ProposedRuleCard key={r.id} rule={r} onApprove={approve} onDismiss={dismiss} busy={busy} />
                  ))}
                </div>
              )}
              {(report.proposed_ideas || []).length > 0 && (
                <div className="mt-4 space-y-2">
                  <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Ideas</p>
                  {report.proposed_ideas.map((idea, i) => (
                    <div key={i} className="rounded-xl border border-border bg-white p-3">
                      <p className="text-xs font-semibold text-text">{idea.title || idea.angle}</p>
                      {idea.angle && idea.title && (
                        <p className="text-[11px] text-text-secondary mt-1.5 leading-relaxed">{idea.angle}</p>
                      )}
                      {idea.rationale && (
                        <p className="text-[11px] text-text-tertiary mt-2 leading-relaxed">{idea.rationale}</p>
                      )}
                      {idea.suggested_format && (
                        <p className="text-[10px] text-text-tertiary mt-1.5">{idea.suggested_format}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {/* Repeats are shown, never silently dropped — an agent that
                  quietly discards its own output is one you cannot calibrate. */}
              {(report.repeated_ideas || []).length > 0 && (
                <p className="text-[11px] text-text-tertiary mt-3">
                  {report.repeated_ideas.length} idea{report.repeated_ideas.length === 1 ? '' : 's'} dropped
                  for repeating something already proposed.
                </p>
              )}
            </Card>
          )}

          {/* ── 4. Standing observations ── */}
          {(standing.length > 0 || (report.market || []).length > 0) && (
            <Card className="p-4">
              <SectionHead
                title="Standing observations"
                subtitle="True for weeks rather than days. Informs planning, not this Thursday."
              />
              <div className="mt-3 space-y-2.5">
                {standing.map((f, i) => (
                  <div key={`f${i}`} className="rounded-xl border border-border bg-white p-3.5">
                    <p className="text-sm text-text leading-snug">{f.headline}</p>
                    {f.detail && <p className="text-[11px] text-text-secondary mt-1.5 leading-relaxed">{f.detail}</p>}
                    {f.suggested_action && (
                      <p className="text-xs text-text-secondary mt-2 leading-relaxed">
                        <span className="font-semibold">Do: </span>{f.suggested_action}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-2 text-[10px] text-text-tertiary">
                      <span className="uppercase tracking-wide">{f.lens}</span>
                      {f.confidence != null && <span>· confidence {pct(f.confidence)}</span>}
                    </div>
                    <Sources sources={f.sources} />
                  </div>
                ))}
                {(report.market || []).map((m, i) => (
                  <div key={`m${i}`} className="rounded-xl border border-border bg-white p-3.5">
                    <p className="text-sm text-text leading-snug">{m.finding}</p>
                    {m.confidence != null && (
                      <p className="text-[10px] text-text-tertiary mt-1.5">confidence {pct(m.confidence)} · {m.novelty || 'new'}</p>
                    )}
                    <Sources sources={m.sources} uncited={m.uncited} />
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* ── 5. The board ── */}
          {(report.competitor_board || []).length > 0 && (
            <Card className="p-4">
              <SectionHead
                title="The board"
                subtitle="Measured, computed in code. Never estimated by a model."
              />
              <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                {report.competitor_board.map((c, i) => <CompetitorCard key={i} c={c} />)}
              </div>
              {(report.movements || []).length > 0 && (
                <div className="mt-4 space-y-1.5">
                  <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Moved</p>
                  {report.movements.map((m, i) => (
                    <p key={i} className="text-xs text-text-secondary">
                      <span className="text-text">{m.what || m.competitor}</span>
                      {m.from != null && ` — ${m.from} → ${m.to}`}
                      {m.change_pct != null && ` (${m.change_pct}%)`}
                      {m.significance && <span className="text-text-tertiary"> · {m.significance}</span>}
                    </p>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* ── 6. What each lens did. The section that makes the rest trustworthy ── */}
          {states.length > 0 && (
            <Card className="p-4">
              <SectionHead
                title="What was checked"
                subtitle="A lens that looked and found nothing is not the same as one that could not answer, so both are named."
              />
              <div className="mt-3 space-y-1.5">
                {states.map(s => (
                  <div key={s.key} className="flex items-baseline gap-3 text-xs">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 w-[130px] text-center ${LENS_STATE[s.state]?.tone || ''}`}>
                      {LENS_STATE[s.state]?.label || s.state}
                    </span>
                    <span className="text-text font-medium w-[120px] shrink-0">{s.label}</span>
                    <span className="text-text-tertiary truncate">
                      {s.error || s.question}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* ── 7. What it could not answer ── */}
          {(report.unanswered || []).length > 0 && (
            <Card className="p-4">
              <SectionHead
                title="Could not answer"
                subtitle="A research agent that never admits a miss is one you cannot calibrate."
              />
              <ul className="mt-3 space-y-2">
                {report.unanswered.map((u, i) => (
                  <li key={i} className="text-xs text-text-tertiary leading-relaxed">{u}</li>
                ))}
              </ul>
            </Card>
          )}

          {passed.length > 0 && (
            <Card className="p-4">
              <SectionHead
                title="Deadlines that passed"
                subtitle="Kept rather than hidden — an expired window explains a miss."
              />
              <div className="mt-3 space-y-1.5">
                {passed.map((f, i) => (
                  <p key={i} className="text-xs text-text-tertiary">
                    <span className="line-through">{f.headline}</span> · {deadlineLabel(f, now)}
                  </p>
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      {/* ── Run history ── */}
      {runs.length > 1 && (
        <Card className="p-4">
          <SectionHead title="Past runs" />
          <ul className="mt-3 space-y-1">
            {runs.map(r => (
              <li key={r.id}>
                <button
                  onClick={() => setSelectedId(r.id)}
                  className={`w-full text-left text-xs px-2 py-1.5 rounded flex items-baseline gap-2 hover:bg-surface-subtle ${
                    r.id === selected?.id ? 'bg-surface-subtle' : ''
                  }`}
                >
                  <span className={
                    r.status === 'complete' ? 'text-emerald-600'
                      : r.status === 'failed' ? 'text-red-500' : 'text-amber-500'
                  }>●</span>
                  <span className="text-text-tertiary w-28 shrink-0">
                    {new Date(r.started_at).toLocaleDateString(undefined, {
                      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                  <span className="text-text-secondary truncate">
                    {r.error || r.report?.headline || `${r.status} · ${r.stage || ''}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <AgentSteering />
    </div>
  )
}
