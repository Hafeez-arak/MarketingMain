import { defaultWebhookUrl } from './n8nWebhooks'
import { publishPost as publishViaZernio } from './zernio'
import { publishPost as publishViaMeta } from './meta'
import { BRAND_TIMEZONE } from './brandTime'
import {
  composedCaption, platformSpecificData, tiktokSettings, validateComposer,
} from './composerState'

// ─── One publish path, two providers ───────────────────────────────────────
// Zernio is primary. It is the only one of the two that can reach TikTok at
// all, and having Instagram go out through a different provider than TikTok
// means two payload shapes, two failure vocabularies and two sets of bugs for
// one button.
//
// Meta stays wired rather than deleted. It is the path Instagram publishing
// ran on through August 2026 and it is proven in production; keeping it a
// function call away means a Zernio outage is a one-line change, not a
// redeploy of three workflows. That is the same reasoning that kept zernio.js
// intact when the migration went the other way — the module was dormant, not
// dismantled, and it is why this reversal is cheap.

export const PROVIDERS = { ZERNIO: 'zernio', META: 'meta' }

// Instagram is the only platform either provider can serve, so it is the only
// one where a choice exists. Asking for Meta on TikTok is a caller bug, not a
// fallback — answered here rather than as a confusing provider error.
export function providerFor(platform, preferred = PROVIDERS.ZERNIO) {
  if (platform !== 'instagram') return PROVIDERS.ZERNIO
  return preferred === PROVIDERS.META ? PROVIDERS.META : PROVIDERS.ZERNIO
}

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

  const provider = providerFor(state.platform, opts.provider)
  const req = buildPublishRequest(state, opts)

  if (provider === PROVIDERS.META) {
    const url = defaultWebhookUrl('metaPublish')
    const res = await publishViaMeta(url, req)
    return { ...res, provider }
  }

  const url = defaultWebhookUrl('publishPost')
  const res = await publishViaZernio(url, req)
  return { ...res, provider }
}
