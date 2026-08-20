import { describe, it, expect } from 'vitest'
import {
  emptyComposer, setPlatform, setOption, optionsFor, captionStats,
  composedCaption, capabilities, validateComposer, platformSpecificData, tiktokSettings,
} from './composerState'

// The composer's rules, without React. These are the parts that decide whether
// a post can go out at all, and most of them encode a platform refusal that
// would otherwise arrive minutes later as an opaque provider error.

const withMedia = (state, media) => ({ ...state, media, accountIds: ['acc_1'] })
const image = (over = {}) => ({ url: 'https://cdn.test/a.jpg', type: 'image', mimeType: 'image/jpeg', ...over })
const video = (over = {}) => ({ url: 'https://cdn.test/a.mp4', type: 'video', mimeType: 'video/mp4', seconds: 20, ...over })

describe('platform switching', () => {
  it('resets the format, which is meaningless across platforms', () => {
    const ig = { ...emptyComposer('instagram'), format: 'carousel' }
    expect(setPlatform(ig, 'tiktok').format).toBe('video')
  })

  // A draft retargeted to TikTok and back should not have lost its Instagram
  // choices — that is the whole reason options are keyed by platform.
  it('keeps the previous platform\'s options', () => {
    let s = emptyComposer('instagram')
    s = setOption(s, 'firstComment', 'Specs in the comments')
    s = setPlatform(s, 'tiktok')
    s = setOption(s, 'privacy_level', 'SELF_ONLY')

    expect(optionsFor(s, 'instagram').firstComment).toBe('Specs in the comments')
    expect(optionsFor(s, 'tiktok').privacy_level).toBe('SELF_ONLY')
  })
})

describe('caption counting', () => {
  // Hashtags publish as part of the caption. Counting them separately is how a
  // post shows 1,900/2,200 while 400 characters of tags sit in another box,
  // then gets truncated on the way out.
  it('counts hashtags against the platform limit', () => {
    const s = { ...emptyComposer('instagram'), caption: 'a'.repeat(2190), hashtags: '#arak #lighting' }
    const stats = captionStats(s)

    expect(stats.over).toBe(true)
    expect(stats.used).toBeGreaterThan(2200)
  })

  it('uses Snapchat\'s much shorter limit for Snapchat', () => {
    expect(captionStats({ ...emptyComposer('snapchat'), caption: '' }).limit).toBe(250)
  })

  it('joins caption and hashtags with a blank line, and survives either being empty', () => {
    const base = emptyComposer('instagram')
    expect(composedCaption({ ...base, caption: 'Hello', hashtags: '#arak' })).toBe('Hello\n\n#arak')
    expect(composedCaption({ ...base, caption: 'Hello', hashtags: '' })).toBe('Hello')
    expect(composedCaption({ ...base, caption: '', hashtags: '#arak' })).toBe('#arak')
  })
})

describe('capabilities', () => {
  // Zernio: firstComment and collaborators are feed/carousel only, never
  // Stories. Offering them on a Story produces a rejected post.
  it('withdraws first comment and collaborators on a Story', () => {
    const caps = capabilities({ ...emptyComposer('instagram'), format: 'story' })
    expect(caps.firstComment).toBe(false)
    expect(caps.collaborators).toBe(false)
  })

  it('offers reel-only controls only on a Reel', () => {
    expect(capabilities({ ...emptyComposer('instagram'), format: 'reel' }).thumbOffset).toBe(true)
    expect(capabilities({ ...emptyComposer('instagram'), format: 'feed_image' }).thumbOffset).toBe(false)
  })

  // A photo carousel has nothing to duet with, and TikTok rejects the fields.
  it('withdraws duet and stitch on a TikTok photo carousel', () => {
    expect(capabilities({ ...emptyComposer('tiktok'), format: 'video' }).duetStitch).toBe(true)
    expect(capabilities({ ...emptyComposer('tiktok'), format: 'photo_carousel' }).duetStitch).toBe(false)
  })
})

describe('validation', () => {
  const ok = s => validateComposer(s).ok

  it('refuses a post with no account selected', () => {
    const s = { ...emptyComposer('instagram'), media: [image()] }
    expect(validateComposer(s).errors.join(' ')).toMatch(/at least one account/i)
  })

  it('accepts a straightforward feed image', () => {
    expect(ok(withMedia(emptyComposer('instagram'), [image()]))).toBe(true)
  })

  it('refuses a Reel with no video', () => {
    const s = withMedia({ ...emptyComposer('instagram'), format: 'reel' }, [image()])
    expect(validateComposer(s).errors.join(' ')).toMatch(/needs a video/i)
  })

  it('refuses more carousel items than the platform allows', () => {
    const s = withMedia({ ...emptyComposer('instagram'), format: 'carousel' },
      Array.from({ length: 11 }, image))
    expect(validateComposer(s).errors.join(' ')).toMatch(/allows 10/)
  })

  // TikTok takes 35, Instagram 10 — the limits are genuinely per-platform and
  // a shared number would refuse valid TikTok posts.
  it('allows 11 carousel items on TikTok, which permits 35', () => {
    const s = withMedia({ ...emptyComposer('tiktok'), format: 'photo_carousel' },
      Array.from({ length: 11 }, image))
    expect(validateComposer(s).errors.join(' ')).not.toMatch(/carousel/)
  })

  it('refuses a video longer than the platform accepts', () => {
    const s = withMedia({ ...emptyComposer('tiktok'), format: 'video' }, [video({ seconds: 700 })])
    const v = validateComposer(s)
    // TikTok caps at 10 minutes; this is 11m40s.
    expect(v.errors.join(' ')).toMatch(/caps videos/i)
  })

  it('refuses a video shorter than the platform accepts', () => {
    const s = withMedia({ ...emptyComposer('tiktok'), format: 'video' }, [video({ seconds: 1 })])
    expect(validateComposer(s).errors.join(' ')).toMatch(/at least 3 seconds/i)
  })

  // Unknown duration must not invent a failure — library media carries
  // metadata, a hand-entered URL may not, and the platform can answer.
  it('does not fail a video whose duration is unknown', () => {
    const s = withMedia({ ...emptyComposer('tiktok'), format: 'video' }, [video({ seconds: null })])
    expect(validateComposer(s).errors.join(' ')).not.toMatch(/seconds|caps videos/i)
  })

  describe('TikTok hard requirements', () => {
    const base = () => withMedia({ ...emptyComposer('tiktok'), format: 'video' }, [video()])

    // Zernio requires privacy_level and the post fails without it. Defaulting
    // to PUBLIC_TO_EVERYONE would be how a private account posts publicly.
    it('refuses without a privacy level', () => {
      let s = base()
      s = setOption(s, 'consent_confirmed', true)
      expect(validateComposer(s).errors.join(' ')).toMatch(/who can see/i)
    })

    it('refuses without the consent declaration', () => {
      let s = base()
      s = setOption(s, 'privacy_level', 'PUBLIC_TO_EVERYONE')
      expect(validateComposer(s).errors.join(' ')).toMatch(/consent declaration/i)
    })

    it('accepts once both are given', () => {
      let s = base()
      s = setOption(s, 'privacy_level', 'PUBLIC_TO_EVERYONE')
      s = setOption(s, 'consent_confirmed', true)
      expect(ok(s)).toBe(true)
    })
  })

  it('warns rather than refuses on a one-image carousel', () => {
    const s = withMedia({ ...emptyComposer('instagram'), format: 'carousel' }, [image()])
    const v = validateComposer(s)
    expect(v.ok).toBe(true)
    expect(v.warnings.join(' ')).toMatch(/publishes as a normal post/i)
  })
})

describe('payload shaping', () => {
  it('omits first comment on a Story instead of sending a rejected field', () => {
    let s = { ...emptyComposer('instagram'), format: 'story' }
    s = setOption(s, 'firstComment', 'nope')
    const data = platformSpecificData(s)

    expect(data.firstComment).toBeUndefined()
    // Stories are the one Instagram format that must name itself.
    expect(data.contentType).toBe('story')
  })

  it('sends first comment on a feed post, and no contentType', () => {
    let s = emptyComposer('instagram')
    s = setOption(s, 'firstComment', 'Specs below')
    const data = platformSpecificData(s)

    expect(data.firstComment).toBe('Specs below')
    expect(data).not.toHaveProperty('contentType')
  })

  it('marks Studio media as AI-generated by default', () => {
    expect(platformSpecificData(emptyComposer('instagram')).isAiGenerated).toBe(true)
  })

  it('builds tiktokSettings with the mandatory consent flags', () => {
    let s = { ...emptyComposer('tiktok'), format: 'video' }
    s = setOption(s, 'privacy_level', 'FOLLOWER_OF_CREATOR')
    const settings = tiktokSettings(s)

    expect(settings.privacy_level).toBe('FOLLOWER_OF_CREATOR')
    expect(settings.content_preview_confirmed).toBe(true)
    expect(settings.express_consent_given).toBe(true)
    expect(settings.allow_duet).toBe(true)
  })

  it('drops duet and stitch from a photo carousel\'s settings', () => {
    let s = { ...emptyComposer('tiktok'), format: 'photo_carousel' }
    s = setOption(s, 'privacy_level', 'PUBLIC_TO_EVERYONE')
    const settings = tiktokSettings(s)

    expect(settings).not.toHaveProperty('allow_duet')
    expect(settings.media_type).toBe('photo')
  })

  it('returns nothing for a platform without TikTok settings', () => {
    expect(tiktokSettings(emptyComposer('instagram'))).toBeNull()
  })
})
