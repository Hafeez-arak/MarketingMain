// ─── Design Suggestion ──────────────────────────────────────────────────────
// A fast, deterministic starting point for "how should this post look" —
// not a generated image, just a pointer toward the right style/aspect ratio
// before the post is actually generated on the Create page. Keyword hints
// from the topic/angle take priority over the tone-based fallback, since
// they're a more specific signal of what the post is actually about.
//
// Style vocabulary matches LIGHTING_STYLES (Instagram) / IMAGE_STYLES
// (LinkedIn) exactly, aside from the one naming difference between the two
// platforms (warm_residential vs warm_interior) which is handled below.

const STYLE_META = {
  photorealistic:   { label: 'Photorealistic',    icon: '📷' },
  dramatic:         { label: 'Dramatic / Moody',  icon: '🎬' },
  minimalist:       { label: 'Minimalist',        icon: '◻️' },
  warm_residential: { label: 'Warm Residential',  icon: '🏠' },
  warm_interior:    { label: 'Warm Interior',     icon: '🏠' },
  cool_commercial:  { label: 'Cool Commercial',   icon: '🏢' },
  facade_exterior:  { label: 'Facade / Exterior', icon: '🌃' },
}

const TONE_STYLE_DEFAULTS = {
  inspirational: 'warm', warm_human: 'warm', casual: 'warm',
  educational: 'minimalist', technical_expert: 'minimalist',
  promotional: 'dramatic',
  professional: 'photorealistic', executive: 'photorealistic', thought_leader: 'photorealistic',
}

export function getStyleMeta(styleKey) {
  return STYLE_META[styleKey] || { label: styleKey || 'Photorealistic', icon: '🎨' }
}

export function getAspectLabel(aspectRatio, platform) {
  const p = platform === 'linkedin' ? 'linkedin' : 'instagram'
  const ratio = aspectRatio || (p === 'linkedin' ? '1.91:1' : '1:1')
  const names = { '1:1': 'Square', '4:5': 'Portrait', '1.91:1': 'Landscape', '9:16': 'Story', '16:9': 'Widescreen' }
  const platformNote = p === 'linkedin' ? 'standard LinkedIn feed crop' : 'standard Instagram feed crop'
  return `${names[ratio] || ratio} (${ratio}) — ${ratio === (p === 'linkedin' ? '1.91:1' : '1:1') ? platformNote : 'alternate crop'}`
}

export function suggestDesign(post) {
  const platform = post?.platform === 'linkedin' ? 'linkedin' : 'instagram'
  const warmKey   = platform === 'linkedin' ? 'warm_interior' : 'warm_residential'
  const text = `${post?.topic || ''} ${post?.angle || ''}`.toLowerCase()

  let style = null
  let tip   = ''

  if (/infographic|breakdown|compare|comparison|\bvs\b|statistic|data point|chart/.test(text)) {
    style = 'minimalist'
    tip = 'Lean into a clean, infographic-style layout — simple icons or a side-by-side comparison will land better than a straight photo here.'
  } else if (/before[\s-]*(and|&)?[\s-]*after|after[\s-]*(and|&)?[\s-]*before|transformation|renovat/.test(text)) {
    style = 'dramatic'
    tip = 'A split or slider-style before/after composition sells this faster than describing it in the caption.'
  } else if (/facade|exterior|landscape lighting|night sky|building exterior/.test(text)) {
    style = 'facade_exterior'
    tip = 'Shoot for dusk or night timing — exterior facade lighting reads strongest against a darkening sky.'
  } else if (/office|commercial|corporate|workplace|productivity|retail|hospital/.test(text)) {
    style = 'cool_commercial'
    tip = 'A crisp, cool-toned commercial space reinforces the workplace/commercial angle better than a warm residential shot.'
  } else if (/hospitality|home|residential|cozy|living room|warm light/.test(text)) {
    style = warmKey
    tip = 'Warm, golden-toned interior shots fit this better than a stark commercial look.'
  }

  if (!style) {
    const fallback = TONE_STYLE_DEFAULTS[post?.tone] || 'photorealistic'
    style = fallback === 'warm' ? warmKey : fallback
    tip = `Defaulting to a style that matches the "${post?.tone || 'default'}" tone — adjust on the Create page if the topic calls for something more specific.`
  }

  const aspectRatio = platform === 'linkedin' ? '1.91:1' : '1:1'
  const aspectLabel = getAspectLabel(aspectRatio, platform)
  const meta = getStyleMeta(style)

  return { style, styleLabel: meta.label, styleIcon: meta.icon, aspectRatio, aspectLabel, tip }
}
