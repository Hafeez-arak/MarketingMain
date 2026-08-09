import { Fragment } from 'react'

// Small presentational pieces the Analytics page composes into Zernio-style
// widgets. Split out only because index.jsx already carries the data
// wrangling for ~10 sections — keeping the purely-visual bits here keeps
// that file about what data feeds what, not how a heatmap cell is shaded.

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
