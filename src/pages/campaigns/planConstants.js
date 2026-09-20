// ─── Campaign planner constants ────────────────────────────────────────────
// The fixed vocabularies the planner works in — goals, tones, objectives,
// reject reasons, the working week — plus the shape of an empty plan draft.
//
// Split out of CampaignPlanner.jsx so the page file holds behaviour and this
// one holds vocabulary. Two of these are read by the idea card as well, and a
// constant shared between two components in one 2,300-line file is invisible;
// here it is an import.

import { PLATFORM_META } from '../../lib/utils'
import { PLANNABLE_PLATFORMS } from '../../lib/campaignPlanner'

// What a month is broadly FOR. Sent to the planner as GOAL CATEGORY, so it
// steers the whole slate rather than any one post. The list was six generic
// marketing objectives, which left most real months with nothing that fit —
// a month built around a finished project, a supplier, or a standards change
// had to be filed under "Brand awareness" and lose its shape. It is now the
// categories a B2B brand actually plans in, and OTHER_GOAL lets the month be
// named something that isn't on the list at all rather than mis-filed.
export const GOALS = [
  'Brand awareness',
  'Lead generation',
  'Product launch',
  'Project showcase',
  'Thought leadership',
  'Education & how-to',
  'Trust & social proof',
  'Partner & supplier spotlight',
  'Community engagement',
  'Event promotion',
  'Sales & offers',
  'Recruitment & employer brand',
  'Seasonal & cultural moments',
  'Company news & milestones',
]

// The sentinel the "Focus category" select uses for "none of these". It is
// never stored and never sent — picking it swaps the select for a text box,
// and whatever is typed there becomes the goal category verbatim.
export const OTHER_GOAL = '__other__'

/** True when a saved category is a typed-in one rather than a listed one. */
export function isCustomGoal(value) {
  const v = String(value || '').trim()
  return !!v && !GOALS.includes(v)
}
// Where a plan's ideas can be GENERATED — the platforms the planning and
// caption workflows know how to write for. LinkedIn joined Instagram on
// 2026-09-15; it is still drafts-only (PROTECTED_PLATFORMS), so a LinkedIn
// idea ends as a post in Approvals and never reaches the page from here.
export const PLATFORMS = PLANNABLE_PLATFORMS

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
//
// Beta platforms are left out. Snapchat is still `status:'beta'` — it can't be
// connected or published to — so offering it as a target promised a post that
// would never go anywhere.
export const TARGET_PLATFORMS = Object.entries(PLATFORM_META)
  .filter(([, meta]) => meta.status !== 'beta')
  .map(([id, meta]) => ({
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

// What the AI reads from the Brand Brain unless someone opens the hidden
// picker and changes it. The brand's voice, plus every directory the workspace
// has (added once the schema loads — see CampaignPlanner). Not the Asset
// Library: that block is a list of photo folder names, which told a caption
// writer nothing, and pictures are now chosen directly rather than described.
export const PLANNER_BRAND_SECTIONS = ['voice']

// A selection nobody has touched yet — either this default or the older
// ['voice','assets'] one still sitting in someone's saved draft.
export function isUntouchedSelection(sel = []) {
  return sel.every(k => k === 'voice' || k === 'assets') && sel.includes('voice')
}

export const DEFAULT_DRAFT = {
  // setup → review (ideas only) → media (pictures) → captions → done
  step: 'setup',
  month: '', goal: '', goalCategory: '', platforms: ['instagram'],
  startDate: '', endDate: '', approxCount: '', includeHolidays: true,
  // Cadence: which weekdays this brand actually posts on (empty = any day).
  // There is no default-time field any more — every post starts at
  // DEFAULT_POST_TIME and is confirmed on the captions step.
  postingDays: [],
  // Individually curated posts (below) are the PRIMARY planning surface.
  // AI-proposed filler is an explicit, off-by-default add-on — when false,
  // the AI planner webhook is never even called.
  aiAssist: false,
  brandBrainSections: PLANNER_BRAND_SECTIONS,
  // Stage-1 brief inputs — all optional. Give the planner real material to
  // work with instead of just a count + a general idea.
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
  // Which of the research agent's proposed ideas this month is being built
  // around, by the normalised title ideasFromReport() keys on. Titles rather
  // than ids because a research idea has none — it lives inside the run's
  // report JSON, not a table of its own.
  researchIdeaKeys: [],
  name: '', ideas: [], planId: null,
  // ── A generation run that outlives the request that started it ──────────
  // Plan generation is asynchronous: n8n answers 202 and writes the result
  // onto the plan row minutes later. These two say "there is a run in flight
  // and this is where it will land", which is what lets the page pick the
  // wait back up after a reload, a tab switch, or a navigation away — none of
  // which used to be survivable, because the only handle on a running plan
  // was an open HTTP request.
  generatingPlanId: null,
  generatingMode: 'new',    // 'new' builds the first slate, 'more' tops up
  // What finalize wrote: how many post rows exist, plus anything that needed
  // saying (a caption that couldn't be drafted, a row that wouldn't save).
  // There is no second, asynchronous half to report on any more.
  manualResult: null,
}
