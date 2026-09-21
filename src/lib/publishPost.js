import { defaultWebhookUrl } from './n8nWebhooks'
import { publishPost as publishViaZernio } from './zernio'
import { BRAND_TIMEZONE } from './brandTime'
import {
  composedCaption, platformSpecificData, tiktokSettings, validateComposer,
} from './composerState'
import { mayPublishTo, protectionReason } from './platformSafety'
import { normaliseMedia } from './mediaOrder'
import { fitImageUrl } from './imageFit'

// ─── One publish path ──────────────────────────────────────────────────────
// Every platform publishes through Zernio. The Meta Graph API path was removed
// on 2026-09-14: it could only ever reach Instagram, and two providers behind
// one Publish button meant two payload shapes and two failure vocabularies.
// Meta survives only server-side, as the research agent's read-only source of
// competitor numbers (business_discovery) — nothing publishes through it.

// Media is passed by URL: everything the composer offers already lives in
// public Supabase Storage, so there is nothing to upload.
//
// `media` is the ordered list the workflow builds Zernio's mediaItems from —
// images and videos together, in the order the carousel plays. Instagram
// allows that (up to 10 items, all sized to the first) and so does Zernio.
//
// This used to be `if (videos.length) return { videoUrl }`, carrying a comment
// claiming "a post is one or the other, never both — and the composer's own
// validation has already refused the mixed case". Neither half was true: no
// such validation existed, and the line published the clip while silently
// discarding every picture beside it.
//
// The flat fields are still sent, derived from the same list. The workflow
// falls back to them for any caller that predates `media`, and several nodes
// downstream still read them.
function mediaFields(state) {
  const media = normaliseMedia(state.media)
  const images = media.filter(m => m.type === 'image')
  const videos = media.filter(m => m.type === 'video')
  // Empty fields are omitted, not sent blank: a video post that carries an
  // `imageUrl: ''` invites exactly the "is there an image or isn't there"
  // guessing the rest of this change removes.
  return {
    media,
    ...(images.length ? { imageUrl: images[0].url } : {}),
    ...(images.length > 1 ? { imageUrls: images.map(m => m.url) } : {}),
    ...(videos.length ? { videoUrl: videos[0].url } : {}),
    // A cover belongs to a video. Sending one on an all-images post would have
    // the workflow attach a thumbnail to something that cannot use it.
    ...(videos.length && state.coverImageUrl ? { coverImageUrl: state.coverImageUrl } : {}),
  }
}

// Build the request the publish workflow takes. Kept pure and exported so the
// shape can be asserted in a test rather than only observed in production.
export function buildPublishRequest(state, {
  postId, postTable = 'generated_posts', workspaceId,
  force = false, reschedule = false,
} = {}) {
  const opts = platformSpecificData(state)
  const tt = tiktokSettings(state)

  return {
    postId,
    postTable,
    workspaceId,
    platform: state.platform,
    accountId: state.accountIds[0],
    caption: composedCaption(state),
    // Already folded into `caption` by composedCaption. Sent empty rather than
    // omitted because the workflow joins caption and hashtags itself when both
    // are present, and passing them twice would duplicate the tags in the
    // published post.
    hashtags: '',
    ...mediaFields(state),
    altText: opts.altText || '',
    platformSpecificData: opts,
    ...(tt ? { tiktokSettings: tt } : {}),
    scheduledFor: state.scheduledFor || undefined,
    // The BRAND's zone, never the browser's. Scheduling from a laptop outside
    // KSA used to publish at the wrong local hour, because the times in a
    // content plan have always meant Riyadh time.
    timezone: state.scheduledFor ? BRAND_TIMEZONE : undefined,
    force,
    reschedule,
  }
}

// Publish or schedule one composed post.
//
// Validation runs first and refuses locally, so a post that cannot succeed
// never reaches a provider — a rejected call still claims the row, and a
// claimed row that failed for a reason we could have named in the composer is
// the worst of both.
export async function publishComposed(state, opts = {}) {
  // ── Protected accounts, before validation and before the network ──
  //
  // First, not last: a refusal that arrives after the composer has been
  // validated and the request built is a refusal that has already had several
  // chances to be routed around. ARAK's LinkedIn is the company's real page
  // and this product does not publish to it.
  //
  // This is the first of three layers, not the guarantee. The browser can be
  // bypassed, so the n8n publish workflow refuses the same platform
  // server-side and the API refuses to disconnect it. See
  // src/lib/platformSafety.js.
  const account = opts.account || { platform: state.platform }
  if (!mayPublishTo(account)) return { error: protectionReason(account) }

  const check = validateComposer(state)
  if (!check.ok) return { error: check.errors[0], errors: check.errors }

  // Instagram rejects a picture outside 0.5625–1.91 after the row is claimed.
  // Pad it onto an accepted canvas first, on every path that publishes.
  let fitted = state
  if (state.platform === 'instagram' && state.media?.some(m => m.type === 'image')) {
    try {
      const media = await Promise.all(state.media.map(async m =>
        m.type === 'image' ? { ...m, url: await fitImageUrl(m.url, opts.workspaceId) } : m))
      fitted = { ...state, media }
    } catch (err) {
      return { error: err.message }
    }
  }

  const req = buildPublishRequest(fitted, opts)
  return publishViaZernio(defaultWebhookUrl('publishPost'), req)
}
