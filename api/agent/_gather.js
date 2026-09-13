import { db } from './_supabase.js'
import {
  discoveryFields, metricsFor, caveatsFor, gatherReport, emptyReport,
  looksLikeCredentialsFailure, credentialsNote,
} from '../../src/lib/agent/gather.js'
import { tokenHealth, worthSurfacing } from '../../src/lib/agent/tokenHealth.js'
import { ownChannels, priorPeriod } from '../../src/lib/agent/ownChannels.js'

// ─── Stage 0, the IO half ──────────────────────────────────────────────────
// Ported from the n8n Gather node. The arithmetic lives in
// src/lib/agent/gather.js and is tested without a network; this file fetches,
// writes, and nothing else.
//
// This stage commits BEFORE a single model token is spent. Everything after it
// is a bonus: if the key is missing, the model is unreachable or the brief will
// not parse, the run still completes with the board plus a note saying what
// was lost. A failed investigation must never cost the user their numbers.

const GRAPH = 'https://graph.facebook.com/v23.0'

const TOKEN = () => process.env.META_IG_TOKEN || ''
const IG_USER = () => process.env.META_IG_USER_ID || ''

/**
 * Read one public Business/Creator account through business_discovery.
 *
 * Never throws. A rival we cannot read is a rival that appears on web evidence
 * alone, which the report is required to say on their card — losing the whole
 * run because one account went private would be the wrong trade entirely.
 */
export async function discover(handle) {
  const fields = discoveryFields(handle)
  const url = `${GRAPH}/${IG_USER()}?fields=${encodeURIComponent(fields)}` +
    `&access_token=${encodeURIComponent(TOKEN())}`
  try {
    const res = await fetch(url)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, error: String(body?.error?.message || `HTTP ${res.status}`).slice(0, 200) }
    }
    if (!body?.business_discovery) return { ok: false, error: 'no business_discovery payload' }
    return { ok: true, acct: body.business_discovery }
  } catch (err) {
    return { ok: false, error: String(err?.message || err).slice(0, 200) }
  }
}

/**
 * Ask Meta how long this token has left.
 *
 * Cheap, and it answers a question nothing else can: data access lapses ~90
 * days after authorisation and the token keeps reporting itself valid, so the
 * only warning available is this one — asked for deliberately, ahead of time.
 */
export async function checkTokenHealth() {
  if (!TOKEN() || !IG_USER()) return tokenHealth(null)
  try {
    const res = await fetch(
      `${GRAPH}/debug_token?input_token=${encodeURIComponent(TOKEN())}` +
      `&access_token=${encodeURIComponent(TOKEN())}`,
    )
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      return {
        status: 'invalid', ok: false,
        headline: `Meta refused to introspect the token: ${body?.error?.message || res.status}`,
        action: 'Check the app\'s status in the Meta dashboard.',
      }
    }
    return tokenHealth(body?.data)
  } catch (err) {
    // Not fatal and not reported as a token problem — a network blip is not a
    // credentials failure, and saying so would send someone to the wrong page.
    return { status: 'unknown', ok: true, headline: '', action: '', error: String(err?.message || err) }
  }
}

/**
 * Every social account this workspace has connected, on any platform.
 *
 * Deliberately unfiltered. The old read here ended in `platform=eq.instagram`,
 * which was the single line that made the whole agent Instagram-only: the
 * TikTok and LinkedIn rows were sitting in the same table the whole time and
 * nothing ever selected them.
 */
async function connectedAccounts(workspaceId) {
  return db(
    `social_accounts?workspace_id=eq.${workspaceId}&is_active=eq.true` +
    `&select=platform,username,followers_count,needs_reconnection,is_active&limit=50`,
  ).catch(() => [])
}

/**
 * How our own posts did, on every platform we publish to.
 *
 * This is the half of the run that needs no Meta credentials and no verified
 * competitor handle, which is exactly why it is its own function called on
 * every path through `gather`. A brand with no Graph token and no rivals
 * resolved should still be told how its own week went — that was previously
 * the one thing it could not get, because the two were tangled together.
 *
 * Never throws. Stage 0's contract is that the measured numbers survive
 * anything; a failure here returns an empty shape with the reason attached,
 * and the run carries on.
 */
export async function gatherOwnChannels(workspaceId, period) {
  const prior = priorPeriod(period)
  try {
    const accounts = await connectedAccounts(workspaceId)

    // Both windows in one read. `published_at` is the column that decides
    // which week a post belongs to, but it is null for anything that never
    // went out, so the window is widened by the fallback column rather than
    // filtered in SQL — postsIn() does the precise bucketing in code where it
    // is testable.
    const from = prior?.start || period?.start
    const posts = await db(
      `generated_posts?workspace_id=eq.${workspaceId}` +
      `&or=(published_at.gte.${from},scheduled_date.gte.${String(from).slice(0, 10)})` +
      `&select=id,platform,topic,format,media_type,post_kind,status,publish_status,` +
      `published_at,scheduled_date,platform_post_url&limit=500`,
    ).catch(() => [])

    // ── The frozen Instagram table ──
    //
    // Checked live on 2026-09-13: `generated_posts` holds ZERO rows, every one
    // of this company's 21 real posts is still in `instagram_generated_posts`,
    // and all 14 post_analytics rows point at that table. Reading only the new
    // table would report "we have never published anything" to a brand that
    // has — the exact kind of confident wrong number this agent is built to
    // avoid.
    //
    // Read-only and additive. Nothing writes here, the new table stays the
    // single write target, and the day the legacy rows are migrated or age out
    // of the window this simply returns nothing. The Zernio sync already reads
    // both tables for the same reason, so this is the established shape rather
    // than a new exception.
    //
    // The columns differ — it has no `platform`, `format` or `media_type`,
    // because it predates a world with more than one platform — so the rows
    // are normalised here into the shape ownChannels expects.
    const legacy = await db(
      `instagram_generated_posts?workspace_id=eq.${workspaceId}` +
      `&or=(published_at.gte.${from},scheduled_date.gte.${String(from).slice(0, 10)})` +
      `&select=id,topic,post_kind,status,publish_status,published_at,scheduled_date,platform_post_url&limit=500`,
    ).catch(() => [])

    const all = [
      ...(posts || []),
      ...(legacy || []).map(p => ({ ...p, platform: 'instagram', format: '', media_type: '' })),
    ]

    const ids = all.map(p => p.id).filter(Boolean)
    const analytics = ids.length
      ? await db(
          `post_analytics?workspace_id=eq.${workspaceId}&post_id=in.(${ids.join(',')})` +
          `&select=post_id,platform,metric_date,likes,comments,shares,saves,reach,views&limit=2000`,
        ).catch(() => [])
      : []

    return ownChannels({ accounts: accounts || [], posts: all, analytics: analytics || [], period, prior })
  } catch (err) {
    const empty = ownChannels({ accounts: [], posts: [], analytics: [], period, prior })
    return { ...empty, error: String(err?.message || err).slice(0, 200) }
  }
}

/**
 * Run stage 0 for one workspace and commit the result.
 *
 * @param {string} workspaceId  VERIFIED
 * @param {string} runId        the claimed run
 * @param {object} period       from periodFor()
 */
export async function gather(workspaceId, runId, period) {
  // First, and outside every early return below. Our own numbers do not depend
  // on Meta credentials or on any rival being resolved, so they must not be
  // lost when either of those is missing.
  const own = await gatherOwnChannels(workspaceId, period)
  if (!TOKEN() || !IG_USER()) {
    // Named rather than swallowed, and NOT fatal to the run row — the caller
    // decides. A brand with no Meta credentials can still get market research
    // AND its own per-platform numbers; it just cannot get measured
    // COMPETITOR numbers, because business_discovery is the only source of
    // those and it is Meta's.
    const report = emptyReport(period, own)
    await patchRun(workspaceId, runId, { stage: 'investigate', report }).catch(() => {})
    return {
      ok: false,
      error: 'META_IG_TOKEN / META_IG_USER_ID are not set on this deployment, so no competitor numbers could be measured.',
      report,
      own_performance: own,
      snapshots: 0, measured: 0, failed: 0,
    }
  }

  // Only VERIFIED handles. This filter is the whole reason the resolve step
  // stores weak candidates separately, and reading ig_handle without checking
  // ig_status is precisely how a guess would reach the numbers. Two similarly
  // named companies in one workspace, and a confident week of figures attached
  // to the wrong one is the kind of wrong that does not look wrong.
  // `status=eq.active`, not `neq.retired`. Those differ on exactly one value —
  // 'proposed' — and that value is the whole point of the approval gate.
  //
  // It read `neq.retired` when every competitor row was human-typed and
  // therefore active, so the two filters agreed by accident. They stopped
  // agreeing the moment the discover step could propose a rival: a company the
  // agent found, that nobody had accepted, would have been measured and
  // reported as a tracked competitor on the strength of its own suggestion.
  // The standing-questions read has always required 'active'; this now matches
  // it, so one rule governs the whole watchlist.
  const watch = await db(
    `research_agenda?workspace_id=eq.${workspaceId}&kind=eq.competitor` +
    `&status=eq.active&ig_status=in.(resolved,human_set)` +
    `&select=id,subject,ig_handle&limit=100`,
  )

  // Our own account, so every comparison is against us rather than against an
  // average of rivals.
  const selfRows = await db(
    `social_accounts?workspace_id=eq.${workspaceId}&platform=eq.instagram` +
    `&is_active=eq.true&select=username&limit=1`,
  ).catch(() => [])
  const selfHandle = selfRows?.[0]?.username || ''

  const targets = [
    ...(watch || []).map(w => ({ agenda_id: w.id, name: w.subject, handle: w.ig_handle, is_self: false })),
    ...(selfHandle ? [{ agenda_id: null, name: 'Us', handle: selfHandle, is_self: true }] : []),
  ]

  if (!targets.length) {
    // Not a dead end. Market and trend research needs no rival at all, and a
    // brand with nothing verified yet is exactly the one that needs it most —
    // so this carries on to the investigation stages with an empty board.
    const report = emptyReport(period, own)
    await patchRun(workspaceId, runId, { stage: 'investigate', report })
    return {
      ok: true, report, own_performance: own, snapshots: 0, measured: 0, failed: 0,
      note: 'No verified handles to measure. Run handle resolution first.',
    }
  }

  // Sequential. A dozen accounts is not worth a concurrency bug, and a
  // rate-limited Graph answering 429 to half of them would silently narrow the
  // board without saying so.
  const rows = []
  const failures = []
  const caveats = []
  const capturedAt = new Date().toISOString()

  for (const t of targets) {
    const got = await discover(t.handle)
    if (!got.ok) {
      failures.push({ name: t.name, handle: t.handle, error: got.error })
      rows.push({
        run_id: runId, workspace_id: workspaceId, agenda_id: t.agenda_id,
        competitor_name: t.name, ig_handle: t.handle, is_self: t.is_self,
        data_source: 'web_only', captured_at: capturedAt,
      })
      continue
    }
    const a = got.acct
    const followers = Number(a.followers_count) || 0
    const m = metricsFor(a?.media?.data || [], followers, period)
    caveats.push(...caveatsFor(t.name, m))
    rows.push({
      run_id: runId, workspace_id: workspaceId, agenda_id: t.agenda_id,
      competitor_name: t.name, ig_handle: a.username || t.handle, is_self: t.is_self,
      data_source: 'instagram',
      followers,
      follows: Number(a.follows_count) || null,
      media_count: Number(a.media_count) || null,
      posts_in_period: m.posts_in_period,
      posts_per_week: m.posts_per_week,
      format_mix: m.format_mix,
      avg_engagement: m.avg_engagement,
      engagement_per_1k: m.engagement_per_1k,
      top_posts: m.top_posts,
      post_hours: m.post_hours,
      sample_size: m.sample_size,
      captured_at: capturedAt,
    })
  }

  for (const row of rows) {
    // One at a time so a single bad row cannot lose the whole batch. The
    // unique index on (run_id, lower(competitor_name)) means a retried stage
    // cannot double a week and quietly halve every average.
    await db('competitor_snapshots', { method: 'POST', body: row, prefer: 'return=minimal' })
      .catch(err => console.error(`[agent/gather] snapshot for ${row.competitor_name}:`, err.message))
  }

  // The PREVIOUS snapshots, so a delta is a subtraction over two stored rows.
  // This is why competitor_snapshots exists at all: without a stored prior
  // row, "their posting went 3 to 7 a week" would be a model recalling
  // something it never saw.
  const prior = await db(
    `competitor_snapshots?workspace_id=eq.${workspaceId}&run_id=neq.${runId}` +
    `&data_source=eq.instagram&select=competitor_name,captured_at,followers,posts_per_week,` +
    `engagement_per_1k,format_mix&order=captured_at.desc&limit=500`,
  )

  // A credentials failure is not a competitor failure, and the two are
  // indistinguishable in a per-rival list. Said first, and said plainly.
  const credentialsProblem = looksLikeCredentialsFailure(failures, targets.length)

  // Asked once per run. The deadline that matters is the one nothing else will
  // announce: when data access lapses, these reads start returning nothing
  // while the token still calls itself valid.
  const health = await checkTokenHealth()
  if (worthSurfacing(health) && health.headline) {
    caveats.push(`${health.headline}${health.action ? ` ${health.action}` : ''}`)
  }
  const report = gatherReport({
    snapshots: rows,
    prior: prior || [],
    period,
    failures,
    caveats: credentialsProblem ? [credentialsNote(failures), ...caveats] : caveats,
    own,
  })
  if (credentialsProblem) report.credentials_problem = true

  // Deliberately NOT 'complete': the investigation stages run after this and
  // own the terminal write. The partial report is stored anyway, so a run that
  // dies during investigation still leaves a readable competitor board behind
  // rather than nothing at all.
  await patchRun(workspaceId, runId, { stage: 'investigate', report })

  if (credentialsProblem) {
    // Otherwise the headline reads "First measurement of 2 competitors", which
    // is actively misleading when zero of them were measured. Our own channels
    // are unaffected by a Graph refusal on TikTok and LinkedIn, so the headline
    // says what was lost rather than implying the whole run was.
    report.headline = own?.measured_count
      ? `Instagram refused every competitor request, but our own ${own.measured_count} measured channel${own.measured_count === 1 ? '' : 's'} still reported.`
      : 'Nothing could be measured — Instagram refused every request.'
  }

  return {
    ok: true,
    report,
    own_performance: own,
    credentials_problem: credentialsProblem,
    token_health: health,
    snapshots: rows.length,
    measured: rows.filter(r => r.data_source === 'instagram').length,
    failed: failures.length,
  }
}

/** Patch a run row, always scoped by workspace as well as by id. */
export async function patchRun(workspaceId, runId, patch) {
  return db(
    `research_runs?id=eq.${encodeURIComponent(runId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}`,
    { method: 'PATCH', body: patch, prefer: 'return=minimal' },
  )
}
