import { useId, useState } from 'react'
import { Card, Button, Empty, Spinner, IconBadge } from '../../components/ui/index'
import { Icon } from '../../components/ui/icons'
import { fmt, pct, plural } from './format'
import { STATE_LABELS } from '../../lib/agent/urlInspection'

// ─── The three panels that say something in words ──────────────────────────
//
// Split out of Website.jsx rather than added to it, because that file is the
// tab's SHAPE — window picker, three states, tiles, charts — and these are
// three self-contained readings of data it already has. All three are pure
// functions of their props, like everything else on the tab: what they need
// fetching is fetched by useWebsiteAnalytics and handed down, which is what
// keeps /dev-website.html able to render the whole page with no network.
//
// What they have in common is that each one answers a question the numbers
// cannot. The surfaces panel can say image search earns nothing; only the
// image QUERIES can say it is because the photographs rank for other
// companies' buildings. The pages panel can say a page takes no impressions;
// only the index check can say Google has never fetched it.

/**
 * A button that will take a while, with the wait stated before it is pressed.
 *
 * ── WHY THE COST OR THE DURATION IS ON THE BUTTON ──
 *
 * One of these spends forty seconds and the other spends money. A control
 * that says only "Check" teaches people to press it and then wonder whether
 * the page has frozen — and, for the paid one, to press it three times. The
 * number goes on the control itself rather than in a tooltip, because it is
 * the thing you need before deciding, not after.
 */
function RunButton({ onClick, state, idle, busy, again }) {
  const loading = state === 'loading'
  return (
    <Button size="sm" variant="secondary" onClick={onClick} disabled={loading}>
      {loading ? <><Spinner size="sm" /> {busy}</> : (state === 'idle' ? idle : again)}
    </Button>
  )
}

function PanelHead({ title, subtitle, icon = Icon.activity, tone = 'steel', right }) {
  return (
    <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-3">
      <div className="flex items-start gap-2.5 min-w-0">
        <IconBadge tone={tone}>{icon}</IconBadge>
        <div className="min-w-0">
          <h3 className="font-semibold text-text text-sm leading-tight">{title}</h3>
          {subtitle && <p className="text-xs text-text-tertiary mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  )
}

// ─── What this month means, in three sentences ─────────────────────────────

const KIND = {
  good: { label: 'Working', classes: 'bg-sage-50 text-sage-700 border-sage-200' },
  problem: { label: 'Problem', classes: 'bg-red-50 text-red-600 border-red-200' },
  opportunity: { label: 'Opening', classes: 'bg-amber-50 text-amber-700 border-amber-200' },
  context: { label: 'Context', classes: 'bg-stone-100 text-stone-600 border-stone-300' },
}

/**
 * The points a model wrote, rendered exactly as short as they were asked to be.
 *
 * Its own component because the weekly research report shows the same thing,
 * from the same route, and two renderings of one answer would drift — one
 * would grow a heading, the other a truncation, and the same three sentences
 * would read differently in two places.
 */
export function ExplainPoints({ points = [] }) {
  return (
    <ul className="divide-y divide-border">
      {points.map((p, i) => {
        const kind = KIND[p.kind] || KIND.context
        return (
          <li key={i} className="px-5 py-3 flex items-start gap-2.5">
            <span className={`text-[10px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 border
              leading-[1.4] flex-shrink-0 mt-0.5 ${kind.classes}`}>{kind.label}</span>
            <p dir="auto" className="text-sm text-text leading-snug">{p.text}</p>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * The explanation panel, in its four states.
 *
 * Four and not two, and the fourth is the one worth naming: a workspace that
 * has hit its monthly cap gets told that in this panel, with the number, not
 * a generic failure — because everything else on the page still works and a
 * reader who cannot tell the difference will go looking for a broken
 * credential that is fine.
 */
export function ExplainPanel({ explain, onRun, canRun = true, audience = 'analytics' }) {
  const { state, points, error, cost, capped } = explain || {}

  return (
    <Card className="overflow-hidden">
      <PanelHead
        title="What this means"
        icon={Icon.message}
        tone="sage"
        subtitle={state === 'done' && points?.length
          ? `Written from the numbers on this page${cost ? ` · $${cost.toFixed(3)}` : ''}`
          : 'Three plain sentences, written on request — the only thing on this page that costs money'}
        right={canRun && (
          <RunButton onClick={onRun} state={state}
            idle="Explain" busy="Reading…" again="Again" />
        )}
      />

      {state === 'idle' && (
        <p className="px-5 py-4 text-xs text-text-tertiary leading-relaxed">
          The panels below are arithmetic: they say what happened. This says what it means, in three
          sentences, and costs about two cents each time it is asked.
        </p>
      )}

      {state === 'loading' && (
        <div className="px-5 py-5 flex items-center gap-2.5 text-xs text-text-tertiary">
          <Spinner size="sm" /> Reading {audience === 'research' ? 'the report' : 'this month'}…
        </div>
      )}

      {state === 'error' && (
        <div className="px-5 py-4">
          <p className={`text-xs leading-relaxed ${capped ? 'text-amber-700' : 'text-red-600'}`}>
            {capped ? 'This workspace has reached its monthly agent budget, so nothing was written. ' : ''}
            {error}
          </p>
          <p className="text-[11px] text-text-tertiary mt-2">
            Every number on this page was read from Google and is unaffected.
          </p>
        </div>
      )}

      {state === 'done' && (points?.length
        ? <ExplainPoints points={points} />
        : (
          <p className="px-5 py-4 text-xs text-text-tertiary">
            Nothing stood out this period. That is an answer, not a gap — at this volume most weeks
            genuinely have no story in them.
          </p>
        ))}
    </Card>
  )
}

// ─── Image search, in words ────────────────────────────────────────────────

/**
 * What image search is being asked for.
 *
 * The surfaces panel already says image search is a fifth of this property's
 * visibility and converts almost nothing. This says what the searches were,
 * which on the property it was built against turned out to be the entire
 * explanation: the photographs rank for the BUILDINGS, not for the lighting.
 */
export function ImageSearchPanel({ image }) {
  const [open, setOpen] = useState(false)
  const listId = useId()
  if (!image || !image.impressions) return null

  const shown = open ? image.queries : image.queries.slice(0, 5)
  const hidden = Math.max(0, image.queries.length - 5)
  const unrelated = image.unrelated || {}

  return (
    <Card className="overflow-hidden">
      <PanelHead title="What image search is looking for" icon={Icon.image} tone="sage"
        subtitle={`${plural(image.impressions, 'impression')} · ${plural(image.clicks, 'click')}`
          + ` · average position ${image.position === null ? '—' : image.position.toFixed(1)}`} />

      {image.queries.length === 0 ? (
        <p className="px-5 py-4 text-xs text-text-tertiary leading-relaxed">
          Google named none of the searches behind these impressions. It withholds rare queries, and on
          a surface this thin that can be all of them.
        </p>
      ) : (
        <>
          {/* Stated before the rows, because a reader who sees five queries
              adding to 70 under a total of 892 assumes the panel is broken. */}
          <p className="px-5 py-2.5 text-[11px] text-text-tertiary bg-surface-subtle border-b border-border leading-relaxed">
            Google names {fmt(image.namedQueries)} of these searches, holding {fmt(image.named)} of the{' '}
            {fmt(image.impressions)} impressions. The rest it will not attribute to any query.
            {unrelated.measurable && unrelated.impressions > 0 && (
              <> <strong className="font-semibold text-text-secondary">{pct(unrelated.share)} of the named
                impressions are searches for neither this company nor anything it sells</strong> — images
                ranking for what is IN the photograph rather than for the work.
              </>
            )}
          </p>
          <ul id={listId} className="divide-y divide-border">
            {shown.map(q => (
              <li key={q.query} className="px-5 py-2.5 flex items-baseline justify-between gap-3">
                <span className="min-w-0">
                  <span dir="auto" className="block truncate text-sm text-text">{q.query}</span>
                  {q.unrelated && unrelated.measurable && (
                    <span className="text-[9px] font-bold uppercase tracking-[0.08em] px-1 py-px mt-0.5 inline-block
                      bg-stone-100 text-stone-600 border border-stone-300 leading-[1.5]">Not about us</span>
                  )}
                </span>
                <span className="text-[11px] text-text-secondary tabular-nums flex-shrink-0">
                  {fmt(q.impressions)} · pos {q.position.toFixed(0)}
                </span>
              </li>
            ))}
          </ul>
          {hidden > 0 && (
            <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} aria-controls={listId}
              className="w-full px-5 py-2.5 border-t border-border text-xs font-semibold text-text-secondary
                hover:bg-surface-subtle transition-colors focus:outline-none focus-visible:bg-surface-subtle">
              {open ? 'Show fewer' : `Show ${hidden} more searches`}
            </button>
          )}
        </>
      )}

      {image.pages.length > 0 && (
        <div className="border-t border-border">
          <p className="px-5 pt-3 pb-1 eyebrow">Pages whose images are being shown</p>
          <ul className="divide-y divide-border">
            {image.pages.slice(0, 5).map(p => (
              <li key={p.path} className="px-5 py-2 flex items-baseline justify-between gap-3">
                <span dir="auto" className="text-xs text-text truncate">{p.label}</span>
                <span className="text-[11px] text-text-tertiary tabular-nums flex-shrink-0">
                  {fmt(p.impressions)} · pos {p.position.toFixed(0)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

// ─── Is Google actually holding these pages? ───────────────────────────────

const STATE_TONE = {
  indexed: 'text-sage-700',
  excluded: 'text-amber-700',
  unknown: 'text-red-600',
  other: 'text-text-secondary',
  error: 'text-red-600',
  unchecked: 'text-text-tertiary',
}

/** One line per URL that is not in the index, with Google's own words for why.
 *  `coverage` is quoted rather than paraphrased: "Discovered - currently not
 *  indexed" and "Crawled - currently not indexed" mean different things and
 *  the distinction is the whole value of the row. */
function MissingRows({ rows = [], more = 0 }) {
  return (
    <>
      <ul className="divide-y divide-border">
        {rows.map(r => (
          <li key={r.url} className="px-5 py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span dir="auto" className="text-xs text-text truncate font-mono">
                {r.url.replace(/^https?:\/\/[^/]+/, '') || '/'}
              </span>
              <span className={`text-[11px] flex-shrink-0 ${STATE_TONE[r.state] || ''}`}>
                {r.coverage || STATE_LABELS[r.state]}
              </span>
            </div>
            {r.impressions > 0 && (
              <p className="text-[10px] text-amber-700 mt-0.5 tabular-nums">
                Still took {plural(r.impressions, 'impression')} in this window
              </p>
            )}
          </li>
        ))}
      </ul>
      {more > 0 && (
        <p className="px-5 py-2 text-[11px] text-text-tertiary border-t border-border">
          and {more} more.
        </p>
      )}
    </>
  )
}

/**
 * Page-by-page index status, plus the two things that fall out of the same
 * calls: who links to the site, and what structured data Google sees.
 *
 * ── WHY THIS IS A BUTTON AND NOT A PANEL THAT LOADS ──
 *
 * It is one Google call per URL, about seven seconds each, up to 120 of them.
 * Ninety pages is forty seconds of waiting. Loading it with the tab would
 * make every visit to Analytics wait for an answer nobody asked for — the
 * exact bug this page already shipped once, when the channel picker fired
 * twenty-eight Google requests before it knew which tab was open.
 */
export function IndexHealthPanel({ index, onRun, canRun = true }) {
  const { state, data, error } = index || {}
  const health = data?.health
  const counts = health?.counts || {}
  const coverage = data?.coverage || {}

  return (
    <Card className="overflow-hidden">
      <PanelHead title="Is Google actually holding these pages?" icon={Icon.document}
        subtitle={state === 'done'
          ? `${plural(coverage.inspected || 0, 'page')} checked against Google's index`
          : 'Checks every page in the sitemap, one Google call each — about forty seconds'}
        right={canRun && (
          <RunButton onClick={onRun} state={state}
            idle="Check pages" busy="Checking…" again="Check again" />
        )} />

      {state === 'idle' && (
        <p className="px-5 py-4 text-xs text-text-tertiary leading-relaxed">
          A page Google has never fetched takes no impressions — and so does a page nobody searches for.
          Nothing else on this screen can tell those two apart.
        </p>
      )}

      {state === 'loading' && (
        <div className="px-5 py-5 flex items-center gap-2.5 text-xs text-text-tertiary">
          <Spinner size="sm" /> Asking Google about each page. This takes about forty seconds.
        </div>
      )}

      {state === 'error' && (
        <div className="p-5">
          <Empty icon={Icon.activity} title="The index check did not finish"
            description={error}
            action={<Button size="sm" variant="secondary" onClick={onRun}>Try again</Button>} />
        </div>
      )}

      {state === 'done' && health && (
        <>
          <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
            {[
              { key: 'indexed', label: 'In the index' },
              { key: 'excluded', label: 'Seen, not indexed' },
              { key: 'unknown', label: 'Never seen' },
            ].map(c => (
              <div key={c.key} className="p-4">
                <p className="eyebrow mb-1.5 truncate">{c.label}</p>
                <p className={`text-2xl font-bold leading-none tabular-nums ${STATE_TONE[c.key]}`}>
                  {fmt(counts[c.key] || 0)}
                </p>
              </div>
            ))}
          </div>

          {/* The sitemap the check read, and how many of its URLs were
              actually inspected. Without it, "52 indexed" is a number with no
              denominator — and a capped run would look like a small site. */}
          <p className="px-5 py-2.5 text-[11px] text-text-tertiary bg-surface-subtle border-b border-border leading-relaxed">
            {fmt(coverage.sitemap || 0)} URLs submitted in the sitemap
            {coverage.capped ? `, of which the first ${fmt(coverage.inspected)} were checked` : ''}.
            {data?.sitemap?.sources?.some(sm => !sm.ok) && ' One of the submitted sitemaps could not be read.'}
          </p>

          {health.missing.rows.length > 0 ? (
            <>
              <p className="px-5 pt-3 pb-1 eyebrow">Not in Google's index</p>
              <MissingRows rows={health.missing.rows} more={health.missing.more} />
            </>
          ) : (
            <p className="px-5 py-4 text-xs text-sage-700">
              Every page checked is in the index.
            </p>
          )}

          {health.canonical.rows.length > 0 && (
            <div className="border-t border-border">
              <p className="px-5 pt-3 pb-1 eyebrow">Google chose a different canonical</p>
              <ul className="divide-y divide-border">
                {health.canonical.rows.map(r => (
                  <li key={r.url} className="px-5 py-2.5 text-xs">
                    <span className="block truncate font-mono text-text">{r.url.replace(/^https?:\/\/[^/]+/, '')}</span>
                    <span className="block truncate text-[11px] text-text-tertiary mt-0.5">
                      indexed as {r.googleCanonical.replace(/^https?:\/\/[^/]+/, '')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {health.stale.rows.length > 0 && (
            <div className="border-t border-border">
              <p className="px-5 pt-3 pb-1 eyebrow">Google has not looked in months</p>
              <ul className="divide-y divide-border">
                {health.stale.rows.map(r => (
                  <li key={r.url} className="px-5 py-2.5 text-xs flex items-baseline justify-between gap-3">
                    <span className="truncate font-mono text-text">{r.url.replace(/^https?:\/\/[^/]+/, '')}</span>
                    <span className="text-[11px] text-text-tertiary flex-shrink-0 tabular-nums">
                      last crawled {r.lastCrawl.slice(0, 10)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-border border-t border-border">
            {/* Not a backlink tool and labelled so. `referringUrls` is a
                sample Google chose to show, not the link graph — but it is
                the only first-party answer there is, and on the property this
                was built against it was immediately worth having: three
                scraper sites and nothing else. */}
            <div className="p-5">
              <p className="eyebrow mb-2">Sites Google says link here</p>
              {health.referrers.length === 0 ? (
                <p className="text-xs text-text-tertiary leading-relaxed">
                  None, on the pages checked. Google shows a sample rather than the whole link graph, so this
                  is "nothing to show", not proof of zero.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {health.referrers.slice(0, 8).map(r => (
                    <li key={r.host} className="text-xs text-text flex items-baseline justify-between gap-3">
                      <span className="truncate">{r.host}</span>
                      <span className="text-[11px] text-text-tertiary flex-shrink-0 tabular-nums">
                        {plural(r.pages, 'page')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="p-5">
              <p className="eyebrow mb-2">Rich results Google detects</p>
              {health.richResults.length === 0 ? (
                <p className="text-xs text-text-tertiary leading-relaxed">
                  None on any page checked. Nothing is broken — there is simply no structured data on the site,
                  so results can never be more than a blue link.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {health.richResults.map(r => (
                    <li key={r.type} className="text-xs text-text flex items-baseline justify-between gap-3">
                      <span className="truncate">{r.type}</span>
                      <span className="text-[11px] text-text-tertiary flex-shrink-0 tabular-nums">
                        {plural(r.pages, 'page')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {health.failed.length > 0 && (
            <p className="px-5 py-2.5 text-[11px] text-amber-700 border-t border-border bg-amber-50">
              {plural(health.failed.length, 'page')} could not be checked: {health.failed[0].error}
            </p>
          )}
        </>
      )}
    </Card>
  )
}
