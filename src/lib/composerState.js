import { defaultFormat, getFormat, limitsFor, zernioFormatFields } from './postFormats'
import { PLATFORM_META } from './utils'

// ─── Composer state, as pure data ──────────────────────────────────────────
// Everything the create-post screen knows, with no React in it. The screen is
// large and its rules are fiddly — which fields a format allows, when a
// caption is too long, whether this post can be published at all — and those
// rules are the part worth testing. Keeping them here means they can be,
// without mounting anything.
//
// The shape mirrors what eventually goes to Zernio: shared fields at the top,
// per-platform options under `options[platform]`. That is also how
// generated_posts.platform_options is stored, so a draft round-trips through
// the database without a translation layer in the middle.

export function emptyComposer(platform = 'instagram') {
  return {
    platform,
    format: defaultFormat(platform),
    accountIds: [],
    campaignId: '',
    caption: '',
    hashtags: '',
    media: [],            // [{ url, type: 'image'|'video', mimeType, bytes, seconds, width, height }]
    tags: [],             // team-only labels, never sent to a platform
    scheduledFor: '',     // wall-clock 'YYYY-MM-DDTHH:mm' in the brand's zone
    // Per-platform options, keyed by platform so retargeting a draft from
    // Instagram to TikTok keeps both sets rather than silently dropping the
    // first. See the platform_options column comment.
    options: {},
  }
}

// Defaults per platform. Applied when a platform is first touched rather than
// up front, so `options` only ever carries platforms the user actually chose —
// an empty object is a meaningful "nothing configured", and pre-filling every
// platform would destroy that.
export function defaultOptionsFor(platform) {
  if (platform === 'instagram') {
    return {
      firstComment: '',
      collaborators: [],
      userTags: [],
      altText: '',
      shareToFeed: true,
      thumbOffset: null,
      // Everything this app publishes comes out of Creative Studio, so the
      // honest default is on. Both platforms down-rank AI media they detect
      // as undisclosed, which makes this a ranking safeguard rather than
      // paperwork.
      isAiGenerated: true,
    }
  }
  if (platform === 'tiktok') {
    return {
      // Deliberately EMPTY, not 'PUBLIC_TO_EVERYONE'. TikTok requires a
      // privacy level drawn from the creator's own allowed list, which is
      // fetched per account — guessing the most public value as a default is
      // how a private account's post ends up public.
      privacy_level: '',
      allow_comment: true,
      allow_duet: true,
      allow_stitch: true,
      video_made_with_ai: true,
      video_cover_timestamp_ms: 1000,
    }
  }
  return {}
}

export function optionsFor(state, platform = state.platform) {
  return { ...defaultOptionsFor(platform), ...(state.options?.[platform] || {}) }
}

export function setOption(state, key, value, platform = state.platform) {
  return {
    ...state,
    options: {
      ...state.options,
      [platform]: { ...optionsFor(state, platform), [key]: value },
    },
  }
}

// Switching platform keeps the caption and media but resets the FORMAT, since
// format ids are per-platform ('feed_image' means nothing on TikTok). Options
// for the old platform survive untouched.
export function setPlatform(state, platform) {
  return { ...state, platform, format: defaultFormat(platform), accountIds: [] }
}

// ── Caption counting ──────────────────────────────────────────────────────
// Hashtags count toward the platform's limit because they are published as
// part of the caption — showing 1,900/2,200 while 400 characters of hashtags
// sit in another box is how a post gets silently truncated at publish.
export function captionStats(state) {
  const limit = PLATFORM_META[state.platform]?.maxChars || limitsFor(state.platform).caption
  const caption = state.caption || ''
  const tags = (state.hashtags || '').trim()
  const used = caption.length + (tags ? (caption ? 1 : 0) + tags.length : 0)
  return { used, limit, remaining: limit - used, over: used > limit }
}

export function composedCaption(state) {
  const caption = (state.caption || '').trim()
  const tags = (state.hashtags || '').trim()
  if (!caption) return tags
  if (!tags) return caption
  return `${caption}\n\n${tags}`
}

// ── Which fields does this combination even allow? ────────────────────────
// Driven by the platform's real rules rather than by the UI's convenience, so
// a field is hidden for the same reason the API would reject it.
export function capabilities(state) {
  const { platform, format } = state
  const f = getFormat(platform, format)
  const isStory = f?.id === 'story'
  const isReel  = f?.id === 'reel'
  const isCarousel = f?.id === 'carousel' || f?.id === 'photo_carousel'

  if (platform === 'instagram') {
    return {
      // Zernio: firstComment is feed/carousel only, never Stories.
      firstComment: !isStory,
      // Zernio: up to 3 collaborators, public accounts, not on Stories.
      collaborators: !isStory,
      userTags:      !isStory,
      altText:       !isStory,
      // Reel-only controls.
      shareToFeed:   isReel,
      thumbOffset:   isReel,
      carousel:      isCarousel,
      aiDisclosure:  true,
    }
  }
  if (platform === 'tiktok') {
    return {
      firstComment: false,
      collaborators: false,
      userTags: false,
      altText: false,
      // Duet and stitch apply to video posts only — a photo carousel has
      // nothing to duet with, and TikTok rejects the fields.
      duetStitch: f?.media === 'video',
      coverTimestamp: f?.media === 'video',
      carousel: isCarousel,
      aiDisclosure: true,
      privacyLevel: true,
      consent: true,
    }
  }
  return { aiDisclosure: false }
}

// ── Pre-flight ────────────────────────────────────────────────────────────
// Run before publishing so a refusal is a sentence in the composer rather than
// an opaque provider error minutes later with the row stuck mid-publish. The
// workflow re-checks server-side; this exists to make the failure legible and
// early, not to be the only guard.
//
// Split into errors (publishing is impossible) and warnings (it will work but
// is probably not what you meant), because conflating them either blocks
// people over a nitpick or lets a real problem through as advice.
export function validateComposer(state) {
  const errors = []
  const warnings = []
  const limits = limitsFor(state.platform)
  const opts = optionsFor(state)
  const caps = capabilities(state)
  const f = getFormat(state.platform, state.format)
  const label = PLATFORM_META[state.platform]?.label || state.platform

  if (!state.accountIds?.length) errors.push('Choose at least one account to publish to.')

  const stats = captionStats(state)
  if (stats.over) {
    errors.push(`Caption is ${stats.used - stats.limit} character${stats.used - stats.limit === 1 ? '' : 's'} over ${label}'s ${stats.limit} limit.`)
  }

  const media = state.media || []
  const videos = media.filter(m => m.type === 'video')
  const images = media.filter(m => m.type === 'image')

  if (f?.media === 'video') {
    if (!videos.length) errors.push(`A ${f.label} needs a video.`)
    if (videos.length > 1) errors.push(`A ${f.label} takes one video, not ${videos.length}.`)
  } else if (!media.length) {
    errors.push(`Add ${caps.carousel ? 'at least two images' : 'an image'}.`)
  }

  if (caps.carousel && images.length > limits.carouselMax) {
    errors.push(`${label} allows ${limits.carouselMax} items in a carousel; there are ${images.length}.`)
  }
  if (caps.carousel && images.length === 1) {
    warnings.push('A carousel with one image publishes as a normal post.')
  }

  // Duration and size are only checked when we actually know them. Media
  // picked from the library carries metadata; a URL typed in by hand may not,
  // and inventing a failure for an unknown is worse than letting the platform
  // answer.
  for (const v of videos) {
    if (v.seconds != null) {
      if (v.seconds < limits.video.minSeconds) errors.push(`${label} needs videos of at least ${limits.video.minSeconds} seconds; this one is ${Math.round(v.seconds)}s.`)
      if (v.seconds > limits.video.maxSeconds) errors.push(`${label} caps videos at ${Math.round(limits.video.maxSeconds / 60)} minutes; this one is ${Math.round(v.seconds / 60)}m.`)
    }
    if (v.bytes != null && v.bytes > limits.video.maxBytes) {
      errors.push(`${label} caps video at ${Math.round(limits.video.maxBytes / 1024 ** 3)}GB.`)
    }
    if (v.mimeType && !limits.video.types.includes(v.mimeType)) {
      errors.push(`${label} does not accept ${v.mimeType}.`)
    }
  }
  for (const img of images) {
    if (img.bytes != null && img.bytes > limits.image.maxBytes) {
      warnings.push(`One image is over ${Math.round(limits.image.maxBytes / 1024 ** 2)}MB and may be re-compressed.`)
      break
    }
  }

  if (caps.collaborators && (opts.collaborators || []).length > limits.collaborators) {
    errors.push(`Instagram allows ${limits.collaborators} collaborators.`)
  }

  // TikTok's two hard requirements. Both are the provider's, not ours: a post
  // without a privacy level is rejected, and the consent flags are a legal
  // condition of the API rather than a preference.
  if (caps.privacyLevel && !opts.privacy_level) {
    errors.push('Choose who can see this TikTok post.')
  }
  if (caps.consent && opts.consent_confirmed !== true) {
    errors.push('Confirm the TikTok content and consent declaration before posting.')
  }

  if (!composedCaption(state) && state.platform !== 'instagram') {
    warnings.push('This post has no caption.')
  }

  return { errors, warnings, ok: errors.length === 0 }
}

// The per-platform block for the publish payload. Only fields the current
// format actually allows are included — sending firstComment on a Story is a
// rejection, not a no-op.
export function platformSpecificData(state) {
  const opts = optionsFor(state)
  const caps = capabilities(state)
  const fields = zernioFormatFields(state.platform, state.format)

  if (state.platform === 'instagram') {
    return {
      ...fields,
      ...(caps.firstComment && opts.firstComment ? { firstComment: opts.firstComment } : {}),
      ...(caps.collaborators && opts.collaborators?.length ? { collaborators: opts.collaborators } : {}),
      ...(caps.userTags && opts.userTags?.length ? { userTags: opts.userTags } : {}),
      ...(caps.shareToFeed ? { shareToFeed: opts.shareToFeed !== false } : {}),
      ...(caps.thumbOffset && opts.thumbOffset != null ? { thumbOffset: opts.thumbOffset } : {}),
      ...(opts.isAiGenerated ? { isAiGenerated: true } : {}),
    }
  }
  return fields
}

// TikTok's settings live at the TOP level of the request body, not inside
// platformSpecificData. Zernio's docs call this out as unique to TikTok, and
// getting it wrong is a silently ignored settings block — the post publishes
// with TikTok's defaults instead of the ones chosen here.
export function tiktokSettings(state) {
  if (state.platform !== 'tiktok') return null
  const opts = optionsFor(state)
  const caps = capabilities(state)
  const fields = zernioFormatFields(state.platform, state.format)
  return {
    ...fields,
    privacy_level: opts.privacy_level,
    allow_comment: opts.allow_comment !== false,
    ...(caps.duetStitch ? {
      allow_duet:  opts.allow_duet !== false,
      allow_stitch: opts.allow_stitch !== false,
    } : {}),
    ...(caps.coverTimestamp && opts.video_cover_timestamp_ms != null
      ? { video_cover_timestamp_ms: opts.video_cover_timestamp_ms } : {}),
    ...(opts.video_made_with_ai ? { video_made_with_ai: true } : {}),
    // Not persisted and not defaulted — collected per publish. TikTok requires
    // both true, and reusing last week's answer on a post nobody looked at
    // defeats the point of asking.
    content_preview_confirmed: true,
    express_consent_given: true,
  }
}
