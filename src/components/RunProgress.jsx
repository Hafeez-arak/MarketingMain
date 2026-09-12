import { Card, SectionHead } from './ui/index'
import {
  runProgress, progressLine, secs, looksStuck, PHASE_LABELS,
} from '../lib/agent/progress'

// ─── Watching a research run happen ────────────────────────────────────────
// The run takes minutes and, until now, showed nothing while it did. A person
// who pressed the button saw a status word and had no way to tell a run that
// was working from one that had died — which is the same failure the server
// side spent so much effort on, arriving one layer up.
//
// Every number here comes from Postgres, not from n8n's execution log: each
// lens writes its own row the moment it finishes. n8n presses the buttons; the
// run narrates itself.
//
// The rule this component follows: NEVER show a lens as working unless the run
// itself says it is running. On a run that died at lens two, the remaining
// lenses are `skipped`, not spinning — a progress bar that keeps going after
// the run stopped is worse than no progress bar, because it is a lie that
// looks like information.

const STATE = {
  done:    { dot: 'bg-sage-500',   text: 'text-text',           label: n => `${n} finding${n === 1 ? '' : 's'}` },
  quiet:   { dot: 'bg-stone-300',  text: 'text-text-tertiary',  label: () => 'nothing found' },
  failed:  { dot: 'bg-red-400',    text: 'text-red-600',        label: () => 'could not answer' },
  running: { dot: 'bg-amber-400',  text: 'text-text-secondary', label: () => 'working…' },
  skipped: { dot: 'bg-stone-200',  text: 'text-text-tertiary',  label: () => 'not reached' },
}

export function RunProgress({ run, lensRows, now = new Date() }) {
  if (!run) return null
  const p = runProgress(run, lensRows)
  const stuck = looksStuck(run, now)

  return (
    <Card className="p-4">
      <SectionHead
        title={p.live ? 'Running now' : 'How the last run went'}
        subtitle={progressLine(p)}
        action={
          p.cost > 0
            ? <span className="text-[11px] text-text-tertiary tabular-nums">${p.cost.toFixed(2)}</span>
            : null
        }
      />

      {/* The bar. Deliberately never 100% until the run is genuinely finished. */}
      <div className="mt-3 h-1 bg-surface-subtle overflow-hidden">
        <div
          className={`h-full transition-[width] duration-700 ${p.failed ? 'bg-red-400' : 'bg-sage-500'}`}
          style={{ width: `${p.percent}%` }}
        />
      </div>

      {/* The three phases, so "why is it still going" has an answer. */}
      <div className="mt-3 flex items-center gap-1 text-[10px] uppercase tracking-wide">
        {PHASE_LABELS.filter(ph => ph.key !== 'complete').map((ph, i) => {
          const reached = i <= p.phaseIndex
          const current = ph.key === p.stage && p.live
          return (
            <span
              key={ph.key}
              title={ph.note}
              className={`px-1.5 py-0.5 ${
                current ? 'bg-amber-100 text-amber-800'
                  : reached ? 'bg-sage-100 text-sage-700'
                    : 'bg-surface-subtle text-text-tertiary'
              }`}
            >
              {ph.label}
            </span>
          )
        })}
      </div>

      {stuck && (
        <p className="mt-3 text-xs text-amber-700 leading-relaxed">
          This run has been going for over 20 minutes. It is probably dead — the next run
          you start will sweep it and report it as timed out.
        </p>
      )}

      <div className="mt-3 space-y-1.5">
        {p.lenses.map(l => {
          const s = STATE[l.state] || STATE.skipped
          return (
            <div key={l.key} className="flex items-baseline gap-2.5 text-xs">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 translate-y-[-1px] ${s.dot} ${
                l.state === 'running' ? 'animate-pulse' : ''
              }`} />
              <span className={`w-[130px] shrink-0 font-medium ${s.text}`}>{l.label}</span>
              <span className="text-text-tertiary truncate flex-1" title={l.question}>
                {l.error || l.question}
              </span>
              <span className="text-[10px] text-text-tertiary shrink-0 tabular-nums">
                {s.label(l.findings)}
                {l.durationMs != null && ` · ${secs(l.durationMs)}`}
                {/* Named so "free" does not read as "broken". */}
                {l.computed && ' · computed'}
              </span>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
