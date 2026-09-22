// ─── Small planner surfaces ────────────────────────────────────────────────
// The "generate more ideas" prompt, the month overview, and the focus-category
// picker. None is large; all were sitting between the idea card and the
// 2,300-line page component, which is the only reason they were hard to find.

import { useState } from 'react'
import { Button, Input, Textarea, Modal, Spinner } from '../../components/ui/index'
import { buildCalendarCells } from './planModel'
import {
  WEEKDAYS, GOALS, listedCategories, customCategories, joinCategories, parseCategories,
} from './planConstants'

// ─── Focus categories — several, not one ───────────────────────────────────
//
// This was a <select>, so a month could only ever be about ONE thing. Real
// months are not: "brand awareness AND project showcase" is the ordinary case,
// and picking the second silently replaced the first, so half of what the
// month was for never reached the planning prompt.
//
// Tick boxes rather than a multi-<select> for the same reason the platform and
// metric pickers upstairs are: what is on and what is off IS the state, and a
// closed <select> reading "Brand awareness" cannot say that two others are
// also chosen. It also means no keyboard modifier to discover — a
// multiple-<select> needs ctrl-click, which nobody finds.
//
// `value` is the stored comma-joined string and `onChange` hands one back, so
// this component never sees the array. See planConstants for why the column
// stays a scalar.
export function FocusCategoryPicker({ value, onChange, label = 'Focus categories (optional)' }) {
  const picked = listedCategories(value)
  const custom = customCategories(value)
  // Open when there is already something typed, so a reopened plan whose focus
  // was written by hand does not come back looking like it had none.
  const [writing, setWriting] = useState(() => !!custom)

  // The typed part is rebuilt from the box every time, so unticking a chip can
  // never drop it and ticking one can never duplicate it.
  const commit = (nextPicked, nextCustom) =>
    onChange(joinCategories([...nextPicked, ...parseCategories(nextCustom)]))

  const toggle = (g) => commit(picked.includes(g) ? picked.filter(x => x !== g) : [...picked, g], custom)

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">{label}</label>
        {/* Nothing ticked is a real and common answer — a well-rounded month —
            so it is named rather than left as an empty row that reads broken. */}
        <span className="text-[11px] text-text-tertiary">
          {picked.length || custom
            ? `${picked.length + parseCategories(custom).length} chosen`
            : 'General — a well-rounded month'}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Focus categories">
        {GOALS.map(g => {
          const on = picked.includes(g)
          return (
            <button key={g} type="button" onClick={() => toggle(g)} aria-pressed={on}
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
              {g}
            </button>
          )
        })}

        <button type="button" onClick={() => setWriting(w => !w)} aria-pressed={writing}
          className={`text-xs font-medium px-2.5 py-1.5 border transition-colors
            ${writing ? 'border-stone-400 bg-surface-subtle text-text' : 'border-border text-text-tertiary hover:text-text'}`}>
          + Write my own
        </button>
      </div>

      {writing && (
        <Input
          placeholder="Name this month's focus — e.g. 'Smart poles for municipalities'"
          value={custom}
          onChange={e => commit(picked, e.target.value)}
          autoFocus />
      )}
    </div>
  )
}

// ─── "Generate more ideas" — AI top-up on an existing plan ─────────────────
// Reuses the same campaign-planner webhook as the initial generation, but
// also sends the ideas already in the plan so the workflow can avoid
// proposing duplicates. See onClose comment on why we don't just reopen the
// setup step: the plan already exists, we're appending to it, not restarting.
export function GenerateMoreModal({ defaultCount, loading, error, onClose, onGenerate }) {
  const [count, setCount] = useState(String(defaultCount))
  const [focus, setFocus] = useState('')

  return (
    <Modal open onClose={onClose} title="Generate more ideas" width="max-w-xl">
      <div className="p-6 space-y-4">
        <p className="text-xs text-text-secondary leading-relaxed">
          Adds more AI-proposed ideas on top of what's already here — useful after rejecting or deleting a few.
          The AI is shown your existing ideas so it won't repeat them.
        </p>
        <Input label="How many more?" type="number" min="1" max="20" value={count} onChange={e => setCount(e.target.value)} />
        <Textarea
          label="Extra focus for this batch (optional)"
          placeholder="Leave blank to keep filling out the month, or steer just this batch — e.g. 'More educational content this time.'"
          value={focus} onChange={e => setFocus(e.target.value)} rows={3}
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-3 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={() => onGenerate({ count: Number(count) || defaultCount, focus })} disabled={loading}>
            {loading ? <><Spinner size="sm" /> Generating…</> : 'Generate'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Month calendar overview ────────────────────────────────────────────────
// A navigation aid, not a second approve/reject surface: clicking a day just
// filters the existing card list to that day (see dayFilter in the main
// component) so all approve/edit/delete logic stays in one place (IdeaCard).
export function CalendarView({ ideas, startDate, endDate, selectedDay, onDayClick }) {
  const cells = buildCalendarCells(startDate, endDate)
  const byDate = new Map()
  ideas.forEach(i => {
    if (!i.date) return
    if (!byDate.has(i.date)) byDate.set(i.date, [])
    byDate.get(i.date).push(i)
  })
  const weeks = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  return (
    <div className="rounded-2xl border border-border bg-white overflow-hidden">
      <div className="grid grid-cols-7 border-b border-border bg-surface-subtle">
        {WEEKDAYS.map(d => (
          <div key={d.value} className={`px-2 py-2 text-[10px] font-bold text-center uppercase tracking-wide ${d.weekend ? 'text-amber-700' : 'text-text-tertiary'}`}>{d.label}</div>
        ))}
      </div>
      <div>
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 divide-x divide-border border-b border-border last:border-b-0">
            {week.map(cell => {
              const dayIdeas = byDate.get(cell.key) || []
              const isSelected = cell.key === selectedDay
              return (
                <button key={cell.key} onClick={() => dayIdeas.length && onDayClick(cell.key)}
                  disabled={!dayIdeas.length}
                  className={`min-h-[84px] p-1.5 text-left align-top transition-colors ${cell.inRange ? 'bg-white' : 'bg-stone-50/60'} ${isSelected ? 'ring-2 ring-inset ring-amber-400' : ''} ${dayIdeas.length ? 'hover:bg-amber-50/40 cursor-pointer' : 'cursor-default'}`}>
                  <div className="flex items-center justify-between">
                    <span className={`text-[11px] font-semibold ${cell.inRange ? 'text-text' : 'text-text-disabled'}`}>{cell.date.getDate()}</span>
                    {dayIdeas.some(i => i.occasion) && <span className="text-[10px]">★</span>}
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {dayIdeas.slice(0, 3).map(i => (
                      <div key={i.id} className={`text-[9px] px-1 py-0.5 rounded truncate border-l-2 ${i.status === 'approved' ? 'border-sage-400 bg-sage-50 text-sage-700' : i.status === 'rejected' ? 'border-red-300 bg-red-50 text-red-500 line-through' : 'border-stone-300 bg-stone-50 text-text-secondary'}`}>
                        {i.title || i.topic || 'Untitled'}
                      </div>
                    ))}
                    {dayIdeas.length > 3 && <div className="text-[9px] text-text-tertiary px-1">+{dayIdeas.length - 3} more</div>}
                  </div>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
