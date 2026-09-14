import { defaultWebhookUrl } from './n8nWebhooks'
import { publishPost as publishViaZernio } from './zernio'
import { BRAND_TIMEZONE } from './brandTime'
import {
  composedCaption, platformSpecificData, tiktokSettings, validateComposer,
} from './composerState'

// ─── One publish path ──────────────────────────────────────────────────────
// Every platform publishes through Zernio. The Meta Graph API path was removed
// on 2026-09-14: it could only ever reach Instagram, and two providers behind
// one Publish button meant two payload shapes and two failure vocabularies.
// Meta survives only server-side, as the research agent's read-only source of
// competitor numbers (business_discovery) — nothing publishes through it.

// Media is passed by URL: everything the composer offers already lives in
// public Supabase Storage, so there is nothing to upload. The first video wins
// over images because a post is one or the other, never both — and the
// composer's own validation has already refused the mixed case.
function mediaFields(state) {
  const videos = state.media.filter(m => m.type === 'video')
  const images = state.media.filter(m => m.type === 'image')
  if (videos.length) {
    return { videoUrl: videos[0].url, coverImageUrl: state.coverImageUrl || '' }
  }
  return {
    imageUrl: images[0]?.url || '',
    imageUrls: images.length > 1 ? images.map(m => m.url) : undefined,
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
  const check = validateComposer(state)
  if (!check.ok) return { error: check.errors[0], errors: check.errors }

  const req = buildPublishRequest(state, opts)
  return publishViaZernio(defaultWebhookUrl('publishPost'), req)
}
