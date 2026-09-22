import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import {
  automationFields, cleanList, normalizeAutomation, postChoices, hasMorePages, AUTO_REPLY_PLATFORMS, isAction,
} from './[action].js'

// ─── Keyword auto-replies ──────────────────────────────────────────────────
//
// Everything here guards a rule that fails QUIETLY if it is wrong. An
// automation that is accepted but never fires, or one that answers far more
// people than intended, both look exactly like a working automation until
// somebody reads the logs.

const ok = (over = {}) => automationFields({ name: 'Catalogue', dm_message: 'Here you go', ...over })

describe('the actions exist under the names the browser will call', () => {
  it('answers all four', () => {
    for (const a of ['auto_replies', 'auto_reply_save', 'auto_reply_delete', 'auto_reply_logs', 'auto_reply_posts', 'auto_reply_post']) {
      expect(isAction(a)).toBe(true)
    }
  })
})

describe('automationFields — what is required', () => {
  it('needs a name', () => {
    expect(automationFields({ dm_message: 'hi' }).__fail).toBe(true)
    expect(automationFields({ name: '   ', dm_message: 'hi' }).__fail).toBe(true)
  })

  it('needs a message', () => {
    expect(automationFields({ name: 'X' }).__fail).toBe(true)
    expect(automationFields({ name: 'X', dm_message: '  ' }).__fail).toBe(true)
  })

  it('accepts the minimum', () => {
    const f = ok()
    expect(f.__fail).toBeUndefined()
    expect(f).toMatchObject({ name: 'Catalogue', dmMessage: 'Here you go', keywords: [] })
  })

  // Counted here rather than left to Zernio: a refusal that arrives after the
  // request crossed the internet reads as "something went wrong", and the
  // thing that went wrong was a character count the browser could have done.
  it('refuses a message past Instagram\'s limit, and says the number', () => {
    const f = automationFields({ name: 'X', dm_message: 'a'.repeat(1001) })
    expect(f.__fail).toBe(true)
    expect(f.error).toContain('1001')
  })

  it('allows one exactly at the limit', () => {
    expect(automationFields({ name: 'X', dm_message: 'a'.repeat(1000) }).__fail).toBeUndefined()
  })
})

describe('automationFields — the rules that stop it over-firing', () => {
  // alsoMatchInDms with no keywords means EVERY incoming message gets an
  // automatic reply. That is a different product, and an expensive mistake to
  // discover from the logs.
  it('refuses "answer DMs too" with no keywords', () => {
    const f = ok({ also_match_in_dms: true })
    expect(f.__fail).toBe(true)
    expect(f.error).toMatch(/keyword/i)
  })

  it('allows it once there is a keyword', () => {
    const f = ok({ also_match_in_dms: true, keywords: ['catalogue'] })
    expect(f.__fail).toBeUndefined()
    expect(f.alsoMatchInDms).toBe(true)
  })

  it('defaults to comments only', () => {
    expect(ok({ keywords: ['x'] }).alsoMatchInDms).toBe(false)
  })
})

describe('automationFields — matching', () => {
  it('defaults to contains, and only accepts the two Zernio knows', () => {
    expect(ok().matchMode).toBe('contains')
    expect(ok({ match_mode: 'word' }).matchMode).toBe('word')
    expect(ok({ match_mode: 'regex' }).matchMode).toBe('contains')
  })

  // Zernio only applies typo tolerance to whole-word matching. Sending it with
  // 'contains' is a no-op that comes back switched ON next time the editor
  // opens — the user sees a setting that is not doing anything.
  it('drops typo tolerance unless matching whole words', () => {
    expect(ok({ match_mode: 'contains', typo_tolerance: true }).typoTolerance).toBe(false)
    expect(ok({ match_mode: 'word', typo_tolerance: true }).typoTolerance).toBe(true)
  })
})

describe('automationFields — is_active', () => {
  // Absent must mean "don't touch it". A PATCH that always sent isActive would
  // switch a paused automation back on every time its wording was edited.
  it('is omitted entirely when not supplied', () => {
    expect('isActive' in ok()).toBe(false)
  })

  it('is sent when supplied, either way', () => {
    expect(ok({ is_active: false }).isActive).toBe(false)
    expect(ok({ is_active: true }).isActive).toBe(true)
  })
})

describe('cleanList', () => {
  it('trims, drops blanks and de-duplicates case-insensitively', () => {
    expect(cleanList([' catalogue ', 'Catalogue', '', '  ', 'price']))
      .toEqual(['catalogue', 'price'])
  })

  it('accepts a comma-separated string, which is what a text box gives', () => {
    expect(cleanList('catalogue, price , ,catalogue')).toEqual(['catalogue', 'price'])
  })

  it('keeps the first spelling seen, not the last', () => {
    expect(cleanList(['Catalogue', 'catalogue'])).toEqual(['Catalogue'])
  })

  it('is empty for nothing', () => {
    expect(cleanList(null)).toEqual([])
    expect(cleanList([])).toEqual([])
    expect(cleanList('')).toEqual([])
  })
})

describe('normalizeAutomation', () => {
  // Zernio OMITS fields rather than nulling them, so every reader has to treat
  // absent as a value. Doing it once here is what stops a card rendering
  // "undefined" where a keyword list should be.
  it('fills everything Zernio left out', () => {
    const a = normalizeAutomation({ id: 'a1', name: 'Catalogue', accountId: 'acc1' })
    expect(a).toMatchObject({
      id: 'a1', name: 'Catalogue', account_id: 'acc1',
      keywords: [], exclude_keywords: [], match_mode: 'contains',
      dm_message: '', comment_reply: '', platform_post_id: '',
      typo_tolerance: false, also_match_in_dms: false,
    })
    expect(a.stats).toEqual({ triggered: 0, dmsSent: 0, dmsFailed: 0, uniqueContacts: 0 })
  })

  // Absent isActive means ACTIVE in Zernio's shape. Defaulting it to false
  // would show every working automation as paused.
  it('treats a missing isActive as active, and an explicit false as paused', () => {
    expect(normalizeAutomation({ id: 'a' }).is_active).toBe(true)
    expect(normalizeAutomation({ id: 'a', isActive: false }).is_active).toBe(false)
  })

  it('accepts Mongo\'s _id as well as id', () => {
    expect(normalizeAutomation({ _id: 'abc' }).id).toBe('abc')
  })

  it('carries the stats through', () => {
    const a = normalizeAutomation({ id: 'a', stats: { triggered: 12, dmsSent: 11, dmsFailed: 1, uniqueContacts: 9 } })
    expect(a.stats).toEqual({ triggered: 12, dmsSent: 11, dmsFailed: 1, uniqueContacts: 9 })
  })
})

describe('which platforms can be automated', () => {
  // Zernio's own limit. LinkedIn is this brand's best channel and is NOT on
  // the list — if this ever grows, the screen's explanation has to change with
  // it rather than silently keep saying "Instagram and Facebook only".
  it('is Instagram and Facebook, and not LinkedIn or TikTok', () => {
    expect(AUTO_REPLY_PLATFORMS).toEqual(['instagram', 'facebook'])
    expect(AUTO_REPLY_PLATFORMS).not.toContain('linkedin')
    expect(AUTO_REPLY_PLATFORMS).not.toContain('tiktok')
  })
})

// ─── The base URL already carries the version ──────────────────────────────
//
// ZERNIO_BASE is 'https://zernio.com/api/v1' and request() does `${base}/${path}`.
// Zernio's OpenAPI document lists its paths AS '/v1/comment-automations', so
// copying one straight out of the spec produces /api/v1/v1/... and a "No such
// API endpoint" that only appears against the live API — every unit test and
// the whole build pass, because nothing local ever forms the URL.
//
// That is exactly what shipped in #118. This reads the route for request paths
// and refuses any that start with a version segment.
describe('zernio request paths', () => {
  const source = fs.readFileSync(new URL('./[action].js', import.meta.url), 'utf8')
  const paths = [...source.matchAll(/z\.request\(\s*[`'"]([^`'"$]*)/g)].map(m => m[1])

  it('finds the call sites (guards the regex itself)', () => {
    expect(paths.length).toBeGreaterThanOrEqual(6)
  })

  it('never repeats the version the base URL already has', () => {
    expect(paths.filter(p => /^\/?v\d+\//.test(p))).toEqual([])
  })

  it('never starts with a slash, which would also double it', () => {
    expect(paths.filter(p => p.startsWith('/'))).toEqual([])
  })
})

describe('postChoices — the posts an auto-reply can be pinned to', () => {
  const row = (over = {}) => ({
    _id: 'zernio-row-id',
    content: 'Lobby lighting',
    thumbnailUrl: 'https://cdn/x.jpg',
    publishedAt: '2026-09-21T10:00:00Z',
    analytics: { comments: 3 },
    platforms: [{ accountId: 'acc1', platformPostId: '1788', platformPostUrl: 'https://instagram.com/p/abc/' }],
    ...over,
  })

  // Zernio's matcher compares against the platform media id. Its own row id
  // is accepted at create and then never matches a comment.
  it("uses the platform's media id, never Zernio's row id", () => {
    const [p] = postChoices({ posts: [row()] }, 'acc1')
    expect(p).toEqual({
      platform_post_id: '1788', caption: 'Lobby lighting', thumbnail: 'https://cdn/x.jpg',
      url: 'https://instagram.com/p/abc/', published_at: '2026-09-21T10:00:00Z', comments: 3,
    })
  })

  it('takes the id from THIS account\'s entry on a cross-posted row', () => {
    const r = row({ platforms: [
      { accountId: 'other', platformPostId: 'fb-1' },
      { accountId: 'acc1', platformPostId: 'ig-1' },
    ] })
    expect(postChoices({ posts: [r] }, 'acc1')[0].platform_post_id).toBe('ig-1')
  })

  it('drops rows with no platform id, and duplicates', () => {
    const out = postChoices({ posts: [row(), row(), row({ platforms: [{ accountId: 'acc1' }] })] }, 'acc1')
    expect(out).toHaveLength(1)
  })

  // The single-post read names the per-platform list differently.
  it('reads the single-post shape too', () => {
    const single = { content: 'easy post', thumbnailUrl: 't', platformAnalytics: [{ accountId: 'acc1', platformPostId: '1807', platformPostUrl: 'u' }] }
    expect(postChoices({ posts: [single] }, 'acc1')[0]).toMatchObject({ platform_post_id: '1807', url: 'u', thumbnail: 't' })
  })

  it('survives an empty or malformed response', () => {
    expect(postChoices(null, 'acc1')).toEqual([])
    expect(postChoices({ posts: 'nope' }, 'acc1')).toEqual([])
  })
})

describe('hasMorePages — when the picker asks for another page', () => {
  it("trusts Zernio's page count when it sends one", () => {
    expect(hasMorePages({ pagination: { pages: 3 } }, 1, 24)).toBe(true)
    expect(hasMorePages({ pagination: { pages: 3 } }, 3, 24)).toBe(false)
    expect(hasMorePages({ pagination: { pages: 1 }, posts: new Array(24) }, 1, 24)).toBe(false)
  })

  it('without one, a full page means there may be more', () => {
    expect(hasMorePages({ posts: new Array(24) }, 1, 24)).toBe(true)
    expect(hasMorePages({ posts: new Array(5) }, 1, 24)).toBe(false)
    expect(hasMorePages(null, 1, 24)).toBe(false)
  })
})
