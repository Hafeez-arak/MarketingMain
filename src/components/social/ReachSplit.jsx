import { useState } from 'react'
import { Icon } from '../ui/icons'
import { IconBadge } from '../ui/index'
import { MetricInfoDot } from '../analytics/MetricLabel'
import { fmt, pct } from '../../pages/analytics/format'
import { splitReach, reachFor, shareOf, FOLLOWER, NON_FOLLOWER } from '../../lib/followType'

// ─── "Are we talking to the room, or to the street?" ───────────────────────
//
// Instagram's only follower/non-follower breakdown, and the answer to the
// question the reach tile above cannot give: of the people this account
// reached, how many already followed it.
//
// ── WHY THIS SITS UNDER REACH AND NOT UNDER ENGAGEMENT ──
//
// Because reach is the only metric Instagram will split this way. See the
// header of src/lib/followType.js — asking for the same breakdown on
// accounts_engaged, total_interactions, likes or comments is a 400. A split
// of engagement estimated from the reach ratio would be a number we made up,
// so the panel says what it does not have rather than approximating it.
//
// ── WHY BOTH SIDES START TICKED ──
//
// The panel's first job is to state the total and how it divides, and both
// sides ticked IS the total — so the number on the right matches the Reach
// tile above it on arrival. Unticking is the filter; arriving pre-filtered
// would make two tiles on the same screen disagree with no explanation.

const SIDES = [
  { key: FOLLOWER, label: 'Followers', hint: 'Already follow the account' },
  { key: NON_FOLLOWER, label: 'Non-followers', hint: 'Reached without following' },
]

export function ReachSplit({ payload, windowText = '' }) {
  const [sides, setSides] = useState(() => new Set([FOLLOWER, NON_FOLLOWER]))

  const split = splitReach(payload)
  const share = shareOf(split)
  const shown = reachFor(split, sides)
  const measured = typeof split.follower === 'number' || typeof split.nonFollower === 'number'

  function toggle(key) {
    setSides(prev => {
      const next = new Set(prev)
      // Unlike the metric toggles on the dashboard, emptying this one is
      // allowed and means something: "neither", which reads as a dash. It is
      // reachable in one click from either side and reversible in one more.
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  return (
    <div className="border-t border-border">
      <div className="px-5 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <IconBadge>{Icon.users}</IconBadge>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-text flex items-center gap-1.5">
              Who we reached
              <MetricInfoDot metric="ig.reach_follow_type" label="Who we reached" />
            </p>
            <p className="text-[11px] text-text-tertiary">
              Instagram splits reach this way and nothing else{windowText ? ` · ${windowText.toLowerCase()}` : ''}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {SIDES.map(s => {
            const on = sides.has(s.key)
            const value = s.key === FOLLOWER ? split.follower : split.nonFollower
            const pctValue = s.key === FOLLOWER ? share.follower : share.nonFollower
            return (
              <button key={s.key} onClick={() => toggle(s.key)} aria-pressed={on}
                title={s.hint}
                className={`text-xs font-medium px-2.5 py-1.5 border transition-colors flex items-center gap-1.5
                  ${on ? 'border-stone-400 bg-surface-subtle text-text' : 'border-border text-text-tertiary hover:text-text'}`}>
                <span className={`w-3 h-3 flex-shrink-0 border flex items-center justify-center
                  ${on ? 'bg-text border-text text-white' : 'border-border-strong'}`}>
                  {on && (
                    <svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="4">
                      <path d="m5 13 4 4L19 7" />
                    </svg>
                  )}
                </span>
                {s.label}
                {/* A side nobody measured says so rather than showing 0. */}
                <span className="tabular-nums text-text-tertiary">
                  {typeof value === 'number' ? fmt(value) : '—'}
                  {pctValue === null ? '' : ` · ${pct(pctValue)}`}
                </span>
              </button>
            )
          })}
        </div>

        <div className="text-right">
          <p className="text-xl font-bold text-text tabular-nums leading-none">
            {typeof shown === 'number' ? fmt(shown) : '—'}
          </p>
          <p className="text-[10px] text-text-tertiary mt-1">
            {sides.size === 2 ? 'people reached' : sides.size === 1 ? 'of those reached' : 'nothing selected'}
          </p>
        </div>
      </div>

      {split.error ? (
        <p className="px-5 pb-3 text-[11px] text-text-tertiary">
          Instagram did not report the split: {split.error}
        </p>
      ) : !measured ? (
        <p className="px-5 pb-3 text-[11px] text-text-tertiary">
          Instagram has not reported a follower split for this window — it fills once the account has
          reach to divide, and can lag up to 48 hours.
        </p>
      ) : null}
    </div>
  )
}
