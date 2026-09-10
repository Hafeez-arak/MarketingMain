// ─── Campaign planner constants ────────────────────────────────────────────
// The fixed vocabularies the planner works in — goals, tones, objectives,
// reject reasons, the working week — plus the shape of an empty plan draft.
//
// Split out of CampaignPlanner.jsx so the page file holds behaviour and this
// one holds vocabulary. Two of these are read by the idea card as well, and a
// constant shared between two components in one 2,300-line file is invisible;
// here it is an import.

import { PLATFORM_META } from '../../lib/utils'
import { DEFAULT_BRAND_BRAIN_SECTIONS } from '../../lib/brandBrain'

export const GOALS = ['Brand awareness','Lead generation','Product launch','Community engagement','Event promotion','Sales & offers']
export const PLATFORMS = ['instagram'] // the only platform with a generation pipeline

// Where one idea can be SENT. Distinct from PLATFORMS above, which is where
// ideas can be GENERATED — the plan-generation workflow only speaks Instagram,
// but an asset made by hand in Studio can go anywhere the app publishes.
// Keeping the two lists separate is what lets targets widen without implying a
// generation pipeline that does not exist yet.
//
// Derived from PLATFORM_META rather than restated. The hand-written copy of
// this list held instagram, tiktok and snapchat, and went stale the moment
// LinkedIn was added back — LinkedIn simply could not be chosen as a target,
// with nothing to indicate the option was missing rather than withheld.
export const TARGET_PLATFORMS = Object.entries(PLATFORM_META).map(([id, meta]) => ({
  id,
  label: meta.label,
  cls: `${meta.bg} ${meta.text} ${meta.border}`,
}))
export const targetLabel = id => PLATFORM_META[id]?.label || id

export const IG_TONES = [
  { value: 'professional',  label: 'Professional' },
  { value: 'inspirational', label: 'Inspirational' },
  { value: 'educational',   label: 'Educational' },
  { value: 'casual',        label: 'Casual & Friendly' },
  { value: 'promotional',   label: 'Promotional' },
]

// What a post is FOR — lets the reviewer judge purpose, not just topic.
export const OBJECTIVES = ['Awareness', 'Engagement', 'Sales/Leads', 'Trust/Credibility', 'Community']

// One-tap reject reasons — doubles as training signal for a future learning
// loop, instead of a bare status flip that throws the "why" away.
export const REJECT_REASONS = [
  { value: 'off_brand',     label: 'Off-brand' },
  { value: 'repetitive',    label: 'Repetitive' },
  { value: 'wrong_product', label: 'Wrong product' },
  { value: 'weak_idea',     label: 'Weak idea' },
]
export const rejectReasonLabel = v => REJECT_REASONS.find(r => r.value === v)?.label || v


// Saudi week (Sunday-first); Fri/Sat flagged as the weekend, not disabled —
// plenty of brands post through the weekend, this is just a hint.
export const WEEKDAYS = [
  { value: 'sun', label: 'Sun' }, { value: 'mon', label: 'Mon' }, { value: 'tue', label: 'Tue' },
  { value: 'wed', label: 'Wed' }, { value: 'thu', label: 'Thu' },
  { value: 'fri', label: 'Fri', weekend: true }, { value: 'sat', label: 'Sat', weekend: true },
]

export const DEFAULT_DRAFT = {
  step: 'setup', // 'setup' | 'review' | 'media' | 'done'
  month: '', goal: '', goalCategory: '', platforms: ['instagram'],
  startDate: '', endDate: '', approxCount: '', includeHolidays: true,
  // Cadence: which weekdays this brand actually posts on (empty = AI decides
  // freely, today's behavior) and the default publish time.
  postingDays: [], defaultTime: '19:00',
  // Individually curated posts (below) are the PRIMARY planning surface.
  // AI-proposed filler is an explicit, off-by-default add-on — when false,
  // the AI planner webhook is never even called.
  aiAssist: false,
  brandBrainSections: DEFAULT_BRAND_BRAIN_SECTIONS,
  // Stage-1 brief inputs — all optional. Give the planner real material to
  // work with instead of just a count + a general idea.
  featuredProductIds: [],   // brand_products ids to emphasize this month
  // Freeform target content-mix ratio (e.g. "40% product, 20% educational,
  // 20% trust/testimonials, 20% engagement") — sent as a planner instruction;
  // the board's mix bar shows the ACTUAL breakdown (by content_pillar) next
  // to it so imbalance is visible at a glance, not something you'd only
  // notice by reading every card.
  contentMixTarget: '',
  // Specific posts the user already knows they want, each optionally carrying
  // its own images + generate-vs-use-image choice — set now or refined later
  // on the board (same field, same picker, just a different moment).
  seedPosts: [],            // { text, platform, format, references: [], imageMode: 'generate' }
  name: '', ideas: [], planId: null,
  // What finalize wrote: how many post rows exist, plus anything that needed
  // saying (a caption that couldn't be drafted, a row that wouldn't save).
  // There is no second, asynchronous half to report on any more.
  manualResult: null,
}
