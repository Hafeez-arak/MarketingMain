import { Fragment } from 'react'

// Small presentational pieces the Analytics page composes into Zernio-style
// widgets. Split out only because index.jsx already carries the data
// wrangling for ~10 sections — keeping the purely-visual bits here keeps
// that file about what data feeds what, not how a heatmap cell is shaded.

// Small circular icon badge that sits in front of a chart title — the
// visual anchor that made Zernio's own dashboard read as a set of distinct
// widgets instead of one long undifferentiated scroll of charts.
const BADGE_TONES = {
  steel: 'bg-amber-50 text-amber-600',
  sage:  'bg-sage-50 text-sage-600',
  rose:  'bg-rose-50 text-rose-500',
}
export function IconBadge({ children, tone = 'steel' }) {
  return (
    <span className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${BADGE_TONES[tone] || BADGE_TONES.steel}`}>
      {children}
    </span>
  )
}

// Compact pill dropdown — a native <select> for real accessibility/keyboard
// behavior, styled to read as a small filter chip (Zernio's "Likes ▾" /
// "Last 30 days ▾" controls) instead of a full-height form field.
export function PillSelect({ value, onChange, className = '', children }) {
  return (
    <div className={`relative inline-flex ${className}`}>
      <select value={value} onChange={onChange}
        className="appearance-none w-full bg-white border border-border rounded-full text-xs font-medium text-text-secondary pl-3 pr-7 py-1.5 cursor-pointer hover:border-stone-300 hover:text-text transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400">
        {children}
      </select>
      <svg className="w-3 h-3 absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
    </div>
  )
}

// Tiny 14px stroke icons, same convention as the rest of the app (inline
// SVG, currentColor, strokeWidth 1.75) — kept together so each chart
// section can grab one by name instead of inlining a <svg> block per use.
const p = 'w-3.5 h-3.5'
export const Icon = {
  document:   <svg className={p} fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>,
  heart:      <svg className={p} fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"/></svg>,
  message:    <svg className={p} fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>,
  trending:   <svg className={p} fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
  clock:      <svg className={p} fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  grid:       <svg className={p} fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  trophy:     <svg className={p} fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M17 5h3a2 2 0 0 1-2 4M7 5H4a2 2 0 0 0 2 4"/></svg>,
  activity:   <svg className={p} fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
  eye:        <svg className={p} fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg>,
  users:      <svg className={p} fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const HOUR_COLS = [0, 3, 6, 9, 12, 15, 18, 21]

// Zernio's `day_of_week` is 0-indexed starting Monday (0=Mon .. 6=Sun) —
// confirmed by cross-checking a real slot against their own dashboard
// screenshot (day_of_week: 6 rendered as the "Sun" row there).
export function BestTimeHeatmap({ slots }) {
  const grid = new Map() // `${day}-${hour}` -> avg_engagement
  let max = 0
  for (const s of slots || []) {
    grid.set(`${s.day_of_week}-${s.hour}`, s.avg_engagement)
    if (s.avg_engagement > max) max = s.avg_engagement
  }
  const best = [...(slots || [])].sort((a, b) => b.avg_engagement - a.avg_engagement)[0]

  const shade = v => {
    if (!v) return 'bg-surface-muted'
    const t = max ? v / max : 0
    if (t > 0.8) return 'bg-sage-600'
    if (t > 0.55) return 'bg-sage-500'
    if (t > 0.3) return 'bg-sage-300'
    return 'bg-sage-100'
  }

  if (!slots || slots.length === 0) {
    return <p className="text-sm text-text-tertiary py-8 text-center">Not enough posting history yet to find a pattern.</p>
  }

  return (
    <div>
      <div className="flex items-center justify-end gap-1.5 mb-2 text-[10px] text-text-tertiary">
        <span>Less</span>
        {['bg-surface-muted', 'bg-sage-100', 'bg-sage-300', 'bg-sage-500', 'bg-sage-600'].map((c, i) => (
          <span key={i} className={`w-3 h-3 rounded-sm ${c}`} />
        ))}
        <span>More</span>
      </div>
      <div className="grid" style={{ gridTemplateColumns: '32px repeat(24, 1fr)' }}>
        <div />
        {Array.from({ length: 24 }).map((_, h) => (
          <div key={h} className="text-[9px] text-text-tertiary text-center">
            {HOUR_COLS.includes(h) ? (h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`) : ''}
          </div>
        ))}
        {DAY_LABELS.map((day, di) => (
          <Fragment key={day}>
            <div className="text-[10px] text-text-tertiary flex items-center">{day}</div>
            {Array.from({ length: 24 }).map((_, h) => (
              <div key={`${day}-${h}`} className={`aspect-square rounded-sm m-[1px] ${shade(grid.get(`${di}-${h}`))}`}
                title={grid.get(`${di}-${h}`) ? `${day} ${h}:00 — avg engagement ${grid.get(`${di}-${h}`).toFixed(2)}` : ''} />
            ))}
          </Fragment>
        ))}
      </div>
      {best && (
        <p className="text-xs text-text-secondary mt-3">
          Best time: <span className="font-semibold text-sage-700">{DAY_LABELS[best.day_of_week]} {best.hour === 0 ? '12am' : best.hour < 12 ? `${best.hour}am` : best.hour === 12 ? '12pm' : `${best.hour - 12}pm`}</span>
          <span className="text-text-tertiary"> · avg engagement {best.avg_engagement.toFixed(1)} across {best.post_count} post{best.post_count !== 1 ? 's' : ''}</span>
        </p>
      )}
    </div>
  )
}
