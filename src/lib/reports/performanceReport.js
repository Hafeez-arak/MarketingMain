// ─── The performance report, as data ───────────────────────────────────────
// Pure. Turns the /api/agent/performance payload into the handful of strings
// the report prints, so every decision about what a null means is testable
// without a browser and identical wherever it is rendered.
//
// ── THE RULE EVERY FUNCTION HERE OBEYS ──
//
// `null` is not zero. The route below it is careful about this — engagementOf
// returns null for a post whose analytics row exists but is empty, ownChannels
// carries `measured` alongside `posts` everywhere, changeFor refuses to
// compute a trend from one post against one post — and all of that care is
// undone by one formatter that prints `0` for a missing number. A report that
// says "average engagement: 0" about a month nobody measured is worse than a
// blank, because a blank prompts a question and a zero ends one.
//
// So: a missing number prints as "—", and the caveats block says why.

/** The period in words, for the masthead. */
export function periodLabel(period) {
  const start = Date.parse(period?.start || '')
  const end = Date.parse(period?.end || '')
  if (!Number.isFinite(start) || !Number.isFinite(end)) return ''
  const day = { day: 'numeric', month: 'short' }
  const full = { day: 'numeric', month: 'short', year: 'numeric' }
  return `${new Date(start).toLocaleDateString('en-GB', day)} – ${new Date(end).toLocaleDateString('en-GB', full)}`
}

/**
 * Is this a number we actually have?
 *
 * The empty string is the trap, and it is not hypothetical: `Number('') === 0`
 * and `Number.isFinite(0)` is true, so a missing value that arrives as '' —
 * which is exactly how Postgres text columns and blank form fields reach the
 * browser — formats as a confident `0`. That is the one failure this whole
 * module exists to prevent, arriving through the front door.
 */
function known(n) {
  if (n === null || n === undefined || n === '') return false
  return Number.isFinite(Number(n))
}

/** A whole number a person can read at a glance. 41200 -> "41.2k". */
export function big(n) {
  if (!known(n)) return '—'
  const v = Number(n)
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}m`
  if (Math.abs(v) >= 10_000) return `${(v / 1_000).toFixed(1)}k`
  return Math.round(v).toLocaleString('en-US')
}

/**
 * An average, to one decimal only where the decimal carries information.
 *
 * NOT `big`. Arak's measured posts sit in single digits of engagement today —
 * two posts averaging 3.5 and 4.4 interactions both round to "4", and a
 * channel comparison where every row reads 4 is a table that has quietly
 * stopped saying anything. Above 100 the decimal is noise and is dropped.
 */
export function avg(n) {
  if (!known(n)) return '—'
  const v = Number(n)
  if (Math.abs(v) >= 100) return Math.round(v).toLocaleString('en-US')
  return (Math.round(v * 10) / 10).toString()
}

/** A change, with its direction as a word rather than only a colour. */
export function changeLabel(change) {
  if (!change) return '—'
  const arrow = change.direction === 'up' ? '▲' : '▼'
  return `${arrow} ${Math.round(change.change_pct)}%`
}

const STATE_WORD = {
  measured: 'Measured',
  unmeasured: 'No analytics yet',
  silent: 'Nothing published',
  not_connected: 'Not connected',
}

/** How a channel's state reads in the table's status column. */
export function stateWord(state) {
  return STATE_WORD[state] || state || ''
}

/**
 * The channel rows, ordered so the ones carrying a conclusion come first.
 *
 * A not-connected channel is KEPT rather than filtered away — a dark channel
 * is a marketing fact, and the report's readers are exactly the people who can
 * decide to light it. It sorts last because it is the only row with nothing to
 * read, not because it does not matter.
 */
export function channelRows(payload) {
  const rank = { measured: 0, unmeasured: 1, silent: 2, not_connected: 3 }
  return [...(payload?.own?.platforms || [])].sort(
    (a, b) => (rank[a.state] ?? 9) - (rank[b.state] ?? 9)
      || (b.avg_engagement ?? -1) - (a.avg_engagement ?? -1),
  )
}

/** The best-performing channel of the period, or null when none was measured. */
export function strongestChannel(payload) {
  const measured = (payload?.own?.platforms || []).filter(
    p => p.state === 'measured' && p.avg_engagement !== null && p.avg_engagement !== undefined,
  )
  if (!measured.length) return null
  return measured.reduce((best, p) => (p.avg_engagement > best.avg_engagement ? p : best))
}

/**
 * The one sentence at the top, assembled from what is actually known.
 *
 * Built in clauses rather than from a template with holes, because the honest
 * sentence for a workspace with nothing connected and the honest sentence for
 * one with four measured channels are different sentences, not the same
 * sentence with different numbers in it.
 */
export function headline(payload) {
  const t = payload?.totals || {}
  const own = payload?.own || {}

  if (!t.connected_count) {
    return 'No social account is connected to this workspace, so none of our own performance can be measured yet.'
  }
  if (!t.posts) {
    const channels = `${t.connected_count} connected channel${t.connected_count === 1 ? '' : 's'}`
    return `Nothing was published to ${channels} in this period, so there is no performance to report on — only the silence itself.`
  }
  if (!t.measured) {
    return `${t.posts} post${t.posts === 1 ? '' : 's'} went out, but none has analytics synced yet, so no engagement conclusion is available.`
  }

  const best = strongestChannel(payload)
  const measuredClause = t.measured === t.posts
    ? `all ${t.posts}`
    : `${t.measured} of ${t.posts}`
  const bestClause = best
    ? ` ${best.label} is the strongest channel at ${avg(best.avg_engagement)} per post.`
    : ''

  return `${t.posts} post${t.posts === 1 ? '' : 's'} went out across ${own.connected_count} connected ` +
    `channel${own.connected_count === 1 ? '' : 's'}; ${measuredClause} could be measured, averaging ` +
    `${avg(t.avg_engagement)} interactions each.${bestClause}`
}

/** The four numbers in the band. Strings, so each owns its own empty case. */
export function summaryStats(payload) {
  const t = payload?.totals || {}
  return [
    {
      label: 'Followers',
      value: big(t.followers),
      hint: `across ${t.connected_count || 0} connected channel${t.connected_count === 1 ? '' : 's'}`,
    },
    {
      label: 'Posts published',
      value: t.posts ? String(t.posts) : '0',
      hint: t.posts ? `${t.measured} with analytics` : 'in this period',
    },
    {
      label: 'Total interactions',
      value: big(t.total_engagement),
      hint: 'likes, comments, shares, saves',
    },
    {
      label: 'Average per post',
      value: avg(t.avg_engagement),
      hint: t.measured ? `over ${t.measured} measured post${t.measured === 1 ? '' : 's'}` : 'nothing measured yet',
    },
  ]
}

/**
 * Page-level totals, for the channels that report them.
 *
 * ── WHY THIS IS ITS OWN SECTION AND NOT A COLUMN ──
 *
 * These are a different measurement from everything in the channel table, and
 * merging them would be the report's worst possible error. The table counts
 * interactions on posts WE published; this counts everything the page did —
 * every post on it including ones made by hand, its impressions, the people
 * who reached it, the followers it gained. On 15 Sep 2026 ARAK's LinkedIn row
 * reads "1 post, 17 interactions" and its page reads 2,433 impressions and 52
 * new followers over the same 30 days. Both are true. A reader shown only the
 * first would conclude LinkedIn is doing nothing, which is the opposite of
 * what happened, and LinkedIn is this brand's strongest channel.
 *
 * Returns one entry per channel that has them, or an empty array.
 */
export function pageInsightRows(payload) {
  return (payload?.own?.platforms || [])
    .filter(p => p.page_insights?.ok)
    .map(p => ({
      platform: p.platform,
      label: p.label,
      name: p.page_insights.name || p.username || '',
      insights: p.page_insights,
      stats: [
        { label: 'Impressions', value: big(p.page_insights.impressions) },
        { label: 'People reached', value: big(p.page_insights.members_reached) },
        { label: 'Reactions', value: big(p.page_insights.reactions) },
        { label: 'Clicks', value: big(p.page_insights.clicks) },
        { label: 'Comments', value: big(p.page_insights.comments) },
        { label: 'New followers', value: big(p.page_insights.followers_gained_organic) },
        {
          label: 'Engagement rate',
          value: known(p.page_insights.engagement_rate_pct)
            ? `${avg(p.page_insights.engagement_rate_pct)}%`
            : '—',
        },
        { label: 'Page views', value: big(p.page_insights.page_views?.total) },
      ],
    }))
}

/** Below this many measured posts, an average is quoted but flagged. */
const WEAK_SAMPLE = 5

/**
 * Everything that qualifies a number above, in the order it matters.
 *
 * Deduplicated and capped: eight caveats read as a broken product, and the
 * two that matter get lost among the six that are the same sentence about
 * four platforms.
 */
export function caveats(payload, { limit = 6 } = {}) {
  const out = []
  const own = payload?.own || {}
  const t = payload?.totals || {}

  if (own.note) out.push(own.note)

  const weak = (own.platforms || []).filter(p => p.state === 'measured' && p.measured < WEAK_SAMPLE)
  if (weak.length) {
    out.push(
      `${weak.map(p => p.label).join(', ')} ${weak.length === 1 ? 'has' : 'have'} fewer than ` +
      `${WEAK_SAMPLE} measured posts in this period. The averages are exact, but a handful of ` +
      'posts is a thin basis for a conclusion about what works.',
    )
  }

  const unmeasured = (own.platforms || []).filter(p => p.state === 'unmeasured')
  if (unmeasured.length) {
    out.push(
      `${unmeasured.map(p => p.label).join(', ')}: posts went out but no analytics have synced. ` +
      'Zernio refreshes at most every 90 minutes and platform reach can lag by up to 48 hours.',
    )
  }

  const stale = (own.platforms || []).filter(p => p.needs_reconnection)
  if (stale.length) {
    out.push(
      `${stale.map(p => p.label).join(', ')} ${stale.length === 1 ? 'needs' : 'need'} reconnecting — ` +
      'until then no new numbers arrive for that channel, so its figures here may be frozen.',
    )
  }

  const undated = (own.platforms || []).filter(p => p.undated > 0)
  if (undated.length) {
    const n = undated.reduce((sum, p) => sum + p.undated, 0)
    out.push(
      `${n} post${n === 1 ? ' is' : 's are'} mid-publish — accepted by Zernio but not yet stamped ` +
      'with a publish time, so they sit in no period and are counted nowhere above.',
    )
  }

  const noChange = (own.platforms || []).some(p => p.state === 'measured' && !p.change)
  if (noChange && t.measured) {
    out.push(
      'A "vs previous" figure is left blank wherever either period has fewer than two measured ' +
      'posts, or the difference is under 15%. One post against one post is not a trend.',
    )
  }

  // The page-level delay, carried from the provider rather than invented here.
  for (const row of pageInsightRows(payload)) {
    if (row.insights.data_delay) out.push(`${row.label} page: ${row.insights.data_delay}`)
  }

  if (payload?.zernio_note) out.push(payload.zernio_note)

  return [...new Set(out)].slice(0, limit)
}

/**
 * Ask the server how our own posts did.
 *
 * Through /api/agent/performance rather than Supabase directly: posts made
 * straight on a platform and the LinkedIn page's own totals live behind
 * ZERNIO_API_KEY, which is a deployment secret. See the route's header.
 */
export async function fetchPerformanceReport({ workspaceId, accessToken, periodDays = 30 }) {
  if (!workspaceId) return { ok: false, error: 'No workspace selected.' }
  try {
    const url = `/api/agent/performance?workspace_id=${encodeURIComponent(workspaceId)}` +
      `&period_days=${encodeURIComponent(periodDays)}`
    const res = await fetch(url, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: body?.error || `The report could not be built (${res.status}).` }
    return body
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
}
