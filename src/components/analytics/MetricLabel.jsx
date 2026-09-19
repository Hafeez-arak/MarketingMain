import { InfoDot } from '../ui/index'
import { metricInfo } from '../../lib/analytics/metricInfo'

// ─── The two pieces every analytics number is wrapped in ───────────────────
// A label that can explain itself, and a banner that says which question the
// strip beneath it answers.
//
// Both exist so the explanation lives in ONE place. A tile that hard-codes its
// own tooltip text is a tile that will disagree with the table column showing
// the same metric the moment either is edited; here both read
// `src/lib/analytics/metricInfo.js` and cannot drift apart.

/**
 * The ⓘ for one metric, or nothing when the dictionary has no entry.
 *
 * Silent rather than loud on a missing key: see metricInfo()'s note. A tile
 * without an info dot still works; a tile that throws does not.
 */
export function MetricInfoDot({ metric, label, className = '' }) {
  const info = metricInfo(metric)
  if (!info) return null
  return <InfoDot label={label} what={info.what} note={info.note} className={className} />
}

/**
 * A metric's caption: optional icon, the label, and the ⓘ.
 *
 * `gap-1.5` between icon and text but `ml-0.5` before the dot, so the dot
 * reads as attached to the words rather than as a third item in a row of
 * three.
 *
 * `wrap` for the one place a caption is wider than its column — the metric
 * legend beside "Engagement over time", whose cells are about 100px. Truncating
 * there turned "Post eng. rate" into "Post eng. r…", which hides the very word
 * that distinguishes it from the platform's own rate. A label that has to
 * choose between wrapping and hiding its distinguishing word should wrap.
 */
export function MetricLabel({ metric, label, icon, wrap = false, className = '' }) {
  return (
    <p className={`text-xs text-text-tertiary flex gap-1.5 ${wrap ? 'items-start' : 'items-center'} ${className}`}>
      {icon && <span className="text-text-tertiary flex-shrink-0">{icon}</span>}
      <span className={wrap ? '' : 'truncate'}>
        {label}
        {wrap && <MetricInfoDot metric={metric} label={label} className="ml-1" />}
      </span>
      {!wrap && <MetricInfoDot metric={metric} label={label} className="ml-0.5" />}
    </p>
  )
}

/**
 * The band above a strip of numbers, naming what the strip measures.
 *
 * ── WHY THIS IS THE MAIN FIX ──
 * The page showed two strips of five numbers with nothing between them, and a
 * reader had no way to know the first was the platform's account-wide figures
 * and the second was per-post numbers added up. Same words, different
 * measurements, stacked — so "reach 10" sat above "total reach 16" and read as
 * a contradiction instead of as two answers to two questions.
 *
 * The footnotes under each strip already said some of this, but a caption in
 * 11px grey UNDER a number is read after the number has already confused you.
 * The scope has to arrive first, which is the whole reason this is a header.
 */
export function ScopeBanner({ title, subtitle, right }) {
  return (
    <div className="px-5 py-2.5 bg-surface-subtle border-b border-border flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
      <span className="text-xs font-semibold text-text">{title}</span>
      {subtitle && <span className="text-[11px] text-text-tertiary flex-1 min-w-0">{subtitle}</span>}
      {right && <span className="text-[11px] text-text-tertiary font-medium tabular-nums flex-shrink-0">{right}</span>}
    </div>
  )
}
