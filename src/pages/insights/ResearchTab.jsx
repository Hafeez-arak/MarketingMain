import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Card, SectionHead, Button, Empty, Badge, PillSelect } from '../../components/ui/index'
import { AgentSteering } from '../../components/AgentSteering'
import { SendIdeasToPlan } from '../../components/SendIdeasToPlan'
import { RunProgress } from '../../components/RunProgress'
import {
  partitionByClock, deadlineLabel, urgencyOf, lensStates, lensHeadline,
  emptiness, pct, compact, signed, ownChannelRows, marketDirection, actionPlan, basisLabel,
} from '../../lib/researchBrief'
import { noveltyLabel } from '../../lib/agent/novelty'
import { isLive } from '../../lib/agent/progress'

// ─── The Research tab — what is happening out there, and what to do ────────
// The outward, perishable half of this page. A brief expires: National Day
// passes, a tender closes, a standard comes into force. Everything durable —
// the rules, our own performance, the decisions we made — is the other tab.
//
// ── WHY THIS IS IN ZONES RATHER THAN A LIST ──
//
// It used to be thirteen cards of equal weight in one column: progress,
// selector, headline, act, gaps, ideas, standing, channels, board, lenses,
// unanswered, passed deadlines, watchlist. Every one of them looked exactly as
// important as every other, there was no way to jump, and the two sections a
// person actually acts on sat above six they only consult when they doubt the
// first two. Reading it top to bottom was the only way through, and nobody
// reads a weekly report top to bottom twice.
//
// So the same content, in four zones, with a rail that jumps to each:
//
//   DO THIS            where the market is going, what has a clock on it, and
//                      the gaps with the ideas that close them.
//   EVIDENCE           the numbers the first zone rests on.
//   HOW THIS RUN WENT  the audit trail. Collapsed, because it is read when you
//                      doubt something — and a reader who doubts nothing
//                      should not have to scroll past it.
//   WHAT IT WATCHES    the watchlist and the standing questions. Setup, not
//                      reading, and it no longer sits inside the report.
//
// ── AND WHY GAPS AND IDEAS ARE ONE SECTION ──
//
// They were two cards a screen apart. In the 12 Sep brief, gap 1 ended
// "publish a short technical brief" and idea 2 WAS that brief — connected only
// by a sentence of rationale the reader had to match up from memory. The run
// now writes `answers` on every idea, so the idea renders under the gap it
// closes. Briefs written before that still render flat, which is exactly what
// they did before.
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
        {finding.novelty && <span>· {noveltyLabel(finding, now)}</span>}
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


// ─── The rail ──────────────────────────────────────────────────────────────
// Sticky, four buttons, and it tracks what you are looking at. The count
// beside each label is the point: it says whether a zone is worth the jump
// before you make it, which a plain anchor list does not.

function Rail({ zones, active, onJump }) {
  return (
    <div className="sticky top-0 z-20 -mx-6 px-6 py-2 bg-surface-muted/95 backdrop-blur border-b border-border">
      <div className="flex gap-1 overflow-x-auto scrollbar-thin">
        {zones.map(z => (
          <button
            key={z.key}
            onClick={() => onJump(z.key)}
            className={`shrink-0 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              active === z.key
                ? 'bg-amber-700 text-white'
                : 'text-text-secondary hover:text-text hover:bg-white'
            }`}
          >
            {z.label}
            {z.count != null && (
              <span className={`ml-1.5 tabular-nums font-normal ${
                active === z.key ? 'text-white/70' : 'text-text-tertiary'}`}>
                {z.count}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

// scroll-mt keeps the heading clear of the rail that just scrolled you to it —
// without it every jump lands with the title hidden behind the sticky bar.
function Zone({ id, title, note, children }) {
  return (
    <section id={id} data-zone={id} className="scroll-mt-16 space-y-4">
      <div className="pt-2">
        <h2 className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">{title}</h2>
        {note && <p className="text-[11px] text-text-tertiary mt-0.5">{note}</p>}
      </div>
      {children}
    </section>
  )
}

// Native <details>, deliberately. A hand-rolled disclosure would need its own
// open state, and the browser's already survives a re-render, works with
// find-in-page, and is keyboard-accessible without any of it being written.
function Fold({ title, subtitle, count, children, open = false }) {
  return (
    <Card className="p-0 overflow-hidden">
      <details open={open} className="group">
        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden p-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text">{title}</p>
            {subtitle && <p className="text-[11px] text-text-tertiary mt-0.5 leading-relaxed">{subtitle}</p>}
          </div>
          <span className="shrink-0 text-[11px] text-text-tertiary tabular-nums">
            {count != null ? `${count} ` : ''}
            <span className="group-open:hidden">show</span>
            <span className="hidden group-open:inline">hide</span>
          </span>
        </summary>
        <div className="px-4 pb-4 -mt-1">{children}</div>
      </details>
    </Card>
  )
}

// ─── Where the market is moving ────────────────────────────────────────────
// The first thing in the brief, because it is the sentence a reader was
// assembling in their head anyway out of the per-rival reads at the bottom of
// the board, the movements beside them, and the market findings four cards up.
//
// `derived` is shown, never hidden. A direction the agent wrote and a list
// this page stitched out of an older brief are different claims.

function DirectionCard({ direction }) {
  if (!direction.items.length) return null
  return (
    <Card className="p-4">
      <SectionHead
        title="Where the market is moving"
        subtitle={direction.derived
          ? 'Assembled from this run\'s per-rival reads — it predates the agent writing this section itself.'
          : 'Read across the board, the movements and the week\'s sources. Not a new finding.'}
      />
      <ul className="mt-3 space-y-2.5">
        {direction.items.map((m, i) => (
          <li key={i} className="rounded-xl border border-border bg-white p-3.5">
            <p className="text-sm text-text leading-snug">{m.movement}</p>
            {m.so_what && (
              <p className="text-xs text-text-secondary mt-2 leading-relaxed">
                <span className="font-semibold">For us: </span>{m.so_what}
              </p>
            )}
            {basisLabel(m.basis) && (
              <p className="text-[10px] text-text-tertiary mt-2 uppercase tracking-wide">{basisLabel(m.basis)}</p>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}

// An idea, with the thing it answers named ON it rather than left in prose.
function IdeaCard({ idea, under = false }) {
  const ref = idea.answers_ref
  return (
    <div className={`rounded-xl border border-border bg-white p-3 ${under ? 'ml-3 border-l-2 border-l-sage-400' : ''}`}>
      <p className="text-xs font-semibold text-text">{idea.title || idea.angle}</p>
      {idea.angle && idea.title && (
        <p className="text-[11px] text-text-secondary mt-1.5 leading-relaxed">{idea.angle}</p>
      )}
      {/* Only for an idea that is NOT already sitting under its gap — there the
          binding is the position, and repeating it would be noise. */}
      {!under && ref?.kind === 'finding' && ref.headline && (
        <p className="text-[11px] text-sage-700 mt-2 leading-relaxed">
          <span className="font-semibold">Answers: </span>{ref.headline}
        </p>
      )}
      {idea.rationale && (
        <p className="text-[11px] text-text-tertiary mt-2 leading-relaxed">{idea.rationale}</p>
      )}
      {idea.suggested_format && (
        <p className="text-[10px] text-text-tertiary mt-1.5">{idea.suggested_format}</p>
      )}
    </div>
  )
}

// A gap and the content that closes it, as one unit.
function GapBlock({ block }) {
  const { gap, ideas } = block
  return (
    <div className="rounded-xl border border-border bg-white p-3.5">
      <p className="text-sm text-text leading-snug">{gap.gap}</p>
      {gap.our_position && (
        <p className="text-[11px] text-text-tertiary mt-2 leading-relaxed">
          <span className="font-semibold">Us: </span>{gap.our_position}
        </p>
      )}
      {gap.suggested_response && (
        <p className="text-xs text-text-secondary mt-2 leading-relaxed">
          <span className="font-semibold">Response: </span>{gap.suggested_response}
        </p>
      )}
      {gap.basis && (
        <p className="text-[10px] text-text-tertiary mt-2 uppercase tracking-wide">
          evidence: {gap.basis}
        </p>
      )}
      {ideas.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border space-y-2">
          <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">
            Content that closes it
          </p>
          {ideas.map((idea, i) => <IdeaCard key={i} idea={idea} under />)}
        </div>
      )}
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
  const direction = useMemo(() => marketDirection(report), [report])
  const plan = useMemo(() => actionPlan(report), [report])
  const live = isLive(run)

  // What each zone is worth jumping to. Counted from the same arrays the zone
  // renders, so a zone can never advertise a number it does not contain.
  const counts = useMemo(() => ({
    act: direction.items.length + act.length + plan.blocks.length + plan.loose.length,
    evidence: channels.length + (report.competitor_board || []).length
      + standing.length + (report.market || []).length,
    quality: states.length + (report.unanswered || []).length + passed.length,
  }), [direction, act, plan, channels, report, standing, states, passed])

  // A zone with nothing in it is not listed and not rendered. A failed run has
  // no findings and no gaps, and a rail offering "Do this 0" above an empty
  // heading is worse than a shorter rail — it sends a reader somewhere to
  // find out there was nothing there.
  const zones = useMemo(() => [
    { key: 'act', label: 'Do this', count: counts.act },
    { key: 'evidence', label: 'Evidence', count: counts.evidence },
    { key: 'quality', label: 'How this run went', count: counts.quality },
    // Never counted and never hidden: it is the only zone that is not part of
    // this brief, and it is the one thing still worth reaching on a run that
    // produced nothing at all.
    { key: 'watch', label: 'What it watches' },
  ].filter(z => z.count == null || z.count > 0), [counts])

  const [activeZone, setActiveZone] = useState('act')
  const rootRef = useRef(null)
  // Derived rather than corrected in an effect. The rail's first entry is not
  // always 'act' — on a failed run that zone does not exist — and a state
  // fix-up would render one frame highlighting a button that is not there.
  const active = zones.some(z => z.key === activeZone) ? activeZone : zones[0]?.key

  const jump = useCallback(key => {
    document.getElementById(`brief-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    // Set immediately rather than waiting for the observer: a smooth scroll
    // takes a few hundred ms, and a rail that does not respond to its own
    // click until the scroll lands reads as a broken button.
    setActiveZone(key)
  }, [])

  // Which zone is on screen.
  //
  // The callback is handed only the zones whose visibility CHANGED, in the
  // order the observer noticed them — not in document order, and not the whole
  // set. Reading `entries[0]` from that is why the rail sat on "Do this" with
  // Evidence filling the screen: scrolling down fires one entry, the zone that
  // just left. So visibility is accumulated across callbacks and the topmost
  // visible zone in DOCUMENT order wins.
  //
  // rootMargin pulls the trigger line down from the very top so a zone counts
  // as current once its heading is comfortably in view, rather than the moment
  // one pixel of it appears.
  useEffect(() => {
    const nodes = [...(rootRef.current?.querySelectorAll('[data-zone]') || [])]
    if (!nodes.length || typeof IntersectionObserver === 'undefined') return undefined
    const seen = new Map()
    const io = new IntersectionObserver(
      entries => {
        for (const e of entries) seen.set(e.target, e.isIntersecting)
        const top = nodes.find(n => seen.get(n))
        if (top) setActiveZone(top.dataset.zone.replace('brief-', ''))
      },
      { rootMargin: '-15% 0px -60% 0px', threshold: 0 },
    )
    nodes.forEach(n => io.observe(n))
    return () => io.disconnect()
  }, [run?.id, zones])

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
    <div ref={rootRef} className="space-y-4">
      {/* Only while it is happening. A finished run's progress belongs in the
          audit zone with the rest of the trail — at the top of the page it was
          the first thing a reader met every week, and it is the thing they
          care about least once the brief exists. */}
      {live && <RunProgress run={run} lensRows={lensRows} now={now} />}

      {/* The brief selector. Picking a date swaps the whole brief below. */}
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

      {/* ── The headline. Above the rail, because it belongs to no zone ── */}
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
          {/* Badge renders STATUS_META's own label when the status is one it
              knows, so the run's vocabulary is mapped onto it rather than
              passed through — 'complete' is not a key, 'completed' is. */}
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

      <Rail zones={zones} active={active} onJump={jump} />

      {/* ══ ZONE 1 — Do this ══ */}
      {counts.act > 0 && <Zone
        id="brief-act"
        title="Do this"
        note="Where the market is going, what has a clock on it, and the content that answers it."
      >
        <DirectionCard direction={direction} />

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

        {/* ── Gaps and the ideas that close them, as ONE section ──
            RULES are not here. They live once, in the rule book on the other
            tab, behind the one approval surface RESEARCH-AGENT.md §8b asked
            for. Ideas stay because they are output of this run rather than a
            standing instruction. */}
        {(plan.blocks.length > 0 || plan.loose.length > 0) && (
          <Card className="p-4">
            <SectionHead
              title="What this means for us"
              subtitle="Where the market and our position do not line up — and the content that answers it. Rules are reviewed under What We Learned."
            />
            <div className="mt-3 space-y-3">
              {plan.blocks.map(block => <GapBlock key={block.gap.id} block={block} />)}
            </div>

            {plan.loose.length > 0 && (
              <div className="mt-3 space-y-2">
                {/* Named only when there is something above for them to be
                    loose FROM. On an older brief every idea lands here and
                    there is no gap binding to explain. */}
                {plan.blocks.length > 0 && (
                  <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide pt-3 border-t border-border">
                    Other ideas from this run
                  </p>
                )}
                {plan.loose.map((idea, i) => <IdeaCard key={i} idea={idea} />)}
              </div>
            )}

            {plan.ideaCount > 0 && <SendIdeasToPlan ideas={plan.ordered} />}

            {(report.repeated_ideas || []).length > 0 && (
              <p className="text-[11px] text-text-tertiary mt-3">
                {report.repeated_ideas.length} idea{report.repeated_ideas.length === 1 ? '' : 's'} dropped
                for repeating something already proposed.
              </p>
            )}
          </Card>
        )}
      </Zone>}

      {/* ══ ZONE 2 — Evidence ══ */}
      {counts.evidence > 0 && <Zone
        id="brief-evidence"
        title="Evidence"
        note="The numbers and sources the zone above rests on."
      >
        {/* Our own week first. It is the thing we can act on, and it is
            measured on every platform we publish to rather than on the one
            platform rivals happen to be readable on. */}
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
      </Zone>}

      {/* ══ ZONE 3 — How this run went ══
          The audit trail, folded. It is read when a reader doubts something
          above it, and a reader who doubts nothing should not scroll past it
          to reach the watchlist. Nothing is removed — a run that never admits
          a miss is one you cannot calibrate. */}
      {counts.quality > 0 && <Zone
        id="brief-quality"
        title="How this run went"
        note="The audit trail. Open it when you want to know how much of the brief to believe."
      >
        {report.repetition && (
          <Card className="p-3"><p className="text-xs text-amber-700">{report.repetition}</p></Card>
        )}

        {states.length > 0 && (
          <Fold
            title="What was checked"
            subtitle="A lens that looked and found nothing is not the same as one that could not answer, so both are named."
            count={states.length}
            open={states.some(s => s.state === 'failed')}
          >
            <div className="mt-3 space-y-1.5">
              {states.map(s => (
                <div key={s.key} className="flex items-baseline gap-3 text-xs">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 w-[130px] text-center ${LENS_STATE[s.state]?.tone || ''}`}>
                    {LENS_STATE[s.state]?.label || s.state}
                  </span>
                  <span className="text-text font-medium w-[120px] shrink-0">{s.label}</span>
                  <span className="text-text-tertiary truncate">{s.error || s.question}</span>
                </div>
              ))}
            </div>
          </Fold>
        )}

        {(report.unanswered || []).length > 0 && (
          <Fold
            title="Could not answer"
            subtitle="A research agent that never admits a miss is one you cannot calibrate."
            count={report.unanswered.length}
          >
            <ul className="mt-3 space-y-2">
              {report.unanswered.map((u, i) => (
                <li key={i} className="text-xs text-text-tertiary leading-relaxed">{u}</li>
              ))}
            </ul>
          </Fold>
        )}

        {passed.length > 0 && (
          <Fold
            title="Deadlines that passed"
            subtitle="Kept rather than hidden — an expired window explains a miss."
            count={passed.length}
          >
            <div className="mt-3 space-y-1.5">
              {passed.map((f, i) => (
                <p key={i} className="text-xs text-text-tertiary">
                  <span className="line-through">{f.headline}</span> · {deadlineLabel(f, now)}
                </p>
              ))}
            </div>
          </Fold>
        )}

        {!live && <RunProgress run={run} lensRows={lensRows} now={now} />}
      </Zone>}

      {/* ══ ZONE 4 — What it watches ══
          Setup, not reading. It used to sit at the bottom of the report with
          no heading, which made it look like a last section of the brief
          rather than the controls that decide what the NEXT one measures. */}
      <Zone
        id="brief-watch"
        title="What it watches"
        note="Not part of this brief — this is what the next one will measure."
      >
        <AgentSteering />
      </Zone>
    </div>
  )
}
