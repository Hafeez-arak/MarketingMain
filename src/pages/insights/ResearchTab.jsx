import { useMemo } from 'react'
import { Card, SectionHead, Button, Empty, Badge, PillSelect } from '../../components/ui/index'
import { AgentSteering } from '../../components/AgentSteering'
import { RunProgress } from '../../components/RunProgress'
import {
  partitionByClock, deadlineLabel, urgencyOf, lensStates, lensHeadline,
  emptiness, pct, compact, signed, ownChannelRows,
} from '../../lib/researchBrief'

// ─── The Research tab — what is happening out there, and what to do ────────
// The outward, perishable half of this page. A brief expires: National Day
// passes, a tender closes, a standard comes into force. Everything durable —
// the rules, our own performance, the decisions we made — is the other tab.
//
// Two things that used to be here have moved, and both moves were about the
// same thing:
//
//   the setup gaps   -> the page-level summary above the tabs, because they
//                       hold BOTH halves back, not just this one.
//   proposed RULES   -> the rule book on the What We Learned tab. They were
//                       rendered here by a second component with its own
//                       behaviour, which is the drift RESEARCH-AGENT.md §8b
//                       ("no new approval surface") exists to prevent.
//
// Ideas stay, because an idea is output of this particular run and is read
// next to the finding that produced it — unlike a rule, which is a standing
// instruction that outlives the run entirely.

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

const CHANNEL_TONE = {
  measured: 'border-border bg-white',
  unmeasured: 'border-amber-200 bg-amber-50/40',
  silent: 'border-border bg-slate-50/60',
  not_connected: 'border-dashed border-border bg-transparent',
}

/**
 * One of our own channels.
 *
 * Deliberately a different card from CompetitorCard, though the numbers rhyme.
 * Ours are per-POST engagement from our own analytics on any platform; theirs
 * are per-PROFILE figures from business_discovery and exist on Instagram only.
 * One card serving both would quietly imply the two are the same measurement,
 * which is the confusion this whole section has to avoid.
 */
function ChannelCard({ p }) {
  const dim = p.state === 'not_connected'
  return (
    <div className={`rounded-xl border p-3.5 ${CHANNEL_TONE[p.state] || CHANNEL_TONE.measured}`}>
      <div className="flex items-baseline justify-between gap-2">
        <p className={`text-sm font-semibold truncate ${dim ? 'text-text-tertiary' : 'text-text'}`}>{p.label}</p>
        {p.username && <span className="text-[11px] text-text-tertiary shrink-0">@{p.username}</span>}
      </div>

      {p.state !== 'measured' ? (
        <p className="text-[11px] text-text-tertiary mt-2 leading-relaxed">{p.note}</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 mt-3">
            <div>
              <p className="text-[10px] text-text-tertiary uppercase tracking-wide">Posts</p>
              <p className="text-sm font-semibold tabular-nums">{p.posts}</p>
              {/* Never shown without it. "We published 6" beside an average
                  computed from 2 is a true-sounding overstatement. */}
              <p className="text-[10px] text-text-tertiary tabular-nums">{p.measured} measured</p>
            </div>
            <div>
              <p className="text-[10px] text-text-tertiary uppercase tracking-wide">Eng/post</p>
              <p className="text-sm font-semibold tabular-nums">{p.avg_engagement ?? '—'}</p>
              {p.avg_engagement_prev != null && (
                <p className="text-[10px] text-text-tertiary tabular-nums">was {p.avg_engagement_prev}</p>
              )}
            </div>
            <div>
              <p className="text-[10px] text-text-tertiary uppercase tracking-wide">Week</p>
              <p className={`text-sm font-semibold tabular-nums ${
                p.change ? (p.change.direction === 'up' ? 'text-emerald-600' : 'text-red-600') : ''}`}>
                {p.change ? `${p.change.direction === 'up' ? '+' : '−'}${p.change.change_pct}%` : '—'}
              </p>
              {!p.change && <p className="text-[10px] text-text-tertiary">no call yet</p>}
            </div>
          </div>
          {p.weak && (
            <p className="text-[11px] text-amber-700 mt-2">
              Thin sample — directional, not conclusive.
            </p>
          )}
          {p.best_post && (
            <p className="text-[11px] text-text-secondary mt-2 leading-relaxed">
              Best: {p.best_post.topic || 'untitled'} · {p.best_post.engagement} interactions
            </p>
          )}
        </>
      )}
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

export function ResearchTab({
  run, runs, lensRows, selectedId, onSelectRun, onRun, running, now,
}) {
  const report = useMemo(() => run?.report || {}, [run])
  const { act, standing, passed } = useMemo(
    () => partitionByClock(report.findings || [], now), [report, now],
  )
  const states = useMemo(() => lensStates(report), [report])
  const empty = useMemo(() => emptiness(report), [report])
  const channels = useMemo(() => ownChannelRows(report), [report])

  if (!runs.length) {
    return (
      <Empty
        title="No research has been run for this brand yet"
        description="A run measures every competitor with a verified Instagram handle, then investigates what changed. The numbers are computed in code, never by a model."
        action={<Button onClick={onRun} disabled={running}>Run research</Button>}
      />
    )
  }

  return (
    <div className="space-y-4">
      {/* Live first, because while a run is going it is the only thing on this
          page that is changing. Afterwards it is the fastest way to see
          whether the brief below rests on five answers or on two. */}
      <RunProgress run={run} lensRows={lensRows} now={now} />

      {/* The brief selector. This replaces a list of past runs at the BOTTOM of
          the page — reading an older brief meant scrolling past the current
          one to find it. Picking a date here swaps the whole brief below. */}
      {runs.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-text-tertiary uppercase tracking-wide">Brief</span>
          <PillSelect value={selectedId || runs[0].id} onChange={e => onSelectRun(e.target.value)}>
            {runs.map(r => (
              <option key={r.id} value={r.id}>
                {new Date(r.started_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                {' — '}
                {(r.error || r.report?.headline || r.status).slice(0, 70)}
              </option>
            ))}
          </PillSelect>
        </div>
      )}

          {/* ── The headline, and how the run actually went ── */}
          <Card className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[11px] text-text-tertiary uppercase tracking-wide">
                  {fmtDate(report.period?.start)} – {fmtDate(report.period?.end)}
                  {report.baseline ? ' · first measurement, nothing to compare against yet' : ''}
                </p>
                <p className="text-base font-semibold text-text mt-1.5 leading-snug">
                  {run.error || report.headline || 'No headline.'}
                </p>
              </div>
              {/* Badge renders STATUS_META's own label when the status is one
                  it knows, so the run's vocabulary is mapped onto it rather
                  than passed through — 'complete' is not a key, 'completed' is. */}
              <Badge status={
                run.status === 'complete' ? 'completed'
                  : run.status === 'failed' ? 'failed' : 'pending'
              } />
            </div>
            {lensHeadline(states) && (
              <p className="text-xs text-text-tertiary mt-3">{lensHeadline(states)}</p>
            )}
          </Card>

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

          {/* ── 3. Ideas this run proposed ──
              RULES are NOT here. They live once, in the rule book on the other
              tab, behind the one approval surface RESEARCH-AGENT.md §8b asked
              for. Showing them in both places meant two components and two
              behaviours drifting apart, which is exactly what it warned
              against. Ideas stay because they are output of this run rather
              than a standing rule, and they are read alongside the finding
              that produced them. */}
          {(report.proposed_ideas || []).length > 0 && (
            <Card className="p-4">
              <SectionHead
                title="Ideas from this run"
                subtitle="Suggested content, tied to what was found. Rules are reviewed under What We Learned."
              />
              <div className="mt-3 space-y-2">
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

          {/* ── 4b. Our own channels ──
              Above the competitor board on purpose. Our own week is the thing
              we can actually act on, and it is measured on every platform we
              publish to rather than on the one platform rivals happen to be
              readable on. */}
          {channels.length > 0 && (
            <Card className="p-4">
              <SectionHead
                title="Our channels"
                subtitle="Our own posts, measured from our own analytics. Every platform we publish to."
              />
              <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                {channels.map(p => <ChannelCard key={p.platform} p={p} />)}
              </div>
              {report.own_performance?.note && (
                <p className="text-[11px] text-text-tertiary mt-3">{report.own_performance.note}</p>
              )}
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

      <AgentSteering />
    </div>
  )
}
