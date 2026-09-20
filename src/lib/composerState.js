import { defaultFormat, getFormat, limitsFor, zernioFormatFields } from './postFormats'
import { PLATFORM_META } from './utils'
import { mediaOfPost, MAX_CAROUSEL_ITEMS, isMixed, countsOf } from './mediaOrder'

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

// ── Opening a generated post in the composer ──────────────────────────────
// The bridge between the generation half of the app and the publishing half.
// A post produced by Creative Studio or a content plan is a database row; this
// turns one into composer state so it can be reviewed, adjusted and sent
// through exactly the same path as something composed by hand.
//
// Deliberately a CONVERSION rather than a second publish path. The alternative
// — teaching the Approvals screen to build its own provider payload — is how
// the two halves drift, and it already produced one publish call that only
// understood Instagram.
export function composerFromPost(row, { platform = row?.platform } = {}) {
  if (!row) return emptyComposer(platform)

  // Everything the row holds, in order — NOT `video ? [video] : images`.
  //
  // That ternary is why reopening a mixed carousel showed only the clip: the
  // two pictures were on the row the whole time and this refused to load them,
  // and because rowFrom then wrote back what the composer was holding, saving
  // the post DELETED them. mediaOfPost reads the ordered `media` column and
  // falls back to the legacy columns for rows written before it existed.
  //
  // Metadata is genuinely unknown for a stored row — the generator records a
  // URL, not a duration or a byte count. Left null so validation checks only
  // what it knows rather than inventing a failure. See PLATFORM_LIMITS.
  const media = mediaOfPost(row).map(m => ({
    ...m, mimeType: '', bytes: null, seconds: null,
  }))

  return {
    ...emptyComposer(platform),
    format: row.format || defaultFormat(platform),
    campaignId: row.campaign_id || '',
    // The row's caption already has hashtags folded in by the generator, so
    // they are NOT split back out — doing so and letting the composer rejoin
    // them is how a tag block ends up duplicated.
    caption: row.caption || '',
    hashtags: '',
    media,
    coverImageUrl: row.cover_image_url || '',
    tags: row.tags || [],
    scheduledFor: row.scheduled_date
      ? `${row.scheduled_date}T${(row.publish_time || '09:00').slice(0, 5)}`
      : '',
    // Whatever was chosen last time this post was composed. Empty for a
    // freshly generated post, which is correct: nobody has chosen anything yet
    // and the defaults apply.
    options: row.platform_options || {},
    postId: row.id,
    postTable: row.post_table || 'generated_posts',
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
      // Renames the video's OWN audio — the "original audio" label people tap
      // through to. Independent of audioConfiguration, works on any
      // connection, and costs nothing.
      audioName: '',
      // A catalog track: { audioId, audioVolume, videoVolume }. Null rather
      // than an empty object so "no track chosen" is unambiguous — an object
      // with a blank audioId would reach the API and be rejected.
      audioConfiguration: null,
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
  if (platform === 'linkedin') {
    return {
      firstComment: '',
      altText: '',
      // LinkedIn builds a preview card for the first URL in a post that has no
      // media of its own. Default OFF (i.e. previews left on) because that is
      // LinkedIn's own behaviour, and a link post without its card is the odd
      // choice rather than the safe one.
      disableLinkPreview: false,
      // A poll, or null when this is not a poll. Null rather than an empty
      // object so "no poll" is unambiguous: an object with a blank question
      // would reach the API and be rejected.
      poll: null,
      // No AI-disclosure equivalent. Instagram and TikTok both have a field
      // for it; LinkedIn's API does not, so there is nothing to send and
      // nothing to ask.
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
  const isCarousel = f?.id === 'carousel' || f?.id === 'photo_carousel' || f?.id === 'multi_image'

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
      // audioName applies to any Reel. Catalog audio is Reels-only too, but
      // ALSO depends on how the chosen account was connected — which this
      // function cannot see, since it takes no account. The panel gates the
      // picker on supportsCatalogAudio(account) as well; this is the format
      // half of the answer, not the whole of it.
      audioName:     isReel,
      catalogAudio:  isReel,
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
  if (platform === 'linkedin') {
    const isPoll = f?.id === 'poll'
    return {
      // Zernio exposes firstComment on every LinkedIn post shape, and it is
      // where a company page puts the link it does not want in the body —
      // LinkedIn demotes posts that send people off-platform.
      firstComment: true,
      // Neither exists on LinkedIn: collaborator posts are an Instagram
      // feature, and @mentions are not a field but text embedded in the body
      // (Zernio resolves a profile URL to a URN you paste into the post), so
      // there is nothing here to tag with.
      collaborators: false,
      userTags: false,
      // Alt text is accepted for images and ignored on video.
      altText: f?.media === 'image',
      carousel: f?.id === 'multi_image',
      // A preview card only exists when LinkedIn has a URL and no media of
      // its own to show instead — attaching an image replaces the card. So the
      // toggle is offered on exactly the format where it can do anything.
      linkPreview: f?.media === 'none' && !isPoll,
      poll: isPoll,
      // The format carries no media at all. Named rather than re-derived by
      // every caller, because "does this need an image?" is asked in three
      // places and got a different answer in each before this existed.
      textOnly: f?.media === 'none',
      aiDisclosure: false,
    }
  }
  return { aiDisclosure: false }
}

// A poll, narrowed to what LinkedIn will accept: trimmed, blank options
// dropped, and nothing sent at all unless there is a real question to ask.
// Returns null rather than a half-built object, so the publish payload either
// carries a valid poll or carries none.
export function cleanPoll(poll, limits) {
  const question = (poll?.question || '').trim()
  const options = (poll?.options || []).map(o => String(o || '').trim()).filter(Boolean)
  if (!question || options.length < (limits?.poll?.minOptions ?? 2)) return null
  return {
    question,
    options: options.slice(0, limits?.poll?.maxOptions ?? 4),
    duration: poll?.duration || 'SEVEN_DAYS',
  }
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

  // A format that carries no media — LinkedIn's text post and its poll — is
  // checked FIRST, because the branch below it exists to demand an image and
  // would demand one here too. This is the whole reason a LinkedIn post can be
  // finished without uploading anything.
  //
  // Media is refused rather than ignored: a poll cannot be combined with media
  // at all (Zernio's spec is explicit), and a text post with an image attached
  // is simply an image post — the format picker is where that is chosen, not
  // the media strip.
  if (f?.media === 'none') {
    if (media.length) {
      errors.push(`A ${label} ${f.label.toLowerCase()} carries no media. Remove it, or pick an image or video format.`)
    }
    // Nothing else to publish, so the caption stops being optional. Without
    // this the post reaches the workflow and fails there with "Nothing to
    // publish", minutes later and with the row already claimed.
    if (!composedCaption(state)) {
      errors.push(`A ${label} ${f.label.toLowerCase()} needs some text.`)
    }
  } else if (f?.media === 'video') {
    if (!videos.length) errors.push(`A ${f.label} needs a video.`)
    // LinkedIn accepts many images but only ever one video — "no multi-video",
    // in Zernio's words. The same sentence happens to be true of a Reel.
    if (videos.length > 1) errors.push(`A ${f.label} takes one video, not ${videos.length}.`)
    // A video format is a video, not a video plus pictures. Said out loud
    // rather than resolved by dropping the images, which is what every layer
    // below here used to do in silence.
    if (images.length) {
      errors.push(`A ${f.label} carries the video only — remove the ${images.length} image${images.length === 1 ? '' : 's'}, or switch to a carousel.`)
    }
  } else if (!media.length) {
    errors.push(`Add ${caps.carousel ? 'at least two images' : 'an image'}.`)
  } else if (isMixed(media)) {
    // ── Images and videos in one post ──
    // Instagram carousels genuinely take both — Zernio's Instagram guide is
    // explicit: "Up to 10 items, images and videos mixed. All items share the
    // aspect ratio of the first item." Nowhere else does.
    //
    // This branch used to not exist at all, while publishPost.mediaFields
    // carried a comment claiming "the composer's own validation has already
    // refused the mixed case". It never had. A mixed post sailed through,
    // and each layer below quietly kept a different half of it.
    if (!caps.carousel) {
      errors.push(`A ${label} ${f?.label?.toLowerCase() || 'post'} takes images or one video, not both.`)
    } else if (state.platform !== 'instagram') {
      errors.push(`${label} carousels cannot mix images and video — that works on Instagram only.`)
    } else {
      // The aspect-ratio rule is Zernio's and we cannot check it here: a
      // stored row carries no dimensions. Saying so beats publishing a
      // carousel that silently crops.
      warnings.push('Instagram sizes every item to match the FIRST one in the carousel — put the item with the aspect ratio you want first.')
    }
  }

  // The 10-item ceiling counts everything in the carousel, not just pictures.
  // The images-only check further down predates mixed media and would let
  // 8 images plus 3 clips through.
  if (caps.carousel && isMixed(media) && media.length > MAX_CAROUSEL_ITEMS) {
    const c = countsOf(media)
    errors.push(`A carousel holds ${MAX_CAROUSEL_ITEMS} items; this one has ${c.total} (${c.images} image${c.images === 1 ? '' : 's'} and ${c.videos} video${c.videos === 1 ? '' : 's'}).`)
  }

  // ── Poll ──
  // LinkedIn cannot edit a poll after it is published, so every one of these
  // is a mistake that cannot be corrected afterwards — worth refusing early.
  if (caps.poll) {
    const poll = opts.poll || {}
    const question = (poll.question || '').trim()
    const options = (poll.options || []).map(o => String(o || '').trim()).filter(Boolean)
    const lim = limits.poll || { minOptions: 2, maxOptions: 4, questionMax: 140, optionMax: 30 }

    if (!question) errors.push('A poll needs a question.')
    if (question.length > lim.questionMax) {
      errors.push(`A poll question is at most ${lim.questionMax} characters; this one is ${question.length}.`)
    }
    if (options.length < lim.minOptions) {
      errors.push(`A poll needs at least ${lim.minOptions} answers.`)
    }
    if (options.length > lim.maxOptions) {
      errors.push(`LinkedIn allows ${lim.maxOptions} poll answers; there are ${options.length}.`)
    }
    if (options.some(o => o.length > lim.optionMax)) {
      errors.push(`Each poll answer is at most ${lim.optionMax} characters.`)
    }
    if (new Set(options.map(o => o.toLowerCase())).size !== options.length) {
      errors.push('Two poll answers are the same.')
    }
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

  // Not repeated for a format that has already refused above for the same
  // reason — a warning restating an error reads as two separate problems.
  if (!composedCaption(state) && state.platform !== 'instagram' && !caps.textOnly) {
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
      ...(caps.audioName && opts.audioName ? { audioName: opts.audioName } : {}),
      // Only when a track was actually chosen. Sending a half-built object is
      // a rejected post, and sending it on a non-Reel is rejected at container
      // creation — hence gating on both the format and a real audioId.
      ...(caps.catalogAudio && opts.audioConfiguration?.audioId
        ? { audioConfiguration: opts.audioConfiguration } : {}),
      ...(opts.isAiGenerated ? { isAiGenerated: true } : {}),
    }
  }

  // LinkedIn. Every field here is one Zernio's LinkedInPlatformData actually
  // defines — documentTitle and reshareUrl are the two it defines that this
  // composer does not offer, for the reasons in FORMAT_CATALOG.
  //
  // organizationUrn is deliberately absent: the connected account already IS
  // the organisation being posted as, and Zernio uses its default org when the
  // field is omitted. Sending a URN we guessed at is how a post lands on the
  // wrong page.
  if (state.platform === 'linkedin') {
    const poll = caps.poll ? cleanPoll(opts.poll, limitsFor('linkedin')) : null
    return {
      ...fields,
      ...(opts.firstComment ? { firstComment: opts.firstComment } : {}),
      ...(caps.altText && opts.altText ? { altText: opts.altText } : {}),
      // Only ever sent as `true`. The field's own default is false, and
      // spelling out a default is how a payload grows fields nobody chose.
      ...(caps.linkPreview && opts.disableLinkPreview ? { disableLinkPreview: true } : {}),
      ...(poll ? { poll } : {}),
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
