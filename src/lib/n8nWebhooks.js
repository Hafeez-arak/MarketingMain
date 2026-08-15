// ─── n8n webhook URLs: one base URL, fixed paths ────────────────────────────
// Every webhook this app calls is the SAME n8n instance with a different
// path. The paths never change — they're baked into the workflow JSON in
// n8n/workflows/ and survive any redeploy of n8n itself. Only the host in
// front of them moves, and it moves often: the marketing team reaches n8n
// through a Cloudflare quick tunnel, which mints a brand-new random
// `*.trycloudflare.com` hostname every time it restarts.
//
// So the host is build config (VITE_N8N_BASE_URL, set in Vercel) and the
// paths are code. Pointing the whole app at a new tunnel is one env var and
// a redeploy — not 27 URLs re-pasted by hand, per workspace, by every user.
//
// Before this, Settings → Workflow Webhooks stored 27 fully-qualified URLs
// per workspace in Supabase (workspace_webhooks.webhooks). That made a new
// tunnel URL a 27-field data-entry job that every workspace had to redo,
// and until they did, every button in the app failed against a dead host.

// Slot → webhook path. Slot keys are the schema (see DEFAULT_WEBHOOKS in
// store/app.js); paths must match `parameters.path` on the Webhook node of
// the matching file in n8n/workflows/.
//
// The four schedule slots are deliberately absent: no workflow in
// n8n/workflows/ answers arak-{instagram,linkedin}-schedule[-regen], so
// there is nothing to point them at. Giving them a derived URL anyway would
// turn today's honest "not configured yet" into a 404 at call time. Add
// them here the day the workflows land.
export const WEBHOOK_PATHS = {
  instagram:        'arak-instagram',
  instagramReels:   'arak-instagram-reels',
  linkedin:         'arak-linkedin',
  campaignPlanner:  'arak-campaign-planner',
  instagramPlanGen: 'arak-ig-plan-generation',
  linkedinPlanGen:  'arak-li-plan-generation',
  elongateIdea:     'arak-elongate-idea',
  captionStudio:    'arak-caption-studio',
  draftCopy:        'arak-draft-copy',
  mediaOptions:     'arak-media-options',
  videoRender:      'arak-video-render',
  creativeGenerate: 'arak-creative-generate',
  creativeEdit:     'arak-creative-edit',
  creativeVideo:    'arak-creative-video',
  creativeVideoEdit:'arak-creative-video-edit',
  creativeCompose:  'arak-creative-compose',
  creativeEnhance:  'arak-creative-enhance',
  creativeStitch:   'arak-creative-stitch',
  creativeCancel:   'arak-creative-cancel',
  falBalance:       'arak-fal-balance',
  publishPost:      'arak-publish-post',
  zernioSync:       'arak-zernio-sync',
  zernioDashboard:  'arak-zernio-dashboard',
}

// Trailing slashes are stripped so `.../webhook/x` never comes out as
// `...//webhook/x` — n8n 404s on the doubled slash, which reads like a
// missing workflow rather than a typo in an env var.
export const N8N_BASE_URL = String(import.meta.env.VITE_N8N_BASE_URL || '')
  .trim()
  .replace(/\/+$/, '')

// The URL a slot points at when nobody has overridden it. Empty when
// VITE_N8N_BASE_URL isn't set (local dev without a tunnel), which every
// caller already handles as "not configured" — see the `if (!webhookUrl)`
// guard in creativeStudio.js and friends.
export function defaultWebhookUrl(slot) {
  const path = WEBHOOK_PATHS[slot]
  if (!path || !N8N_BASE_URL) return ''
  return `${N8N_BASE_URL}/webhook/${path}`
}

export function defaultWebhooks(slots) {
  const out = {}
  for (const slot of slots) out[slot] = defaultWebhookUrl(slot)
  return out
}

// Is this URL one of ours, just on a stale host? True when the path matches
// the slot's own webhook path regardless of what host precedes it.
//
// This is what makes an old tunnel URL self-healing. Rows written into
// workspace_webhooks before this change hold hostnames that are now dead
// (http://localhost:5680/..., or a previous trycloudflare hostname). Left
// alone they'd shadow the build's correct default forever — a stored value
// is non-empty, so a naive merge prefers it. Recognising them as OUR
// workflow on the WRONG host lets us drop them for the current default,
// with no migration and no write-back, and it keeps working across every
// future tunnel restart.
function isStaleOurs(slot, url) {
  const path = WEBHOOK_PATHS[slot]
  if (!path) return false
  return new RegExp(`/webhook(-test)?/${path}/?$`).test(url)
}

// Merge a stored webhook map over the build's defaults.
//
// Per slot, in order: a blank stored value means "unset", not "blank the
// default"; a stored value that's our path on a stale host is rebased onto
// the current base URL; anything else is a deliberate override (someone
// pointed a slot at a genuinely different endpoint) and is kept as-is.
// Keys outside `slots` are dropped rather than carried through: a slot that
// gets renamed or removed would otherwise live on in every stored blob
// forever, and the whole point of a single schema list is that the
// in-memory map is exactly these keys no matter how old the data is.
export function mergeWebhooks(slots, saved) {
  const out = defaultWebhooks(slots)
  for (const [slot, value] of Object.entries(saved || {})) {
    if (typeof value !== 'string' || !(slot in out)) continue
    const url = value.trim()
    if (!url) continue
    if (isStaleOurs(slot, url) && out[slot]) continue
    out[slot] = url
  }
  return out
}
