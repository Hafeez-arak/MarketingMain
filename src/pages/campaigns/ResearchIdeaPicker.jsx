import { Link } from 'react-router-dom'
import { formatDate } from '../../lib/utils'

// ─── "From your research", on the setup step ───────────────────────────────
// The pull half of the research loop.
//
// Pushing already worked: the research page can send a run's ideas into a plan
// that already exists (components/SendIdeasToPlan.jsx). But that only helps
// someone who thought to open the report first, it needs the plan to exist
// before the ideas can go anywhere, and it is all-or-nothing — every idea or
// none. In practice the report was a page you had to remember, and the ideas
// on it were read and forgotten.
//
// Planning a month is the moment those ideas are actually wanted, so this puts
// them there, one tick each. What gets ticked is sent to the planner as an
// instruction rather than as background: the workflow already receives the
// whole latest run to use IF it fits, and the difference between that and this
// is the difference between the agent having a voice and having a say.
//
// WHY EVERY IDEA IS LISTED, UNFILTERED
//
// It would be easy to show only the ideas that look seasonal, or urgent, or
// that match the month being planned. That is exactly the judgement the person
// is sitting here to make, and a list that quietly hid some of them would be
// making it for them while looking like it hadn't.
//
// WHY THE REASONING IS ON EVERY ROW
//
// `answers` is what the run said this idea addresses — the gap or the finding.
// Without it "Ramadan lighting guide" is a chore someone has to take on faith.
// With it, it is "rivals are all running Ramadan content and we are not", and
// ticking the box is a decision rather than a guess.

export function ResearchIdeaPicker({ research, selectedKeys, onToggle, usedKeys = [] }) {
  const { runDate, ideas, latestRunDate, staleIdeas } = research || {}

  // ── A run that proposed nothing is not the same as no run ─────────────
  // A workspace that has never run research should see the planner it has
  // always seen, so that case still gets no box. But a run that FINISHED
  // and proposed nothing used to take the same branch, and the whole panel
  // vanished — which is indistinguishable from the feature not existing.
  // It has happened: the 17 Sep 2026 run came back `complete` with 33
  // findings and every synthesis array empty. Say it instead.
  if (!ideas?.length) {
    if (!latestRunDate) return null
    return (
      <div className="border border-border bg-surface-subtle/60 p-3">
        <p className="text-[11px] text-text-secondary leading-relaxed">
          Your latest research run ({formatDate(latestRunDate)}) proposed no content ideas, so there is
          nothing to pick from here. The run is still sent to the planner as background.{' '}
          <Link to="/insights" className="underline hover:text-text">Open the run</Link> to see what it found.
        </p>
      </div>
    )
  }

  const selected = selectedKeys || []
  const used = new Set(usedKeys)

  return (
    <div className="border border-border bg-sage-50/40 p-4">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="min-w-0">
          <p className="text-sm font-bold text-text">From your research</p>
          <p className="text-[11px] text-text-tertiary mt-0.5">
            What the research agent proposed{runDate ? ` on ${formatDate(runDate)}` : ''}. Tick the ones this
            month should be built around — they are sent as instructions, with the reason they exist attached.
          </p>
          {staleIdeas && (
            <p className="text-[11px] text-amber-700 mt-1">
              Your latest run ({formatDate(latestRunDate)}) proposed no ideas, so these are from the run before it.
            </p>
          )}
        </div>
        <Link to="/insights" className="text-[11px] underline text-text-tertiary hover:text-text-secondary shrink-0">
          View the run
        </Link>
      </div>

      <div className="space-y-1.5 mt-3">
        {ideas.map(idea => {
          const on = selected.includes(idea.key)
          // Already in a plan — via this picker on an earlier month, or via
          // the research page's own send button. Still tickable: the same
          // angle can genuinely be worth revisiting, and refusing would be
          // this component overruling the person again. Saying so is enough.
          const already = used.has(idea.key)
          return (
            <button
              key={idea.key}
              type="button"
              onClick={() => onToggle(idea.key)}
              className={`w-full text-left px-3 py-2.5 border transition-all ${
                on ? 'bg-white border-amber-600' : 'bg-white/60 border-border hover:border-amber-400'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <span
                  aria-hidden="true"
                  className={`mt-0.5 w-4 h-4 shrink-0 border flex items-center justify-center text-[10px] font-bold ${
                    on ? 'bg-amber-700 border-amber-700 text-white' : 'bg-white border-border text-transparent'
                  }`}
                >
                  ✓
                </span>
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold text-text leading-snug">
                    {idea.title}
                    {idea.suggested_format && (
                      <span className="font-normal text-text-tertiary"> · {idea.suggested_format}</span>
                    )}
                    {already && (
                      <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 bg-stone-100 text-text-tertiary border border-border">
                        already used
                      </span>
                    )}
                  </p>
                  {idea.angle && (
                    <p className="text-[11px] text-text-secondary leading-relaxed mt-0.5">{idea.angle}</p>
                  )}
                  {idea.answers && (
                    <p className="text-[11px] text-text-tertiary leading-relaxed mt-1">
                      <span className="font-semibold">Answers:</span> {idea.answers}
                    </p>
                  )}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <p className="text-[11px] text-text-tertiary mt-2.5">
        {selected.length
          ? `${selected.length} of ${ideas.length} selected — the plan will be built around ${selected.length === 1 ? 'it' : 'them'}.`
          : `Nothing selected. The run is still sent as background either way; ticking one makes it a requirement instead of a suggestion.`}
      </p>
    </div>
  )
}
