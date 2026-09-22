import { useState } from 'react'
import { PillSelect } from '../ui/index'
import {
  normalizeRange, resolveRange, rangeLabel, isCustom, todayIso, MAX_RANGE_DAYS,
} from '../../lib/dateRange'

// ─── One window picker, for every surface that shows a window ──────────────
//
// The dashboard, each account's Analytics tab and the Website tab each had
// their own <select> with the same three values in it, and no way to ask for
// a window that was not one of the three.
//
// ── WHY "CUSTOM" SEEDS ITSELF FROM WHERE YOU WERE ──
//
// Opening the custom fields empty makes the first thing you see two blank
// boxes and a chart that has not changed, and the obvious next move is to
// type a start date — at which point the range is half-specified and the
// picker has to decide what to do about it. Seeding both ends from the window
// already on screen means the custom window opens showing the SAME numbers,
// and every edit from there is a deliberate move away from a known place.
//
// ── WHY AN INVALID WINDOW DOES NOT REACH THE PAGE ──
//
// `onChange` is called only for a window that normalizeRange accepted. A
// half-typed date — and every date is half-typed for a moment, because a date
// input emits a change per keystroke in most browsers — would otherwise fire
// a request per character, and the ones with a year of "0002" are slow, wrong
// and confusing. The reason a window was refused is shown under the fields
// instead, in the same place for every surface.

export function RangePicker({
  value,
  onChange,
  presets = [7, 30, 90],
  minDays = 1,
  maxDays = MAX_RANGE_DAYS,
  disabled = false,
  className = '',
}) {
  const custom = isCustom(value)
  const [open, setOpen] = useState(custom)
  // The dates being typed, which are NOT the applied window — see above.
  const [draft, setDraft] = useState(() => {
    const { fromDate, toDate } = resolveRange(value)
    return { from: fromDate, to: toDate }
  })
  const [error, setError] = useState('')

  const today = todayIso()

  function pick(next) {
    if (next === 'custom') {
      // Seed from whatever is on screen now, so opening the fields changes
      // nothing until something is actually typed.
      const { fromDate, toDate } = resolveRange(value)
      setDraft({ from: fromDate, to: toDate })
      setError('')
      setOpen(true)
      return
    }
    setOpen(false)
    setError('')
    onChange({ days: Number(next) })
  }

  function edit(part, day) {
    const next = { ...draft, [part]: day }
    setDraft(next)
    const { range, error: why } = normalizeRange(next, { minDays, maxDays })
    setError(why || '')
    if (range) onChange(range)
  }

  const field = 'bg-white border border-border text-xs font-medium text-text-secondary px-2 py-1.5 ' +
    'hover:border-stone-400 hover:text-text transition-colors disabled:opacity-50'

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <PillSelect
        value={open || custom ? 'custom' : String(value?.days ?? presets[1] ?? presets[0])}
        onChange={e => pick(e.target.value)}
        className="w-36">
        {presets.map(d => <option key={d} value={String(d)}>Last {d} days</option>)}
        <option value="custom">Custom range…</option>
      </PillSelect>

      {(open || custom) && (
        <span className="flex flex-wrap items-center gap-1.5">
          <input type="date" value={draft.from} max={draft.to || today} disabled={disabled}
            onChange={e => edit('from', e.target.value)}
            aria-label="From" className={field} />
          <span className="text-xs text-text-tertiary">to</span>
          <input type="date" value={draft.to} min={draft.from} max={today} disabled={disabled}
            onChange={e => edit('to', e.target.value)}
            aria-label="To" className={field} />
        </span>
      )}

      {error
        ? <span className="text-[11px] text-red-600">{error}</span>
        : custom && <span className="text-[11px] text-text-tertiary">{rangeLabel(value)}</span>}
    </div>
  )
}
