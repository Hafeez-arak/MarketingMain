import { PLATFORM_META } from '../utils.js'

// ─── What a post critique is allowed to claim ──────────────────────────────
//
// "Can the AI analyse why this post would get more interaction?" — yes, and
// the hard part is not the analysis. It is being honest about what the answer
// rests on.
//
// On 2026-09-22 this workspace had 15 posts with any analytics at all, every
// one of them Instagram, and every one belonging to @lightingaaa — a
// one-follower test account. `generated_posts` had zero published rows. A
// model asked to "predict engagement" against that would produce a number, the
// number would be fiction, and it would sit on screen next to real measured
// analytics looking exactly as solid.
//
// So there is no score and no predicted figure anywhere in this feature. What
// it gives is a critique: what works, what to change, in what order, and why.
// That is worth having on day one and gets strictly better as real history
// arrives — WITHOUT the prompt changing, because the prompt already asks for
// judgement and the evidence block is what grows underneath it.
//
// ── THE EVIDENCE BLOCK ──
//
// `evidenceFor` decides what the model may lean on and what the reader is told
// the answer is based on. Three tiers, and the boundary between them is not a
// matter of taste: a pattern drawn from four posts is not a pattern, and a
// pattern drawn from a test account is not about this audience.

/** Below this many measured posts, "posts like this did X" is not a claim. */
export const MIN_POSTS_FOR_PATTERN = 8

/**
 * A follower count at or under this is a test account, not an audience.
 *
 * One is the literal case here. Five leaves room for a brand-new real account
 * without letting a staff-only account masquerade as reach.
 */
export const TEST_ACCOUNT_FOLLOWERS = 5

/**
 * What this critique may cite.
 *
 * @param {object[]} posts     measured posts: { platform, engagement, followers }
 * @param {string}   platform  the platform the draft is for
 * @returns {{ tier, usable, note, sampleSize }}
 *
 * `note` is written for the READER, not the model — it is shown on the panel
 * so the critique never has to be taken on trust about its own basis.
 */
export function evidenceFor(posts = [], platform = '') {
  const all = Array.isArray(posts) ? posts.filter(Boolean) : []
  const here = platform ? all.filter(p => p.platform === platform) : all

  // A real audience is what makes past performance mean anything. An account
  // nobody follows produces numbers that are real measurements of nothing.
  const real = here.filter(p => !isTestAccount(p))
  const label = PLATFORM_META[platform]?.label || platform || 'this platform'

  if (real.length >= MIN_POSTS_FOR_PATTERN) {
    return {
      tier: 'history',
      usable: real,
      sampleSize: real.length,
      note: `Based on your brand and on how your last ${real.length} ${label} posts actually performed.`,
    }
  }

  if (here.length > 0 && real.length === 0) {
    return {
      tier: 'test_only',
      usable: [],
      sampleSize: 0,
      note: `Based on your brand and on ${label} craft. The ${here.length} ${label} post${here.length === 1 ? '' : 's'} measured so far ` +
            'belong to a test account with almost no followers, so they say nothing about how your audience responds — ' +
            'they are deliberately not used here.',
    }
  }

  if (real.length > 0) {
    return {
      tier: 'thin',
      usable: real,
      sampleSize: real.length,
      note: `Based on your brand and on ${label} craft. Only ${real.length} of your ${label} post${real.length === 1 ? ' has' : 's have'} ` +
            'been measured so far — too few to read a pattern from, so this is judgement rather than evidence.',
    }
  }

  return {
    tier: 'none',
    usable: [],
    sampleSize: 0,
    note: `Based on your brand and on ${label} craft. None of your ${label} posts have been measured yet, ` +
          'so nothing here is drawn from your own results.',
  }
}

/**
 * A post whose account has no real audience behind it.
 *
 * Null and undefined are UNKNOWN, not zero, and are deliberately treated as
 * real. `Number(null)` is 0, which is finite and below the threshold — so the
 * obvious spelling of this classes every post whose follower count failed to
 * sync as a test account, and silently throws away real history at exactly the
 * moment the data is already degraded.
 */
export function isTestAccount(post = {}) {
  if (post?.followers === null || post?.followers === undefined || post?.followers === '') return false
  const followers = Number(post.followers)
  return Number.isFinite(followers) && followers <= TEST_ACCOUNT_FOLLOWERS
}

/**
 * The instruction that changes with the evidence.
 *
 * The rest of the prompt is constant. This one paragraph is what stops a model
 * holding four posts from writing "your audience engages most with…", which is
 * the single most plausible-sounding lie this feature could tell.
 */
export function evidenceInstruction(evidence) {
  if (evidence.tier === 'history') {
    return [
      `You have ${evidence.sampleSize} of this brand's own measured posts below. Use them: say which`,
      'comparable posts did well or badly and what this draft shares with them. Cite the actual post',
      'when you do.',
    ].join('\n')
  }
  return [
    'You have NO usable performance history for this brand.',
    '',
    'Therefore: never say what "your audience" responds to, never claim a pattern, never estimate',
    'reach, engagement, a rate, or a score. You have not measured this audience and must not imply',
    'that you have. Judge the draft on the brand, on the platform\'s craft, and on what the post is',
    'trying to achieve — and be concrete about those. "The hook buries the number until line three"',
    'is a real critique from no data at all; "this will underperform" is not.',
  ].join('\n')
}

/**
 * Normalise what the model returned.
 *
 * Every field defaulted, because a structured response that omits an optional
 * key is normal and a panel that renders `undefined.map` is not.
 */
export function normalizeCritique(raw = {}) {
  return {
    verdict: String(raw.verdict || '').trim(),
    strengths: list(raw.strengths).slice(0, 4),
    changes: (Array.isArray(raw.changes) ? raw.changes : [])
      .map(c => ({
        what: String(c?.what || '').trim(),
        why: String(c?.why || '').trim(),
        // Absent is normal: "shorten the first line" has no replacement text,
        // and inventing one would put words in the post nobody asked for.
        suggestion: String(c?.suggestion || '').trim(),
      }))
      .filter(c => c.what)
      .slice(0, 6),
  }
}

const list = v => (Array.isArray(v) ? v.map(s => String(s || '').trim()).filter(Boolean) : [])

/** Hashtags from either shape: an array, or one space/comma-separated string. */
export function hashtagsOf(raw) {
  if (Array.isArray(raw)) return list(raw)
  return String(raw || '').split(/[\s,]+/).map(s => s.trim()).filter(Boolean)
}

/**
 * The draft, as the model sees it.
 *
 * Absences are stated rather than omitted — "no alt text" is a finding, and a
 * key that simply is not there reads to a model as a field it was not shown.
 */
export function describeDraft(draft = {}) {
  const platform = String(draft.platform || '')
  const caption = String(draft.caption || '')
  const media = Array.isArray(draft.media) ? draft.media : []
  const images = media.filter(m => m?.type !== 'video').length
  const videos = media.filter(m => m?.type === 'video').length
  const limit = PLATFORM_META[platform]?.maxChars

  return [
    `PLATFORM: ${PLATFORM_META[platform]?.label || platform || 'unspecified'}`,
    `FORMAT: ${draft.format || 'unspecified'}`,
    `PICTURES: ${images || 'none'}${videos ? `, plus ${videos} video` : ''}`,
    `WHEN: ${draft.scheduled_at || 'not scheduled yet'}`,
    `CAPTION LENGTH: ${caption.length} characters${limit ? ` (the platform allows ${limit})` : ''}`,
    // A string OR an array: composer state holds hashtags as one text field,
    // while a plan idea holds them as a list. Accepting both here is cheaper
    // than making every caller convert, and getting it wrong is silent — the
    // critique would simply judge a post that appears to have no hashtags.
    `HASHTAGS: ${hashtagsOf(draft.hashtags).join(' ') || 'none'}`,
    `FIRST COMMENT: ${String(draft.first_comment || '').trim() || 'none'}`,
    `ALT TEXT: ${String(draft.alt_text || '').trim() || 'none'}`,
    '',
    'CAPTION:',
    caption || '(empty)',
  ].join('\n')
}
