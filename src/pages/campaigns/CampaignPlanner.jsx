import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useApp, actions } from '../../store/app'
import { useAuth } from '../../store/auth'
import { Card, Button, Input, Textarea, Select, Spinner, Toggle, Empty, Modal } from '../../components/ui/index'
import { uid, formatDate } from '../../lib/utils'
import {
  isBrandProfileEmpty, useBrandProfileSync,
  getBrandBrainSections, DEFAULT_BRAND_BRAIN_SECTIONS,
} from '../../lib/brandBrain'
import { buildContext, fetchBrandMemory, logIdeaEvent, logIdeaEvents, ideaSnapshot } from '../../lib/brandContext'
import { fetchBrandSchema, fetchDirectoryRows } from '../../lib/brandSchema'
import { fetchBrandAssets } from '../../lib/brandAssets'
import { requestCampaignPlan, requestPlanContentGeneration, elongateIdea, requestDraftCopy, triggerVideoRenders } from '../../lib/campaignPlanner'
import {
  formatsFor, defaultFormat, aspectRatiosFor, defaultAspectRatio, slideRange, aspectLabel,
  stylesFor, derivePostKind,
} from '../../lib/postFormats'
import { momentsInRange, dbIdeaToDraft } from '../../lib/campaignPlan'
import { ReferencePicker } from '../../components/ReferencePicker'
import {
  createPlan, insertIdeas, updateIdea, setAllIdeaStatus, deleteIdea, updatePlan, markIdeasProcessing,
  fetchPastIdeas, fetchPlanWithIdeas, markIdeasDrafting, fetchIdeaDrafts,
} from '../../lib/contentPlans'
import { IdeaDraftPanel } from '../../components/IdeaDraftPanel'
import { BrandContextPanel } from '../../components/BrandContextPanel'
import { openStudioForIdea, fetchSessionsForIdeas, saveIdeaPlatforms, resetIdeaMedia, publishIdeasAsPosts } from '../../lib/studioBridge'

const GOALS = ['Brand awareness','Lead generation','Product launch','Community engagement','Event promotion','Sales & offers']
const PLATFORMS = ['instagram'] // the only platform with a generation pipeline

// Where one idea can be SENT. Distinct from PLATFORMS above, which is where
// ideas can be GENERATED — the plan-generation workflow only speaks Instagram,
// but an asset made by hand in Studio can go anywhere Zernio publishes. Keeping the two lists separate is what lets targets widen
// without implying a generation pipeline that doesn't exist yet.
const TARGET_PLATFORMS = [
  { id: 'instagram', label: 'Instagram', cls: 'bg-pink-50 text-pink-600 border-pink-100' },
  { id: 'tiktok',    label: 'TikTok',    cls: 'bg-stone-900/5 text-stone-700 border-stone-200' },
  { id: 'snapchat',  label: 'Snapchat',  cls: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
]
const targetLabel = id => TARGET_PLATFORMS.find(p => p.id === id)?.label || id

const IG_TONES = [
  { value: 'professional',  label: 'Professional' },
  { value: 'inspirational', label: 'Inspirational' },
  { value: 'educational',   label: 'Educational' },
  { value: 'casual',        label: 'Casual & Friendly' },
  { value: 'promotional',   label: 'Promotional' },
]

// What a post is FOR — lets the reviewer judge purpose, not just topic.
const OBJECTIVES = ['Awareness', 'Engagement', 'Sales/Leads', 'Trust/Credibility', 'Community']

// One-tap reject reasons — doubles as training signal for a future learning
// loop, instead of a bare status flip that throws the "why" away.
const REJECT_REASONS = [
  { value: 'off_brand',     label: 'Off-brand' },
  { value: 'repetitive',    label: 'Repetitive' },
  { value: 'wrong_product', label: 'Wrong product' },
  { value: 'weak_idea',     label: 'Weak idea' },
]
const rejectReasonLabel = v => REJECT_REASONS.find(r => r.value === v)?.label || v


// Saudi week (Sunday-first); Fri/Sat flagged as the weekend, not disabled —
// plenty of brands post through the weekend, this is just a hint.
const WEEKDAYS = [
  { value: 'sun', label: 'Sun' }, { value: 'mon', label: 'Mon' }, { value: 'tue', label: 'Tue' },
  { value: 'wed', label: 'Wed' }, { value: 'thu', label: 'Thu' },
  { value: 'fri', label: 'Fri', weekend: true }, { value: 'sat', label: 'Sat', weekend: true },
]

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const MONTH_ABBR  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// Client-side mirror of the seasonal moments the n8n planner knows about — used
// only to preview what falls in a chosen month before generating. Kept light;
// the workflow remains the source of truth for the actual plan.
// ── Week grouping for the review list ──
function parseYMD(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
function startOfWeek(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0)
  const day = (x.getDay() + 6) % 7 // Monday-based
  x.setDate(x.getDate() - day)
  return x
}
const fmtDay = d => `${MONTH_ABBR[d.getMonth()]} ${d.getDate()}`
// '19:30' -> '7:30 PM'
function formatTime(hhmm) {
  const [h, m] = (hhmm || '').split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return ''
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}
function groupByWeek(ideas) {
  const groups = new Map()
  const undated = []
  ideas.forEach(i => {
    if (!i.date) { undated.push(i); return }
    const ws = startOfWeek(parseYMD(i.date))
    const key = ws.getTime()
    if (!groups.has(key)) groups.set(key, { start: ws, ideas: [] })
    groups.get(key).ideas.push(i)
  })
  const ordered = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([key, g]) => {
    const end = new Date(g.start); end.setDate(end.getDate() + 6)
    const label = `${fmtDay(g.start)} – ${g.start.getMonth() === end.getMonth() ? end.getDate() : fmtDay(end)}`
    return { key: String(key), label, ideas: g.ideas }
  })
  if (undated.length) ordered.push({ key: 'undated', label: 'Unscheduled', ideas: undated })
  return ordered
}

// Next 6 months as selectable options, each carrying its date range.
function monthOptions() {
  const out = []
  const now = new Date()
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    const y = d.getFullYear(), m = d.getMonth()
    const ym = `${y}-${String(m + 1).padStart(2, '0')}`
    const start = `${ym}-01`
    const end = `${y}-${String(m + 1).padStart(2, '0')}-${String(new Date(y, m + 1, 0).getDate()).padStart(2, '0')}`
    out.push({ value: ym, label: `${MONTH_NAMES[m]} ${y}`, start, end })
  }
  return out
}


// AI-planner-produced ideas only carry the legacy `format`/`suggestedAspectRatio`
// (see requestCampaignPlan's normalizer in campaignPlanner.js) — translate
// those into the new format/aspectRatio/mediaType/postKind fields before
// they're ever saved, the same way a human-entered seed post already does.
function normalizeAiIdea(p) {
  const legacyFormat = p.format || 'post'
  const postFormat = legacyFormat === 'carousel' ? 'carousel'
    : (legacyFormat === 'reel' && p.platform === 'instagram') ? 'reel'
    : defaultFormat(p.platform)
  const mediaType = formatsFor(p.platform).find(f => f.id === postFormat)?.media || 'image'
  const validRatios = aspectRatiosFor(p.platform, postFormat)
  const aspectRatio = validRatios.includes(p.suggestedAspectRatio) ? p.suggestedAspectRatio : defaultAspectRatio(p.platform, postFormat)
  const slideCount = postFormat === 'carousel' ? (slideRange(p.platform, postFormat)?.default || 3) : 1
  return {
    ...p, postFormat, aspectRatio, mediaType, slideCount, wantsCaption: true,
    postKind: derivePostKind({ platform: p.platform, format: postFormat, wantsCaption: true, slideCount }),
  }
}

const DEFAULT_DRAFT = {
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
  name: '', ideas: [], planId: null, pushResult: null,
  // What the manual half of finalize did, when there was one. Separate from
  // pushResult because the two halves succeed and fail independently.
  manualResult: null,
}

function useDraft() {
  const { state, dispatch } = useApp()
  // Merge over DEFAULT_DRAFT (not a plain `||` fallback) so an older persisted
  // draft missing newer fields (e.g. ideas, planId) can't leave them undefined.
  const draft = { ...DEFAULT_DRAFT, ...(state.campaignPlanDraft || {}) }
  // Patches merge against the CURRENT draft, not the one this render captured.
  // handleGeneratePlan sets step:'review' and then kicks off drafting, which
  // updates `ideas` — two dispatches from one render. Spreading the captured
  // `draft` here made the second one carry step:'setup' along with it and undo
  // the first, which is why a plan could be created successfully and still
  // leave the user sitting on the form. See the reducer for the full story.
  const update = patch => dispatch(actions.setCampaignPlanDraft(
    prev => ({ ...DEFAULT_DRAFT, ...(prev || {}), ...patch }),
  ))
  const clear  = () => dispatch(actions.setCampaignPlanDraft(null))
  return { draft, update, clear, state, dispatch }
}

const OCCASION_STYLE = 'bg-amber-100 text-amber-800 border-amber-200'
const PILLAR_STYLE   = 'bg-purple-50 text-purple-700 border-purple-100'
const OWN_COPY_STYLE = 'bg-sage-100 text-sage-700 border-sage-200'
const STATUS_META = {
  proposed: { label: 'Proposed', cls: 'bg-stone-100 text-stone-600' },
  approved: { label: 'Approved', cls: 'bg-sage-100 text-sage-700' },
  rejected: { label: 'Rejected', cls: 'bg-red-50 text-red-500 line-through' },
}

// ─── One idea in the review list, with inline approve/reject + edit ─────────
function IdeaCard({ idea, index, accessToken, workspaceId, onChange, onRemove, onCreate, onRedraft, onOpenStudio, studioSession, mediaOptionsUrl, brandName = '', autoEdit = false }) {
  const [redrafting, setRedrafting] = useState(false)
  const [editing, setEditing] = useState(autoEdit)
  const [saving,  setSaving]  = useState(false)
  const [saveError, setSaveError] = useState('')
  const [showRejectReasons, setShowRejectReasons] = useState(false)
  const [showTargets, setShowTargets] = useState(false)
  const [openingStudio, setOpeningStudio] = useState(false)
  const [pickingRefs, setPickingRefs] = useState(false)
  const [imgMode, setImgMode] = useState(idea.imageMode || 'generate')
  const tones = IG_TONES
  const refCount = (idea.references || []).length
  const usingImage = idea.imageMode === 'use_reference'
  const usingStudio = idea.imageMode === 'studio'
  const targets = idea.platforms?.length ? idea.platforms : [idea.platform]

  // Toggle one target. The primary platform can't be removed — it's what the
  // format catalog, the tone list and every generation workflow read, so an
  // idea with it deselected would be describing two different things.
  async function toggleTarget(id) {
    if (id === idea.platform) return
    const next = targets.includes(id) ? targets.filter(t => t !== id) : [...targets, id]
    const result = await saveIdeaPlatforms(accessToken, idea.id, next, idea.platform)
    if (result.ok) onChange({ ...idea, platforms: result.platforms })
  }

  async function handleOpenStudio() {
    setOpeningStudio(true)
    await onOpenStudio(idea)
    setOpeningStudio(false)
  }

  // Persist both the chosen images and the AI-vs-use-image mode together, so
  // the card and generation always agree on how this idea's image is produced.
  async function saveReferences(urls) {
    const result = await updateIdea(accessToken, idea.id, { reference_image_urls: urls, image_mode: imgMode })
    if (result.ok) { onChange({ ...idea, references: urls, imageMode: imgMode }); setPickingRefs(false); return { ok: true } }
    return { error: result.error || 'Could not save.' }
  }
  // 'studio' normalises to 'generate' on the way into the picker: the picker
  // only knows the AI-vs-use-an-image choice, and showing it a third value it
  // can't represent would save that value straight back on close. Choosing in
  // here is also how you deliberately move an idea OFF studio mode.
  function openImagePicker() {
    setImgMode(idea.imageMode === 'use_reference' ? 'use_reference' : 'generate')
    setPickingRefs(true)
  }


  async function setStatus(status, rejectReason = '') {
    setSaving(true)
    // Approving (or re-approving after a rejection) clears any old reason —
    // it shouldn't linger once the idea is no longer rejected.
    const result = await updateIdea(accessToken, idea.id, { status, reject_reason: rejectReason })
    setSaving(false)
    if (result.ok) {
      onChange({ ...idea, status, rejectReason })
      // Append-only decision log. plan_ideas is overwritten in place, so
      // without this the fact that an idea was rejected — and for what
      // reason — is lost the moment anyone re-approves or edits it. This is
      // the raw material the learning loop reads.
      logIdeaEvent(workspaceId, accessToken, {
        planId: idea.planId, ideaId: idea.id,
        event: status === 'rejected' ? 'rejected' : status === 'approved' ? 'approved' : 'edited',
        reason: rejectReason,
        before: { status: idea.status }, after: ideaSnapshot({ ...idea, status }),
      })
    }
  }

  async function saveEdits(patch) {
    setSaving(true)
    // A card created via "+ Add idea" isn't in the database yet — it only
    // gets written on Save, so Cancel can discard it with zero backend trace.
    if (idea.isNew) {
      const result = await onCreate(idea, patch)
      setSaving(false)
      if (result.ok) setEditing(false)
      else setSaveError(result.error || 'Could not save idea.')
      return
    }
    const dbPatch = {
      topic: patch.topic, angle: patch.angle, tone: patch.tone,
      scheduled_date: patch.date || null, publish_time: patch.time || '',
      suggested_style: patch.suggestedStyle || '', image_idea: patch.imageIdea || '',
      objective: patch.objective || '', cta: patch.cta || '',
      hashtags: patch.hashtags || '', first_comment: patch.firstComment || '',
      series: patch.series || '',
      // Format & orientation — the human-editable fields; post_kind stays
      // derived (see postFormats.js#derivePostKind) so it can never drift
      // from format/wants_caption/image_text into a nonsensical combination.
      format: patch.postFormat, aspect_ratio: patch.aspectRatio, media_type: patch.mediaType,
      wants_caption: patch.wantsCaption !== false,
      post_kind: patch.postKind || 'caption_image',
      slide_count: patch.slideCount || 1,
      image_text: patch.imageText || '',
      // Whose words go out, and the words themselves when they're the
      // operator's. Written together so the mode can never disagree with the
      // caption it describes.
      copy_mode: patch.copyMode === 'own' ? 'own' : 'ai',
      caption_en: patch.captionEn || '',
      caption_ar: patch.captionAr || '',
    }
    const result = await updateIdea(accessToken, idea.id, dbPatch)
    setSaving(false)
    if (result.ok) {
      const before = ideaSnapshot(idea)
      const after  = ideaSnapshot({ ...idea, ...patch })
      onChange({ ...idea, ...patch }); setEditing(false)
      // What a human changed about an AI's suggestion is the single most
      // direct signal of where the brief was wrong — worth more than the
      // final text on its own, which is why both sides are stored.
      logIdeaEvent(workspaceId, accessToken, {
        planId: idea.planId, ideaId: idea.id, event: 'edited', before, after,
      })
    }
  }

  const st = STATUS_META[idea.status] || STATUS_META.proposed
  const rejected = idea.status === 'rejected'

  return (
    <div className={`rounded-2xl border transition-all ${rejected ? 'border-border bg-surface-subtle opacity-70' : idea.status === 'approved' ? 'border-sage-200 bg-sage-50/30' : 'border-border bg-white'}`}>
      <div className="p-4">
        <div className="flex items-start gap-3">
          <span className="text-[11px] font-bold text-text-disabled w-5 flex-shrink-0 text-right pt-0.5">{index + 1}</span>
          <div className="flex-1 min-w-0">
            {/* Badges */}
            <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
              <span className="text-[10px] font-bold px-1.5 py-0.5 leading-[1.4] bg-pink-50 text-pink-600">
                Instagram
              </span>
              {/* Extra targets only — the primary is already the badge above,
                  and repeating it reads as a duplicate rather than a set. */}
              {targets.filter(t => t !== idea.platform).map(t => (
                <span key={t} className={`text-[10px] font-bold px-1.5 py-0.5 leading-[1.4] border ${TARGET_PLATFORMS.find(p => p.id === t)?.cls || 'bg-surface-subtle text-text-secondary border-border'}`}
                  title="Also publishing here — one render covers every 9:16 target">
                  +{targetLabel(t)}
                </span>
              ))}
              {/* Which ideas are the operator's own words. Without this the
                  board looks identical either way, and the difference — who
                  writes the caption — is the one thing that cannot be undone
                  once the plan is finalised. */}
              {idea.copyMode === 'own' && <span className={`text-[10px] font-semibold px-1.5 py-0.5 leading-[1.4] border ${OWN_COPY_STYLE}`}>✎ My words</span>}
              {idea.occasion && <span className={`text-[10px] font-semibold px-1.5 py-0.5 leading-[1.4] border ${OCCASION_STYLE}`}>★ {idea.occasion}</span>}
              {idea.pillar && <span className={`text-[10px] font-medium px-1.5 py-0.5 leading-[1.4] border ${PILLAR_STYLE}`}>{idea.pillar}</span>}
              {idea.series && <span className="text-[10px] font-semibold px-1.5 py-0.5 leading-[1.4] border bg-violet-50 text-violet-700 border-violet-100" title="Deliberate recurring series — not flagged as repetition across months">🔁 {idea.series}</span>}
              {idea.objective && <span className="text-[10px] font-medium px-1.5 py-0.5 leading-[1.4] border bg-sky-50 text-sky-700 border-sky-100">{idea.objective}</span>}
              <span className="text-[10px] font-medium px-1.5 py-0.5 leading-[1.4] border bg-indigo-50 text-indigo-700 border-indigo-100">
                {formatsFor(idea.platform).find(f => f.id === idea.postFormat)?.label || 'Feed image'}
                {idea.aspectRatio ? ` · ${aspectLabel(idea.aspectRatio)}` : ''}
                {(idea.postFormat === 'carousel' || idea.postFormat === 'photo_carousel') && idea.slideCount > 1 ? ` ·${idea.slideCount}` : ''}
                {idea.wantsCaption === false ? ' · no caption' : ''}
              </span>
              <span className="text-[10px] text-text-tertiary">{idea.date ? formatDate(idea.date) : 'No date'}{idea.time ? ` · ${formatTime(idea.time)}` : ''}</span>
              {idea.imageIdea && !usingImage && <span className="text-[10px] font-semibold text-purple-600" title={idea.imageIdea}>· 🎨 your vision</span>}
              {usingImage
                ? <span className="text-[10px] font-semibold text-sage-700">· 🖼 using {refCount || 'no'} image{refCount !== 1 ? 's' : ''}</span>
                : refCount > 0 && <span className="text-[10px] font-semibold text-amber-700">· 📎 {refCount} ref{refCount !== 1 ? 's' : ''}</span>}
              {usingStudio && (
                <span className="text-[10px] font-semibold text-violet-700"
                  title="A human is making this one in Creative Studio — plan generation will not pay for an image for it">
                  · 🎬 {studioSession ? 'in Studio' : 'Studio'}
                </span>
              )}
            </div>
            {/* Title / topic */}
            <p className="text-sm font-semibold text-text leading-snug">{idea.title || idea.topic || 'Untitled idea'}</p>
            {idea.topic && idea.topic !== idea.title && <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">{idea.topic}</p>}
            {idea.rationale && (
              <p className="text-[11px] text-text-tertiary mt-1.5 leading-relaxed"><span className="font-semibold text-text-secondary">Why:</span> {idea.rationale}</p>
            )}
            {idea.cta && (
              <p className="text-[11px] text-sky-700 mt-1 leading-relaxed"><span className="font-semibold">CTA:</span> {idea.cta}</p>
            )}
            {rejected && idea.rejectReason && (
              <p className="text-[11px] text-red-500 mt-1 leading-relaxed"><span className="font-semibold">Rejected:</span> {rejectReasonLabel(idea.rejectReason)}</p>
            )}
          </div>
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 leading-[1.4] flex-shrink-0 ${st.cls}`}>{st.label}</span>
        </div>

        <IdeaDraftPanel idea={idea} accessToken={accessToken} workspaceId={workspaceId} mediaOptionsUrl={mediaOptionsUrl}
          brandName={brandName} onIdeaChange={onChange} redrafting={redrafting}
          onRedraft={async () => { setRedrafting(true); await onRedraft(idea); setRedrafting(false) }} />

        {/* Actions — Reject reveals one-tap reason chips instead of rejecting blind */}
        {showRejectReasons ? (
          <div className="flex items-center gap-1.5 mt-3 pl-8 flex-wrap">
            <span className="text-[11px] text-text-tertiary mr-1">Why?</span>
            {REJECT_REASONS.map(r => (
              <button key={r.value} onClick={() => { setShowRejectReasons(false); setStatus('rejected', r.value) }}
                className="text-[11px] font-medium px-2.5 py-1 rounded-lg border border-border text-text-secondary hover:border-red-300 hover:text-red-600 hover:bg-red-50 transition-colors">
                {r.label}
              </button>
            ))}
            <button onClick={() => setShowRejectReasons(false)} className="text-[11px] text-text-tertiary hover:text-text ml-1">Cancel</button>
          </div>
        ) : showTargets ? (
          <div className="flex items-center gap-1.5 mt-3 pl-8 flex-wrap">
            <span className="text-[11px] text-text-tertiary mr-1">Publish to?</span>
            {TARGET_PLATFORMS.map(p => {
              const on = targets.includes(p.id)
              const locked = p.id === idea.platform
              return (
                <button key={p.id} onClick={() => toggleTarget(p.id)} disabled={locked}
                  title={locked ? 'The idea’s primary platform — it sets the format and tone, so it can’t be removed here' : ''}
                  className={`text-[11px] font-medium px-2.5 py-1 rounded-lg border transition-colors ${on ? p.cls : 'border-border text-text-secondary hover:border-text-tertiary'} ${locked ? 'opacity-100 cursor-default' : ''}`}>
                  {on ? '✓ ' : ''}{p.label}{locked ? ' ·' : ''}
                </button>
              )
            })}
            <button onClick={() => setShowTargets(false)} className="text-[11px] text-text-tertiary hover:text-text ml-1">Done</button>
          </div>
        ) : (
        <div className="flex items-center gap-2 mt-3 pl-8">
          <button onClick={() => setStatus('approved')} disabled={saving || idea.isNew || idea.status === 'approved'}
            className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-colors ${idea.status === 'approved' ? 'bg-sage-100 text-sage-700 border-sage-200' : 'border-border text-text-secondary hover:border-sage-300 hover:text-sage-700 hover:bg-sage-50'}`}>
            ✓ Approve
          </button>
          <button onClick={() => setShowRejectReasons(true)} disabled={saving || idea.isNew || idea.status === 'rejected'}
            className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-colors ${idea.status === 'rejected' ? 'bg-red-50 text-red-500 border-red-200' : 'border-border text-text-secondary hover:border-red-200 hover:text-red-500 hover:bg-red-50'}`}>
            ✕ Reject
          </button>
          {!idea.isNew && <button onClick={() => setEditing(true)} className="text-[11px] font-medium px-2.5 py-1 rounded-lg text-text-tertiary hover:text-text hover:bg-surface-subtle transition-colors">Edit</button>}
          {!idea.isNew && (
            <button onClick={openImagePicker}
              className={`text-[11px] font-medium px-2.5 py-1 rounded-lg transition-colors ${usingImage ? 'text-sage-700 bg-sage-50 hover:bg-sage-100' : refCount > 0 ? 'text-amber-700 bg-amber-50 hover:bg-amber-100' : 'text-text-tertiary hover:text-text hover:bg-surface-subtle'}`}>
              {usingImage ? '🖼 Image set' : refCount > 0 ? `📎 Image (${refCount})` : '🖼 Image'}
            </button>
          )}
          {!idea.isNew && (
            <button onClick={handleOpenStudio} disabled={openingStudio}
              title={studioSession
                ? 'Reopen this idea’s Creative Studio session — nothing already generated is lost'
                : 'Make this one by hand in Creative Studio. The prompt, format and aspect ratio are pre-filled from this idea, and plan generation stops paying for an image for it.'}
              className={`text-[11px] font-medium px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50 ${usingStudio ? 'text-violet-700 bg-violet-50 hover:bg-violet-100' : 'text-text-tertiary hover:text-text hover:bg-surface-subtle'}`}>
              {openingStudio ? <><Spinner size="sm" /> Opening…</> : studioSession ? '🎬 Reopen Studio' : '🎬 Make in Studio'}
            </button>
          )}
          {!idea.isNew && (
            <button onClick={() => setShowTargets(true)}
              title="Which platforms this post goes to. Pick them before generating — one 9:16 render covers Reel, TikTok and Spotlight."
              className={`text-[11px] font-medium px-2.5 py-1 rounded-lg transition-colors ${targets.length > 1 ? 'text-sky-700 bg-sky-50 hover:bg-sky-100' : 'text-text-tertiary hover:text-text hover:bg-surface-subtle'}`}>
              🎯 {targets.length > 1 ? `${targets.length} platforms` : 'Targets'}
            </button>
          )}
          <button onClick={() => onRemove(idea)} className="text-[11px] font-medium px-2.5 py-1 rounded-lg text-text-tertiary hover:text-red-500 transition-colors ml-auto">
            {idea.isNew ? 'Discard' : 'Delete'}
          </button>
        </div>
        )}
      </div>

      {editing && (
        <IdeaEditModal idea={idea} tones={tones} saving={saving} saveError={saveError}
          onClose={() => { if (idea.isNew) onRemove(idea); else setEditing(false) }} onSave={saveEdits} />
      )}
      {pickingRefs && (
        <ReferencePicker value={idea.references || []} onSave={saveReferences} onClose={() => setPickingRefs(false)}
          mode={imgMode} onModeChange={setImgMode} format={idea.postFormat} />
      )}
    </div>
  )
}

function IdeaEditModal({ idea, tones, saving, saveError, onClose, onSave }) {
  const [topic,     setTopic]     = useState(idea.topic || '')
  const [angle,     setAngle]     = useState(idea.angle || '')
  const [tone,      setTone]      = useState(idea.tone || tones[0].value)
  const [date,      setDate]      = useState(idea.date || '')
  const [time,      setTime]      = useState(idea.time || '')
  const [style,     setStyle]     = useState(idea.suggestedStyle || '')
  const [imageIdea, setImageIdea] = useState(idea.imageIdea || '')
  const [objective, setObjective] = useState(idea.objective || '')
  const [cta,       setCta]       = useState(idea.cta || '')
  const [hashtags,  setHashtags]  = useState(idea.hashtags || '')
  const [firstComment, setFirstComment] = useState(idea.firstComment || '')
  const [series, setSeries] = useState(idea.series || '')
  // Whose words go out. 'own' means the two caption boxes below are the post,
  // verbatim — finalize writes the row itself rather than briefing the AI
  // writer. See 20260815_manual_copy_mode.sql.
  const [copyMode, setCopyMode] = useState(idea.copyMode === 'own' ? 'own' : 'ai')
  const [captionEn, setCaptionEn] = useState(idea.captionEn || '')
  const [captionAr, setCaptionAr] = useState(idea.captionAr || '')

  // Format drives orientation and slide count from the catalog — pick a
  // format, only the orientations/slide range it actually supports show up.
  const [postFormat, setPostFormat] = useState(idea.postFormat || defaultFormat(idea.platform))
  const [aspectRatio, setAspectRatio] = useState(idea.aspectRatio || defaultAspectRatio(idea.platform, postFormat))
  const [slideCount, setSlideCount] = useState(idea.slideCount || slideRange(idea.platform, postFormat)?.default || 3)
  // Caption inclusion and "bake text into the image" are separate decisions
  // from format — a reel can be captionless, a feed image can be caption+text.
  const [wantsCaption, setWantsCaption] = useState(idea.wantsCaption !== false)
  const [imageText, setImageText] = useState(idea.imageText || '')

  const formats = formatsFor(idea.platform)
  const currentFormat = formats.find(f => f.id === postFormat) || formats[0]
  const isImage = currentFormat?.media === 'image'
  const isVideo = currentFormat?.media === 'video'
  const showsMediaFields = currentFormat?.media !== 'none'
  const ratios = aspectRatiosFor(idea.platform, postFormat)
  const slides = slideRange(idea.platform, postFormat)
  const styles = stylesFor(idea.platform)

  // "Post type" and "image source" (AI-generated vs your own upload, set via
  // the 🖼 Image button) are two separate decisions. Baking text into the
  // image is meaningless once the image is already your own fixed photo.
  const usingOwnImage = idea.imageMode === 'use_reference' && (idea.references || []).length > 0

  function onFormatChange(fmt) {
    setPostFormat(fmt)
    setAspectRatio(defaultAspectRatio(idea.platform, fmt))
    const s = slideRange(idea.platform, fmt)
    if (s) setSlideCount(s.default)
  }

  const derivedKind = derivePostKind({ platform: idea.platform, format: postFormat, wantsCaption, imageText, slideCount })
  const kindHint = !showsMediaFields
    ? 'Text only — no image or video.'
    : currentFormat.id === 'carousel' || currentFormat.id === 'photo_carousel'
      ? `A caption${wantsCaption ? '' : '-free'} carousel of ${slideCount} slides.`
      : isVideo
        ? `A ${wantsCaption ? 'captioned' : 'caption-free'} video post.`
        : `A ${wantsCaption ? 'captioned' : 'caption-free'} single image post.`

  return (
    <Modal open onClose={onClose} title={idea.isNew ? 'Add idea' : 'Edit idea'} width="max-w-xl">
      <div className="p-6 space-y-4">
        <Input label="Topic / what the post is about" value={topic} onChange={e => setTopic(e.target.value)} />
        <Textarea label="Angle (optional)" rows={2} value={angle} onChange={e => setAngle(e.target.value)} />

        {/* Format + orientation drive the whole flow — media type, slide
            count, and (via derivePostKind) what the generation engine does. */}
        <div className="grid grid-cols-2 gap-3">
          <Select label="Format" value={postFormat} onChange={e => onFormatChange(e.target.value)}>
            {formats.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
          </Select>
          {ratios.length > 1 ? (
            <Select label="Orientation" value={aspectRatio} onChange={e => setAspectRatio(e.target.value)}>
              {ratios.map(r => <option key={r} value={r}>{aspectLabel(r)} ({r})</option>)}
            </Select>
          ) : ratios.length === 1 ? (
            <div>
              <p className="text-xs font-medium text-text-secondary mb-1.5">Orientation</p>
              <p className="text-sm text-text-tertiary px-3 py-2 rounded-lg bg-surface-subtle border border-border">{aspectLabel(ratios[0])} ({ratios[0]})</p>
            </div>
          ) : null}
        </div>
        <p className="text-[11px] text-text-tertiary -mt-2">{kindHint}</p>
        {usingOwnImage && showsMediaFields && (
          <p className="text-[11px] text-sage-700">
            📎 You've attached your own image for this post — no AI image generation will happen.
          </p>
        )}

        {slides && (
          <Input label="How many slides?" type="number" min={slides.min} max={slides.max}
            value={slideCount} onChange={e => setSlideCount(Number(e.target.value) || slides.default)} />
        )}

        {showsMediaFields && (
          <Toggle checked={wantsCaption} onChange={e => setWantsCaption(e.target.checked)}
            label="Include a caption with this post" />
        )}

        {isImage && !usingOwnImage && (
          <Input label="Text to feature in the image (optional)"
            placeholder="e.g. رمضان كريم  ·  or  ·  40% OFF this week"
            value={imageText} onChange={e => setImageText(e.target.value)} />
        )}

        {/* Media direction — hidden for text-only posts. */}
        {showsMediaFields && (
          <Textarea
            label={isVideo ? 'Your vision for the video (optional)' : 'Your vision for the image (optional)'}
            rows={2}
            placeholder="Describe what you're imagining — e.g. 'warm evening shot of a linear pendant over a majlis seating area, shot low, cozy glow.' Leave blank to let AI decide."
            value={imageIdea} onChange={e => setImageIdea(e.target.value)}
          />
        )}

        <div className="grid grid-cols-2 gap-3">
          <Input label="Date" type="date" value={date} onChange={e => setDate(e.target.value)} />
          <Input label="Time" type="time" value={time} onChange={e => setTime(e.target.value)} />
          <Select label="Tone" value={tone} onChange={e => setTone(e.target.value)}>
            {tones.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
          <Select label="Objective" value={objective} onChange={e => setObjective(e.target.value)}>
            <option value="">Not set</option>
            {OBJECTIVES.map(o => <option key={o} value={o}>{o}</option>)}
          </Select>
          {showsMediaFields && (
            <Select label="Visual style" value={style} onChange={e => setStyle(e.target.value)}>
              <option value="">AI decides</option>
              {styles.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select>
          )}
        </div>

        {/* ── Who writes the caption ──
            The single question that decides whether this idea ever touches a
            model. Everything above it (topic, angle, tone, objective) is a
            BRIEF — material for the AI writer — and is simply unused when the
            words are already written, which is why the brief fields stay put
            rather than being hidden: they still describe the post for the
            board, the mix bar and cross-month history. */}
        <div className="rounded-xl border border-border p-3 space-y-2.5">
          <p className="text-xs font-medium text-text-secondary">Who writes the caption?</p>
          <div className="flex gap-2">
            {[
              { id: 'ai',  label: 'AI writes it',   hint: 'Generated from the brief above' },
              { id: 'own', label: "I'll write it",  hint: 'Posted exactly as typed' },
            ].map(o => (
              <button key={o.id} onClick={() => setCopyMode(o.id)}
                className={`flex-1 text-left px-3 py-2 rounded-xl border transition-all ${
                  copyMode === o.id
                    ? 'bg-amber-600 text-white border-amber-600'
                    : 'bg-white border-border text-text-secondary hover:border-amber-400'}`}>
                <span className="block text-sm font-medium">{o.label}</span>
                <span className={`block text-[10px] leading-snug mt-0.5 ${copyMode === o.id ? 'opacity-80' : 'text-text-tertiary'}`}>{o.hint}</span>
              </button>
            ))}
          </div>
          {copyMode === 'own' && (
            <>
              <Textarea
                rows={4} autoGrow
                label="Your caption"
                placeholder="Type the post exactly as it should go out."
                value={captionEn} onChange={e => setCaptionEn(e.target.value)}
              />
              {/* Arabic gets its own box rather than being detected from the
                  text: this brand posts bilingually, and a single field would
                  force a choice between the two that publishing doesn't make. */}
              <Textarea
                rows={3} autoGrow dir="rtl"
                label="Arabic caption (optional)"
                placeholder="النص العربي كما سيُنشر"
                value={captionAr} onChange={e => setCaptionAr(e.target.value)}
              />
              <p className="text-[11px] text-text-tertiary">
                Nothing rewrites this. Finalising the plan turns it straight into a post for review —
                no generation webhook involved.
              </p>
            </>
          )}
        </div>

        <Input
          label="Call-to-action (optional)"
          placeholder="e.g. DM us for a quote"
          value={cta} onChange={e => setCta(e.target.value)}
        />

        <Input
          label="Hashtags (optional)"
          placeholder="e.g. #ArakLighting #تصميم_اضاءة #LightingDesign — leave blank to let AI choose"
          value={hashtags} onChange={e => setHashtags(e.target.value)}
        />
        <Input
          label="First comment (optional)"
          placeholder="e.g. Tag a friend planning their villa lighting 💡"
          value={firstComment} onChange={e => setFirstComment(e.target.value)}
        />
        <Input
          label="Recurring series (optional)"
          placeholder="e.g. Tip Tuesday — marks this as a deliberate repeat format, not a duplicate"
          value={series} onChange={e => setSeries(e.target.value)}
        />

        {saveError && <p className="text-xs text-red-600">{saveError}</p>}
        <div className="flex justify-end gap-3 pt-1">
          <Button variant="secondary" onClick={onClose}>{idea.isNew ? 'Discard' : 'Cancel'}</Button>
          <Button onClick={() => onSave({
            topic, angle, tone, date, time, suggestedStyle: style, imageIdea, objective, cta, hashtags, firstComment, series,
            postFormat, aspectRatio, mediaType: currentFormat?.media || 'image', wantsCaption, imageText, slideCount,
            postKind: derivedKind,
            // Trimmed on the way out so a box left with only whitespace can't
            // make an idea look manually written when there is nothing to post.
            copyMode, captionEn: captionEn.trim(), captionAr: captionAr.trim(),
          })} disabled={saving || (idea.isNew && !topic.trim()) || (copyMode === 'own' && !captionEn.trim() && !captionAr.trim())}>
            {saving ? <><Spinner size="sm" /> Saving…</> : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── "Generate more ideas" — AI top-up on an existing plan ─────────────────
// Reuses the same campaign-planner webhook as the initial generation, but
// also sends the ideas already in the plan so the workflow can avoid
// proposing duplicates. See onClose comment on why we don't just reopen the
// setup step: the plan already exists, we're appending to it, not restarting.
function GenerateMoreModal({ defaultCount, loading, error, onClose, onGenerate }) {
  const [count, setCount] = useState(String(defaultCount))
  const [focus, setFocus] = useState('')

  return (
    <Modal open onClose={onClose} title="Generate more ideas" width="max-w-xl">
      <div className="p-6 space-y-4">
        <p className="text-xs text-text-secondary leading-relaxed">
          Adds more AI-proposed ideas on top of what's already here — useful after rejecting or deleting a few.
          The AI is shown your existing ideas so it won't repeat them.
        </p>
        <Input label="How many more?" type="number" min="1" max="20" value={count} onChange={e => setCount(e.target.value)} />
        <Textarea
          label="Extra focus for this batch (optional)"
          placeholder="Leave blank to keep filling out the month, or steer just this batch — e.g. 'More educational content this time.'"
          value={focus} onChange={e => setFocus(e.target.value)} rows={3}
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-3 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={() => onGenerate({ count: Number(count) || defaultCount, focus })} disabled={loading}>
            {loading ? <><Spinner size="sm" /> Generating…</> : 'Generate'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Month calendar overview ────────────────────────────────────────────────
// A navigation aid, not a second approve/reject surface: clicking a day just
// filters the existing card list to that day (see dayFilter in the main
// component) so all approve/edit/delete logic stays in one place (IdeaCard).
function buildCalendarCells(startDate, endDate) {
  if (!startDate || !endDate) return []
  const start = parseYMD(startDate)
  const end = parseYMD(endDate)
  const gridStart = new Date(start); gridStart.setDate(gridStart.getDate() - gridStart.getDay())
  const gridEnd = new Date(end); gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()))
  const cells = []
  const cur = new Date(gridStart)
  while (cur <= gridEnd) {
    const y = cur.getFullYear(), m = cur.getMonth(), d = cur.getDate()
    const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    cells.push({ key, date: new Date(cur), inRange: key >= startDate && key <= endDate })
    cur.setDate(cur.getDate() + 1)
  }
  return cells
}

function CalendarView({ ideas, startDate, endDate, selectedDay, onDayClick }) {
  const cells = buildCalendarCells(startDate, endDate)
  const byDate = new Map()
  ideas.forEach(i => {
    if (!i.date) return
    if (!byDate.has(i.date)) byDate.set(i.date, [])
    byDate.get(i.date).push(i)
  })
  const weeks = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  return (
    <div className="rounded-2xl border border-border bg-white overflow-hidden">
      <div className="grid grid-cols-7 border-b border-border bg-surface-subtle">
        {WEEKDAYS.map(d => (
          <div key={d.value} className={`px-2 py-2 text-[10px] font-bold text-center uppercase tracking-wide ${d.weekend ? 'text-amber-700' : 'text-text-tertiary'}`}>{d.label}</div>
        ))}
      </div>
      <div>
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 divide-x divide-border border-b border-border last:border-b-0">
            {week.map(cell => {
              const dayIdeas = byDate.get(cell.key) || []
              const isSelected = cell.key === selectedDay
              return (
                <button key={cell.key} onClick={() => dayIdeas.length && onDayClick(cell.key)}
                  disabled={!dayIdeas.length}
                  className={`min-h-[84px] p-1.5 text-left align-top transition-colors ${cell.inRange ? 'bg-white' : 'bg-stone-50/60'} ${isSelected ? 'ring-2 ring-inset ring-amber-400' : ''} ${dayIdeas.length ? 'hover:bg-amber-50/40 cursor-pointer' : 'cursor-default'}`}>
                  <div className="flex items-center justify-between">
                    <span className={`text-[11px] font-semibold ${cell.inRange ? 'text-text' : 'text-text-disabled'}`}>{cell.date.getDate()}</span>
                    {dayIdeas.some(i => i.occasion) && <span className="text-[10px]">★</span>}
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {dayIdeas.slice(0, 3).map(i => (
                      <div key={i.id} className={`text-[9px] px-1 py-0.5 rounded truncate border-l-2 ${i.status === 'approved' ? 'border-sage-400 bg-sage-50 text-sage-700' : i.status === 'rejected' ? 'border-red-300 bg-red-50 text-red-500 line-through' : 'border-stone-300 bg-stone-50 text-text-secondary'}`}>
                        📷 {i.title || i.topic || 'Untitled'}
                      </div>
                    ))}
                    {dayIdeas.length > 3 && <div className="text-[9px] text-text-tertiary px-1">+{dayIdeas.length - 3} more</div>}
                  </div>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main planner ───────────────────────────────────────────────────────────
export function CampaignPlanner() {
  const { draft, update, clear, state, dispatch } = useDraft()
  const navigate = useNavigate()
  const { activeWorkspaceId, accessToken, activeWorkspace } = useAuth()
  const webhookUrl = state.webhooks?.campaignPlanner || ''
  useBrandProfileSync(state, dispatch)

  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [busy,    setBusy]    = useState(false)

  // Directory data behind the Brand Brain section toggles — fetched once so
  // the setup step can show live counts and plan generation can pull from it.
  // Which directories exist is per-brand now (Arak has Suppliers, Aqeeq has a
  // Service Menu, Alo Kheyatah has Alterations), so this loads the workspace's
  // own schema rather than four fixed tables.
  const [directory, setDirectory] = useState({
    schema: { sections: [], fields: [], columns: [] }, rowsBySection: {}, assets: [],
  })
  // Active learned rules for this brand. Fetched alongside the schema because
  // every context build needs them, and an extra round-trip per generation
  // would be paid on a list that changes maybe weekly.
  const [brandMemory, setBrandMemory] = useState([])
  useEffect(() => {
    if (!activeWorkspaceId) return
    let alive = true
    Promise.all([
      fetchBrandSchema(activeWorkspaceId, accessToken),
      fetchDirectoryRows(activeWorkspaceId, accessToken),
      fetchBrandAssets(activeWorkspaceId, accessToken),
      fetchBrandMemory(activeWorkspaceId, accessToken),
    ]).then(([schema, rows, assets, memory]) => {
      if (!alive) return
      const rowsBySection = {}
      for (const r of rows) (rowsBySection[r.section_key] ||= []).push(r)
      setDirectory({ schema, rowsBySection, assets })
      setBrandMemory(memory)
      // Turn the workspace's own directories on by default. For Aqeeq and Alo
      // Kheyatah the service menu IS the subject matter, and leaving it off
      // meant the planner never saw what the company actually sells. Only
      // applied while the selection is still the untouched default, so a
      // deliberate de-selection is never overridden.
      const dirKeys = (schema.sections || [])
        .filter(sec => sec.kind === 'directory' && sec.enabled !== false)
        .map(sec => sec.key)
      if (dirKeys.length) {
        // Dispatched directly rather than through update(), which takes a
        // plain patch — this needs to read the CURRENT selection to decide
        // whether it is still untouched.
        dispatch(actions.setCampaignPlanDraft(prev => {
          const base = { ...DEFAULT_DRAFT, ...(prev || {}) }
          const sel = base.brandBrainSections || []
          const untouched = sel.length === DEFAULT_BRAND_BRAIN_SECTIONS.length &&
            DEFAULT_BRAND_BRAIN_SECTIONS.every(k => sel.includes(k))
          if (!untouched) return base
          return { ...base, brandBrainSections: [...sel, ...dirKeys] }
        }))
      }
    })
    return () => { alive = false }
  }, [activeWorkspaceId, accessToken])

  // One place the whole page gets its AI context from. Returns the payload
  // fields every webhook expects — the flattened instructions plus the brand's
  // own identity, which used to be hardcoded to a lighting company inside the
  // n8n prompts regardless of which brand was posting.

  function contextFor(task, extra = {}) {
    const ctx = buildContext(state.brandProfile, directory.schema, directory, brandMemory, {
      task,
      sections: brandBrainSections,
      ...extra,
    })
    return {
      instructions: ctx.instructions,
      brand_name: ctx.brandName,
      brand_descriptor: ctx.brandDescriptor,
    }
  }

  // Rows the planner can be told to build the month around. Any directory
  // qualifies — Arak features fixtures, Aqeeq features services, Alo Kheyatah
  // features alteration types. A row's first column is its display name.
  const featurableItems = []
  for (const section of directory.schema.sections) {
    if (section.kind !== 'directory' || section.enabled === false) continue
    const cols = directory.schema.columns.filter(c => c.section_key === section.key && c.enabled !== false)
    if (!cols.length) continue
    for (const row of directory.rowsBySection[section.key] || []) {
      const name = String(row.data?.[cols[0].key] || '').trim()
      if (!name) continue
      featurableItems.push({ id: row.id, name, sectionTitle: section.title, cols, data: row.data || {} })
    }
  }

  // Review-step view controls (client-side only).
  const [statusFilter,   setStatusFilter]   = useState('all')   // all | undecided | approved | rejected
  const [seasonalOnly,   setSeasonalOnly]   = useState(false)
  const [platformFilter, setPlatformFilter] = useState('all')
  const [autoEditId,     setAutoEditId]     = useState(null)     // idea to auto-open in the edit modal
  const [viewMode,       setViewMode]       = useState('list')   // 'list' | 'calendar'
  const [dayFilter,      setDayFilter]      = useState(null)     // 'YYYY-MM-DD' — set by clicking a calendar day
  function pickCalendarDay(dateKey) { setDayFilter(dateKey); setViewMode('list') }

  // Per-seed-post image picker (Stage-1 brief) — which seed row is being
  // edited, and the in-progress mode choice for that row's picker (mirrors
  // the same controlled-mode pattern IdeaCard uses for its own picker).
  const [pickingSeedIdx, setPickingSeedIdx] = useState(null)
  const [seedPickerMode, setSeedPickerMode] = useState('generate')

  // "Generate more ideas" — AI top-up on top of the existing plan.
  const [showMoreModal, setShowMoreModal] = useState(false)
  const [moreLoading,   setMoreLoading]   = useState(false)
  const [moreError,     setMoreError]     = useState('')

  const { step, month, goal, goalCategory, platforms, startDate, endDate, approxCount, includeHolidays, brandBrainSections, featuredProductIds, seedPosts, name, ideas, planId, pushResult, manualResult, postingDays, defaultTime, aiAssist, contentMixTarget, openedFromPlanList } = draft

  // What the plan call will actually be given, for the preview panel. Same
  // builder as the payload — see contextFor below.
  // Not memoised: it is string assembly over a few dozen fields on a setup
  // form, and memoising it here defeated the compiler's own optimisation.
  const setupContext = buildContext(state.brandProfile, directory.schema, directory, brandMemory, {
    task: 'plan', sections: brandBrainSections,
  })
  // The caption-task slice, for the review board's panel. Separate from
  // setupContext because the two calls genuinely take different slices once
  // fields are task-tagged — showing the plan context over a board of drafted
  // captions would misreport what wrote them.
  const draftContext = buildContext(state.brandProfile, directory.schema, directory, brandMemory, {
    task: 'caption', sections: brandBrainSections,
  })
  const activeRuleCount = brandMemory.filter(r => r.status === 'active').length
  const months = monthOptions()

  // Supabase is the source of truth for a saved plan's ideas — the draft
  // persisted in localStorage can go stale (another tab, another day, an
  // idea generated by n8n after this tab last touched it). The instant a
  // planId is present — whether restored from localStorage on a fresh
  // mount, or freshly set after this tab created the plan — pull the real
  // rows once and let them win over whatever the draft was holding, except
  // for cards added locally that haven't been saved yet ('new_' ids), which
  // the DB can't know about. Guarded by ref so it fires once per planId,
  // not on every render.
  const syncedPlanIdRef = useRef(null)
  useEffect(() => {
    if (!planId || !accessToken || !activeWorkspaceId) return
    if (syncedPlanIdRef.current === planId) return
    syncedPlanIdRef.current = planId
    fetchPlanWithIdeas(activeWorkspaceId, accessToken, planId).then(({ ok, plan, ideas: dbIdeas }) => {
      // Lookup failed rather than answered — a dropped request must never be
      // read as "not yours" and cost someone their in-progress board.
      if (!ok) { syncedPlanIdRef.current = null; return }
      // Answered, and the plan isn't this company's. The board must not show
      // it, and — more importantly — must not keep its planId around, or the
      // next "+ Add idea" would write this company's idea into the other
      // company's plan. Start clean instead.
      if (!plan) { syncedPlanIdRef.current = null; clear(); return }
      if (!dbIdeas) return
      const dbDraftIdeas = dbIdeas.map(dbIdeaToDraft)
      const localOnly = (draft.ideas || []).filter(i => typeof i.id === 'string' && i.id.startsWith('new_'))
      update({ ideas: [...dbDraftIdeas, ...localOnly] })
    })
  }, [planId, accessToken, activeWorkspaceId])

  // Fire arak-draft-copy for a batch of freshly-created ideas — ONE call per
  // idea (no cross-idea batching), so a slow/failed draft never blocks the
  // rest of the board. `allIdeas` is the full, just-computed ideas array
  // (not the `ideas` closure — avoids the stale-state problem of firing
  // multiple update() calls in a loop right after another update()).
  // Best-effort: if the webhook isn't configured, ideas simply stay
  // 'not_started' rather than getting stuck marked 'drafting' forever.
  async function draftIdeas(allIdeas, newIds) {
    const draftCopyUrl = state.webhooks?.draftCopy
    if (!newIds.length || !draftCopyUrl) return
    const nowIso = new Date().toISOString()
    update({ ideas: allIdeas.map(i => newIds.includes(i.id) ? { ...i, draftStatus: 'drafting', draftedAt: nowIso, draftError: '' } : i) })
    await markIdeasDrafting(accessToken, newIds)
    const captionLanguage = state.brandProfile?.captionLanguage || 'both'
    const targets = allIdeas.filter(i => newIds.includes(i.id))
    Promise.allSettled(targets.map(idea => {
      // Per idea, not per batch: a large directory reaches the prompt as a
      // bare name index, so the one thing that makes a caption specific —
      // what the featured service or fixture actually is — only arrives if
      // this idea's own brief is what selects it.
      const brandCtx = contextFor('caption', {
        matchText: [idea.topic, idea.title, idea.angle, idea.imageIdea],
      })
      return requestDraftCopy(draftCopyUrl, {
        plan_idea_id: idea.id, platform: idea.platform, topic: idea.topic, angle: idea.angle, tone: idea.tone,
        objective: idea.objective, cta: idea.cta, occasion: idea.occasion, content_pillar: idea.pillar,
        format: idea.postFormat, aspect_ratio: idea.aspectRatio, media_type: idea.mediaType,
        wants_caption: idea.wantsCaption, image_idea: idea.imageIdea,
        caption_language: captionLanguage, instructions: brandCtx.instructions,
        brand_name: brandCtx.brand_name, brand_descriptor: brandCtx.brand_descriptor,
      })
    }))
  }

  // A redraft is a rejection of the copy without a rejection of the idea —
  // the reviewer read what the model wrote and asked for another take. Worth
  // recording separately from the first draft, which draftIdeas also serves:
  // the interesting number is how often a given kind of idea needs a second
  // pass, and that is invisible if both look the same in the log.
  function redraftIdea(target) {
    logIdeaEvent(activeWorkspaceId, accessToken, {
      planId, ideaId: target.id, event: 'redrafted',
      reason: target.draftStatus === 'failed' ? 'retry after failure' : 'asked for another take',
      before: ideaSnapshot(target),
    })
    return draftIdeas(ideas, [target.id])
  }

  // Poll plan_ideas for cards currently 'drafting' — 4s while any are in
  // flight, stopped otherwise. Merge rule: a poll result only overwrites a
  // card's option/selection fields while that card is STILL locally
  // 'drafting' — once the reviewer has picked or edited something, a
  // late-arriving poll must never clobber it.
  useEffect(() => {
    const draftingIds = ideas.filter(i => i.draftStatus === 'drafting').map(i => i.id)
    if (!draftingIds.length) return
    const timer = setInterval(async () => {
      const rows = await fetchIdeaDrafts(accessToken, draftingIds)
      if (!rows.length) return
      const now = Date.now()
      update({
        ideas: ideas.map(i => {
          if (i.draftStatus !== 'drafting') return i
          const row = rows.find(r => r.id === i.id)
          if (!row) return i
          const staleMs = i.draftedAt ? now - new Date(i.draftedAt).getTime() : 0
          if (row.draft_status === 'drafting' && staleMs > 5 * 60 * 1000) {
            return { ...i, draftStatus: 'failed', draftError: 'Drafting timed out — try again.' }
          }
          if (row.draft_status === 'ready' || row.draft_status === 'failed') {
            return {
              ...i, draftStatus: row.draft_status, draftError: row.draft_error || '',
              captionOptions: row.caption_options || [], mediaPromptOptions: row.media_prompt_options || [],
            }
          }
          return i
        }),
      })
    }, 4000)
    return () => clearInterval(timer)
  }, [ideas, accessToken])

  const toggleSection  = s => update({ brandBrainSections: brandBrainSections.includes(s) ? brandBrainSections.filter(x => x !== s) : [...brandBrainSections, s] })
  const toggleProduct  = id => update({ featuredProductIds: featuredProductIds.includes(id) ? featuredProductIds.filter(x => x !== id) : [...featuredProductIds, id] })
  const toggleDay      = d  => update({ postingDays: postingDays.includes(d) ? postingDays.filter(x => x !== d) : [...postingDays, d] })

  // ── Seed posts (specific posts the user already wants, optionally with images) ──
  const addSeed = () => {
    const p = platforms[0] || 'instagram'
    const fmt = defaultFormat(p)
    update({ seedPosts: [...seedPosts, {
      text: '', platform: p, date: '', references: [], imageMode: 'generate',
      postFormat: fmt, aspectRatio: defaultAspectRatio(p, fmt), slideCount: slideRange(p, fmt)?.default || 1,
      // 'ai' preserves what this box has always meant — a topic to write from.
      // Opting into 'own' is what turns the text into the post itself.
      copyMode: 'ai',
    }] })
  }
  const updateSeed = (i, patch)  => update({ seedPosts: seedPosts.map((s, idx) => idx === i ? { ...s, ...patch } : s) })
  const removeSeed = i           => update({ seedPosts: seedPosts.filter((_, idx) => idx !== i) })
  function openSeedImagePicker(i) { setSeedPickerMode(seedPosts[i].imageMode || 'generate'); setPickingSeedIdx(i) }
  function saveSeedImages(urls) {
    updateSeed(pickingSeedIdx, { references: urls, imageMode: seedPickerMode })
    setPickingSeedIdx(null)
    return { ok: true }
  }

  function pickMonth(ym) {
    const opt = months.find(m => m.value === ym)
    if (!opt) return
    update({ month: ym, startDate: opt.start, endDate: opt.end, name: name || `${opt.label} Content Plan` })
  }

  function validateSetup() {
    if (!month) return 'Pick which month this plan is for.'
    if (platforms.length === 0) return 'Select at least one platform.'
    const hasSeeds = seedPosts.some(s => s.text.trim())
    if (!aiAssist && !hasSeeds) return 'Add at least one post, or turn on "Also let AI propose additional posts."'
    return ''
  }

  async function handleGeneratePlan() {
    const v = validateSetup()
    if (v) { setError(v); return }
    // The AI planner webhook is only needed when AI-assist is actually on —
    // a fully manual, curated-posts-only plan never calls it.
    if (aiAssist && !webhookUrl) { setError('Campaign Planner webhook not configured (Settings → Integrations).'); return }
    setError(''); setLoading(true)

    // Individually curated posts — the primary planning surface. These are
    // inserted directly as real ideas, no AI involved.
    const cleanSeeds = seedPosts
      .filter(s => s.text.trim())
      .map(s => ({
        text: s.text.trim(), platform: s.platform, format: s.postFormat || defaultFormat(s.platform), date: s.date || null,
        image_mode: s.imageMode || 'generate', reference_image_urls: s.references || [],
      }))
    const seedIdeas = seedPosts.filter(s => s.text.trim()).map(s => {
      const postFormat = s.postFormat || defaultFormat(s.platform)
      const mediaType = formatsFor(s.platform).find(f => f.id === postFormat)?.media || 'image'
      const ownCopy = s.copyMode === 'own'
      // A manual seed's text is BOTH the caption and the title/topic. The
      // title is what the board, the week groups and the media stage label
      // their cards with, so leaving it empty would produce a month of
      // "Untitled idea"; truncating keeps a long caption from becoming the
      // heading. topic still carries the full text — cross-month history and
      // the mix bar read it.
      const title = ownCopy && s.text.trim().length > 80
        ? `${s.text.trim().slice(0, 77)}…`
        : s.text.trim()
      return {
        platform: s.platform, date: s.date, title, topic: s.text,
        tone: 'professional',
        rationale: ownCopy
          ? 'You wrote this post yourself — it goes out exactly as typed.'
          : 'You added this as a specific post you wanted.',
        imageMode: s.imageMode, references: s.references,
        postFormat, aspectRatio: s.aspectRatio || defaultAspectRatio(s.platform, postFormat), mediaType,
        slideCount: s.slideCount || slideRange(s.platform, postFormat)?.default || 1,
        wantsCaption: true,
        postKind: derivePostKind({ platform: s.platform, format: postFormat, wantsCaption: true, slideCount: s.slideCount }),
        // The text is the post. captionEn is where the manual editor reads and
        // writes; publishIdeasAsPosts falls back to captionAr for an
        // Arabic-only post, so an Arabic seed is not lost either.
        copyMode: ownCopy ? 'own' : 'ai',
        captionEn: ownCopy ? s.text.trim() : '',
      }
    })

    let aiPosts = []
    let featuredProducts = []
    let effectiveGoal = ''
    if (aiAssist) {
      const brandCtx = contextFor('plan')
      const instructions = brandCtx.instructions
      effectiveGoal = goal.trim() ||
        `A well-rounded month of brand content for ${activeWorkspace?.name || 'this brand'} — a mix of service and product highlights, educational content, and the seasonal/cultural moments falling in this month, all in the brand's own voice.`
      // Stage-1 brief material: the rows to feature with their full context,
      // not just ids, so the planner can build a coherent month around them.
      // Columns flagged out of the prompt (prices) stay out here too.
      featuredProducts = featurableItems
        .filter(item => featuredProductIds.includes(item.id))
        .map(item => {
          const out = { name: item.name, catalogue: item.sectionTitle }
          for (const c of item.cols.slice(1)) {
            if (c.in_prompt === false) continue
            const v = String(item.data[c.key] || '').trim()
            if (v) out[c.key] = v
          }
          return out
        })

      // Cross-month anti-repetition: this is a BRAND NEW plan (no planId yet),
      // so "past" here means every idea from every OTHER plan in the workspace.
      const pastIdeas = await fetchPastIdeas(activeWorkspaceId, accessToken, null)

      const result = await requestCampaignPlan(webhookUrl, {
        goal: effectiveGoal,
        goal_category: goalCategory || null,
        platforms,
        start_date: startDate,
        end_date: endDate,
        approx_post_count: approxCount ? Number(approxCount) : null,
        include_holidays: includeHolidays,
        brand_brain_sections: brandBrainSections,
        instructions: instructions || null,
        brand_name: brandCtx.brand_name,
        brand_descriptor: brandCtx.brand_descriptor,
        featured_products: featuredProducts,
        seed_posts: cleanSeeds,
        content_mix_target: contentMixTarget || null,
        past_ideas: pastIdeas,
        posting_days: postingDays,
        posting_time: defaultTime,
      })
      if (result.error) { setLoading(false); setError(result.error); return }
      aiPosts = result.posts.map(normalizeAiIdea)
    }

    // Persist the plan + its ideas so approval state is real, not ephemeral.
    const planRes = await createPlan(activeWorkspaceId, accessToken, {
      name: name || `${months.find(m => m.value === month)?.label || 'Monthly'} Content Plan`,
      month, start_date: startDate, end_date: endDate,
      goal: effectiveGoal, goal_category: goalCategory || '', platforms, status: 'draft',
      featured_products: featuredProducts.map(p => p.name),
      posting_days: postingDays, default_time: defaultTime,
      content_mix_target: contentMixTarget || null,
    })
    if (planRes.error) { setLoading(false); setError(`Plan couldn't be saved: ${planRes.error}`); return }

    // Your curated posts come first on the board; any AI-proposed posts
    // (only present if AI-assist was on) follow after them.
    const allIdeas = [...seedIdeas, ...aiPosts]

    const ideasRes = await insertIdeas(activeWorkspaceId, accessToken, planRes.plan.id, allIdeas)
    setLoading(false)
    if (ideasRes.error) { setError(`Ideas generated but couldn't be saved: ${ideasRes.error}`); return }

    const createdIdeas = ideasRes.rows.map(dbIdeaToDraft)
    // This plan was just created in this tab — the ideas array above is
    // already fresh, no need for the mount-sync effect to re-fetch it (and
    // if it did, it would race draftIdeas' own optimistic 'drafting' update
    // below with a stale DB read from before that PATCH lands).
    syncedPlanIdRef.current = planRes.plan.id
    update({
      planId: planRes.plan.id,
      ideas: createdIdeas,
      name: planRes.plan.name,
      step: 'review',
    })
    // Draft Copy proposes caption options for the reviewer to pick from. An
    // idea whose caption is already written has nothing to propose and no
    // reviewer decision left to make, so it is left out entirely — drafting it
    // would spend a webhook call to offer alternatives to words the operator
    // deliberately chose.
    draftIdeas(createdIdeas, createdIdeas.filter(i => i.copyMode !== 'own').map(i => i.id))
  }

  // Top up the existing plan with more AI ideas — same webhook, but with the
  // plan's current ideas (any status) sent as `existing_ideas` so the n8n
  // workflow's prompt can steer away from repeating them.
  async function handleGenerateMore({ count, focus }) {
    if (!webhookUrl) { setMoreError('Campaign Planner webhook not configured (Settings → Integrations).'); return }
    setMoreError(''); setMoreLoading(true)

    const brandCtx = contextFor('plan')
    const instructions = brandCtx.instructions
    const effectiveGoal = focus.trim() || goal.trim() ||
      `A well-rounded month of brand content for ${activeWorkspace?.name || 'this brand'} — a mix of service and product highlights, educational content, and the seasonal/cultural moments falling in this month, all in the brand's own voice.`
    const existingIdeas = ideas.slice(-60).map(i => ({
      platform: i.platform, date: i.date, topic: i.topic || i.title, pillar: i.pillar,
    }))
    // Cross-month history — OTHER plans, this one is already covered by existingIdeas above.
    const pastIdeas = await fetchPastIdeas(activeWorkspaceId, accessToken, planId)

    const result = await requestCampaignPlan(webhookUrl, {
      goal: effectiveGoal,
      goal_category: goalCategory || null,
      platforms,
      start_date: startDate,
      end_date: endDate,
      approx_post_count: count,
      include_holidays: includeHolidays,
      brand_brain_sections: brandBrainSections,
      instructions: instructions || null,
      brand_name: brandCtx.brand_name,
      brand_descriptor: brandCtx.brand_descriptor,
      existing_ideas: existingIdeas,
      past_ideas: pastIdeas,
      posting_days: postingDays,
      posting_time: defaultTime,
    })
    if (result.error) { setMoreLoading(false); setMoreError(result.error); return }

    const ideasRes = await insertIdeas(activeWorkspaceId, accessToken, planId, result.posts.map(normalizeAiIdea), ideas.length)
    setMoreLoading(false)
    if (ideasRes.error) { setMoreError(`Generated but couldn't be saved: ${ideasRes.error}`); return }

    const createdIdeas = ideasRes.rows.map(dbIdeaToDraft)
    const nextIdeas = [...ideas, ...createdIdeas]
    update({ ideas: nextIdeas })
    setShowMoreModal(false)
    draftIdeas(nextIdeas, createdIdeas.map(i => i.id))
  }

  function onIdeaChange(updated) {
    update({ ideas: ideas.map(i => i.id === updated.id ? updated : i) })
  }

  // ── Creative Studio sessions opened from this plan ──────────────────────
  // One call for the whole board rather than a lookup per card. Keyed by
  // plan_idea_id; only the newest session per idea is kept, which is what
  // "Reopen Studio" should land on.
  const [studioSessions, setStudioSessions] = useState({})
  const savedIdeaIds = ideas.filter(i => !i.isNew && !String(i.id).startsWith('new_')).map(i => i.id)
  const savedIdsKey = savedIdeaIds.join(',')
  useEffect(() => {
    if (!savedIdsKey || !accessToken) return
    let alive = true
    fetchSessionsForIdeas(accessToken, savedIdsKey.split(',')).then(rows => {
      if (!alive) return
      const byIdea = {}
      // Rows arrive newest-first, so the first one wins per idea.
      for (const r of rows) if (!byIdea[r.plan_idea_id]) byIdea[r.plan_idea_id] = r
      setStudioSessions(byIdea)
    })
    return () => { alive = false }
  }, [savedIdsKey, accessToken])

  // Open (or reopen) Creative Studio for one idea.
  //
  // Two different destinations on purpose. An idea that already has a session
  // goes straight to it (?session=), because it has versions to show. An idea
  // that doesn't goes to ?ideaId=, where the studio pre-fills its own composer
  // and creates the session at the first generation — its normal path. Sending
  // a brand-new idea to ?session= would open an empty session, which the
  // studio renders as "Nothing here yet" with no way to prompt.
  // The media stage works on approved ideas only — a rejected idea has no
  // picture to make, and a still-proposed one hasn't earned the Studio time.
  const approvedIdeas = ideas.filter(i => i.status === 'approved')
  // An idea using its own uploaded image already HAS its picture — it was
  // attached at plan time. Counting only Studio-accepted media would show
  // "0 of 4 ready" to someone who supplied all four themselves, and push them
  // into a Studio they have no reason to open.
  const hasOwnMedia = i => i.imageMode === 'use_reference' && (i.references || []).length > 0
  const mediaReadyCount = approvedIdeas.filter(i => i.mediaStatus === 'ready' || hasOwnMedia(i)).length
  // Which side of the finalize partition each approved idea falls on. Drives
  // the button's label and the copy around it.
  const ownCopyCount = approvedIdeas.filter(i => i.copyMode === 'own').length
  const aiCopyCount  = approvedIdeas.length - ownCopyCount

  // Start one over. Clears the accepted version but keeps the Studio session
  // and the last thumbnail — what was tried before is useful context for the
  // next attempt, and throwing the session away would abandon work already
  // paid for.
  async function redoMedia(idea) {
    const res = await resetIdeaMedia(accessToken, idea.id)
    if (res.error) { setError(res.error); return }
    onIdeaChange({ ...idea, mediaStatus: 'none', mediaVersionId: null })
  }

  // ── Attaching your own picture at the media stage ────────────────────────
  // The same ReferencePicker the setup step and the idea card already use
  // (brand-asset library + upload), pinned to 'use_reference' — at this stage
  // the question is only "which image IS this post", never "what should guide
  // a generation".
  const [mediaPickIdea, setMediaPickIdea] = useState(null)
  function openMediaPicker(idea) { setMediaPickIdea(idea) }
  async function saveMediaImages(urls) {
    const idea = mediaPickIdea
    if (!idea) return { ok: true }
    // Clearing every image is a real choice — it puts the idea back to having
    // no picture, rather than leaving image_mode claiming one that isn't there.
    const mode = urls.length ? 'use_reference' : 'generate'
    const result = await updateIdea(accessToken, idea.id, { reference_image_urls: urls, image_mode: mode })
    if (result.error) return { error: result.error }
    onIdeaChange({ ...idea, references: urls, imageMode: mode })
    setMediaPickIdea(null)
    return { ok: true }
  }

  async function openStudio(idea) {
    const result = await openStudioForIdea(accessToken, idea)
    if (result.error) { setError(result.error); return }
    // openStudioForIdea flips the idea to image_mode='studio' so plan
    // generation stops paying fal for an image nobody will use. Reflect it
    // locally rather than refetching the whole board for one field.
    onIdeaChange({ ...idea, imageMode: 'studio', mediaStatus: idea.mediaStatus === 'ready' ? 'ready' : 'in_studio' })
    if (result.session) {
      setStudioSessions(prev => ({ ...prev, [idea.id]: result.session }))
      navigate(`/studio?session=${result.session.id}`)
    } else {
      navigate(`/studio?ideaId=${idea.id}`)
    }
  }
  async function onIdeaRemove(idea) {
    update({ ideas: ideas.filter(i => i.id !== idea.id) })
    // isNew ideas never made it to the database (see addIdea/onIdeaCreate) —
    // nothing to delete server-side, and deleteIdea would just no-op on a
    // fake temp id anyway.
    if (idea.isNew) return
    // Logged BEFORE the delete, and with the full snapshot: this row is about
    // to stop existing, so the event is the only remaining record of what was
    // thrown away. A silently deleted idea reads to every later report as one
    // that was never suggested, which is the opposite of what happened.
    logIdeaEvent(activeWorkspaceId, accessToken, {
      planId, ideaId: idea.id, event: 'deleted', before: ideaSnapshot(idea),
    })
    await deleteIdea(accessToken, idea.id)
  }

  // Copies a fully-briefed idea onto the OTHER platform — same topic/angle/
  // objective/cta/image direction, with tone/style/format remapped to that
  // platform's own vocabulary (see postFormats.js crosswalk* helpers).
  // Deliberately does NOT copy reference images: they were picked/cropped
  // for the original platform's aspect ratio, which the other platform
  // doesn't share. Not auto-elongated — this idea already has a full brief,
  // unlike a bare "+ Add idea" draft.
  //
  // Both ideas end up sharing a group_id — the original is patched with a
  // fresh one if it didn't already have one — so cross-platform siblings can
  // be told apart from genuine repeats (anti-repetition history, Step 5's
  // collapsed multi-platform card) without being conflated.

  // Called once the "+ Add idea" editor's Save is clicked — this is the
  // only point a manually-added idea actually gets written to the database.
  async function onIdeaCreate(tempIdea, patch) {
    const merged = { ...tempIdea, ...patch }
    const res = await insertIdeas(activeWorkspaceId, accessToken, planId, [{
      platform: merged.platform, date: merged.date, time: merged.time, title: merged.topic || 'New idea',
      topic: merged.topic, angle: merged.angle, tone: merged.tone,
      suggestedStyle: merged.suggestedStyle, imageIdea: merged.imageIdea,
      objective: merged.objective, cta: merged.cta,
      hashtags: merged.hashtags, firstComment: merged.firstComment, series: merged.series,
      postFormat: merged.postFormat, aspectRatio: merged.aspectRatio, mediaType: merged.mediaType,
      wantsCaption: merged.wantsCaption,
      postKind: merged.postKind, slideCount: merged.slideCount, imageText: merged.imageText,
      copyMode: merged.copyMode, captionEn: merged.captionEn, captionAr: merged.captionAr,
    }], ideas.length)
    if (res.error || !res.rows?.[0]) return { error: res.error || 'Could not save idea.' }
    let created = dbIdeaToDraft(res.rows[0])

    // A manually-typed idea only has a thin topic/tone — ask AI to flesh it
    // out into a real brief (angle/objective/cta/design direction), the same
    // fields an AI-suggested idea already gets, BEFORE the user approves it.
    // Best-effort: if this fails or isn't configured, the idea just stays as
    // typed — never blocks the save itself.
    // Skipped outright when the operator writes their own copy. Elongating
    // exists to give the AI writer a fuller brief, and there is no AI writer
    // on this idea — running it anyway would send their post to a model they
    // deliberately opted out of, and overwrite the topic they typed.
    const elongateUrl = created.copyMode === 'own' ? '' : state.webhooks?.elongateIdea
    if (elongateUrl) {
      const brandCtx = contextFor('plan')
      const instructions = brandCtx.instructions
      const elongated = await elongateIdea(elongateUrl, {
        instructions,
        brand_name: brandCtx.brand_name, brand_descriptor: brandCtx.brand_descriptor,
        idea: { platform: created.platform, topic: created.topic, tone: created.tone, date: created.date },
      })
      if (elongated.ok) {
        const dbPatch = {
          topic: elongated.topic || created.topic,
          angle: elongated.angle || '',
          tone: elongated.tone || created.tone,
          objective: elongated.objective || '',
          cta: elongated.cta || '',
          image_idea: elongated.image_idea || created.imageIdea || '',
          occasion: elongated.occasion || '',
          content_pillar: elongated.content_pillar || '',
          hashtags: elongated.hashtags || created.hashtags || '',
        }
        const patchRes = await updateIdea(accessToken, created.id, dbPatch)
        if (patchRes.ok && patchRes.idea) created = dbIdeaToDraft(patchRes.idea)
      }
    }

    const nextIdeas = ideas.map(i => i.id === tempIdea.id ? created : i)
    update({ ideas: nextIdeas })
    // Re-open the editor on the now-enriched idea (the card remounts under its
    // real id the instant `ideas` updates, since IdeaCard is keyed by id) so
    // the user sees the elongated brief and can adjust it before approving.
    setAutoEditId(created.id)
    setTimeout(() => setAutoEditId(null), 400)
    draftIdeas(nextIdeas, [created.id])
    return { ok: true, idea: created }
  }

  async function bulkStatus(status) {
    setBusy(true)
    await setAllIdeaStatus(accessToken, planId, status)
    // Mirror the same scoping as setAllIdeaStatus's DB write: "Reset" really
    // does touch everything, but Approve all / Reject all only affect ideas
    // still 'proposed' — otherwise the local board would claim a change the
    // DB didn't actually make (a previously-rejected idea showing "approved"
    // in this tab while the row itself never moved).
    const affected = ideas.filter(i => !i.isNew && (status === 'proposed' || i.status === 'proposed'))
    update({ ideas: ideas.map(i => (status === 'proposed' || i.status === 'proposed') ? { ...i, status } : i) })
    // Same scoping again, for the same reason: logging every card would claim
    // decisions the DB never made. 'proposed' is a reset, not a judgement, so
    // it records as an edit rather than an approval.
    logIdeaEvents(activeWorkspaceId, accessToken, affected.map(i => ({
      planId, ideaId: i.id,
      event: status === 'rejected' ? 'rejected' : status === 'approved' ? 'approved' : 'edited',
      reason: status === 'proposed' ? 'reset to undecided' : 'bulk action',
      before: { status: i.status }, after: { status },
    })))
    setBusy(false)
  }

  // Add a blank, unsaved idea card and open its editor — nothing is written
  // to the database until the user clicks Save (see onIdeaCreate).
  function addIdea() {
    const p = platformFilter !== 'all' ? platformFilter : (platforms[0] || 'instagram')
    const fmt = defaultFormat(p)
    const draftIdea = {
      id: `new_${uid()}`, isNew: true, status: 'proposed',
      platform: p,
      date: startDate, title: '', topic: '', angle: '',
      postFormat: fmt, aspectRatio: defaultAspectRatio(p, fmt), mediaType: formatsFor(p).find(f => f.id === fmt)?.media || 'image',
      wantsCaption: true, slideCount: slideRange(p, fmt)?.default || 1,
      tone: 'professional',
    }
    setStatusFilter('all'); setSeasonalOnly(false); setPlatformFilter('all')
    setAutoEditId(draftIdea.id)
    update({ ideas: [...ideas, draftIdea] })
    // autoEdit only needs to be true for the new card's first mount; clear it
    // afterwards so re-filtering doesn't re-open the editor unexpectedly.
    setTimeout(() => setAutoEditId(null), 400)
  }

  // Finalising a plan turns approved ideas into real post rows — and there are
  // two genuinely different ways for that to happen, which is why this
  // partitions rather than doing one thing.
  //
  //   copy_mode 'own' → the words are already written. The row is written HERE,
  //                     directly, with no webhook. This is what makes a fully
  //                     manual plan possible with no n8n configured at all.
  //   copy_mode 'ai'  → the idea is a brief. It goes to the Plan Generation
  //                     webhooks exactly as it always has.
  //
  // A plan can hold both, and a mixed plan must not fail on one side because
  // the other is unconfigured — so the AI half is only attempted when there is
  // an AI half.
  async function finalizePlan() {
    const approved = ideas.filter(i => i.status === 'approved')
    if (approved.length === 0) { setError('Approve at least one idea before finalizing the plan.'); return }
    setError(''); setBusy(true)

    const ownIdeas = approved.filter(i => i.copyMode === 'own')
    const aiIdeas  = approved.filter(i => i.copyMode !== 'own')

    // ── The operator's own posts ──
    // Written first, and deliberately so: it is the half that cannot fail for
    // configuration reasons, and if the AI half then fails these are already
    // safe rather than lost with it.
    let manualPosts = []
    let manualWarnings = []
    if (ownIdeas.length) {
      const res = await publishIdeasAsPosts(activeWorkspaceId, accessToken, planId, ownIdeas)
      if (res.error) { setBusy(false); setError(`Your posts couldn't be saved: ${res.error}`); return }
      manualPosts = res.posts || []
      manualWarnings = res.errors || []
    }

    // ── The briefed ones ──
    let pushResult = null
    if (aiIdeas.length) {
      const brandCtx = contextFor('caption')
      const instructions = brandCtx.instructions
      // Mark them 'processing' BEFORE firing the webhook — durable and instant,
      // so Post Approvals shows real state even on reload, not just while this
      // tab stays open waiting for n8n's background generation. Scoped to the
      // AI half so a manual post is never left waiting on a workflow that will
      // never run for it.
      await markIdeasProcessing(accessToken, planId, { copyMode: 'ai' })

      pushResult = await requestPlanContentGeneration({
        webhooks: state.webhooks, planId, instructions, ideas: aiIdeas,
        brand_name: brandCtx.brand_name, brand_descriptor: brandCtx.brand_descriptor,
        workspaceId: activeWorkspaceId,
        captionLanguage: state.brandProfile?.captionLanguage || 'both',
      })
      if (pushResult.error) {
        setBusy(false)
        // Said plainly rather than swallowed: the manual posts really are
        // saved, and telling someone the whole finalize failed would send them
        // to re-do work that is already done.
        setError(manualPosts.length
          ? `${manualPosts.length} of your own post${manualPosts.length === 1 ? '' : 's'} saved, but the AI-written ones failed: ${pushResult.error}`
          : pushResult.error)
        return
      }
    }

    // 'generating' only when something actually is. A fully manual plan is
    // finished the moment its rows exist, and leaving it 'generating' would
    // show a progress state that nothing will ever advance.
    await updatePlan(accessToken, planId, { status: aiIdeas.length ? 'generating' : 'active' })

    // Batch-render every approved video-format idea at once — runs in the
    // background (never awaited here), each polling for its own cover
    // image to finish uploading before firing. See triggerVideoRenders.
    // Manual ideas are excluded: their video is already made (Studio or
    // upload), so rendering one would replace the operator's own footage.
    triggerVideoRenders({
      webhooks: state.webhooks, videoIdeas: aiIdeas.filter(i => i.mediaType === 'video'), accessToken,
    })

    setBusy(false)
    update({ step: 'done', pushResult, manualResult: { count: manualPosts.length, warnings: manualWarnings } })
  }

  const brandReady = state.brandProfile && !isBrandProfileEmpty(state.brandProfile)
  const proposedCount = ideas.filter(i => i.status === 'proposed').length
  const approvedCount = ideas.filter(i => i.status === 'approved').length
  const rejectedCount = ideas.filter(i => i.status === 'rejected').length
  const seasonalCount = ideas.filter(i => i.occasion).length
  const reviewedCount = approvedCount + rejectedCount

  // Content-mix breakdown — tallies content_pillar across everything still in
  // play (rejected ideas don't count, they won't get made). Marketers think
  // in ratios ("40% product / 20% educational…"); without this, imbalance
  // (7 product posts, 1 tip) only shows up by reading every card.
  const pillarBreakdown = (() => {
    const counts = {}
    let unlabeled = 0
    for (const i of ideas) {
      if (i.status === 'rejected') continue
      const p = (i.pillar || '').trim()
      if (!p) { unlabeled++; continue }
      counts[p] = (counts[p] || 0) + 1
    }
    return { sorted: Object.entries(counts).sort((a, b) => b[1] - a[1]), unlabeled }
  })()

  const filteredIdeas = ideas.filter(i => {
    const want = statusFilter === 'undecided' ? 'proposed' : statusFilter
    if (statusFilter !== 'all' && i.status !== want) return false
    if (seasonalOnly && !i.occasion) return false
    if (platformFilter !== 'all' && i.platform !== platformFilter) return false
    if (dayFilter && i.date !== dayFilter) return false
    return true
  })
  const weekGroups = groupByWeek(filteredIdeas)
  const setupMoments = includeHolidays ? momentsInRange(startDate, endDate) : []

  return (
    <div className="max-w-4xl space-y-4">
      {/* Hero. Was a purple gradient panel with a violet icon tile — a colour
          that appears in no palette this app defines, on the only page that
          used it. Now a flat panel on the brand accent, with the accent
          carried by a left rule rather than a fill. */}
      <div className="border border-border border-l-2 border-l-amber-700 bg-white p-5">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 bg-amber-700 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 3v3m0 12v3m9-9h-3M6 12H3m15.36-6.36l-2.12 2.12M8.76 15.24l-2.12 2.12m12.72 0l-2.12-2.12M8.76 8.76L6.64 6.64"/></svg>
          </div>
          <div className="min-w-0">
            <p className="eyebrow text-text-tertiary mb-1.5">Monthly planning</p>
            <h1 className="text-lg font-bold text-text tracking-tight mb-2">Plan the month before it starts.</h1>
            <p className="text-xs text-text-secondary leading-relaxed max-w-xl">
              Pick a month and we'll propose a full slate of post ideas — pulling from your Brand Brain and
              the seasonal moments in range (Ramadan, Eid, National Day…). You approve the ideas worth making;
              only approved ones move on to content generation.
            </p>
          </div>
        </div>
      </div>

      {/* Step indicator — segments of one continuous bar, sharing borders, so
          the three steps read as a single track. The arrow glyphs between
          floating pills were doing that job with punctuation instead. */}
      <div className="flex text-[10px] font-bold uppercase tracking-[0.08em]">
        {['Setup', 'Review & approve', 'Approved'].map((label, i) => {
          const active = ['setup', 'review', 'done'].indexOf(step) === i
          const done = ['setup', 'review', 'done'].indexOf(step) > i
          return (
            <span key={label}
              className={`px-3 py-1.5 border -ml-px first:ml-0
                ${active ? 'bg-amber-700 text-white border-amber-700 relative z-10'
                  : done ? 'bg-sage-100 text-sage-800 border-sage-200'
                  : 'bg-white text-text-tertiary border-border'}`}>
              {done ? '✓ ' : ''}{label}
            </span>
          )
        })}
      </div>

      {!brandReady && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-700">
          <span className="font-medium">No Brand Brain profile set.</span> The plan works without it but will be generic.
          <button onClick={() => navigate('/brand-brain')} className="underline font-medium hover:text-amber-800 ml-1">Set it up first</button> for on-brand ideas.
        </div>
      )}
      {!webhookUrl && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-700">
          <span className="font-medium">Campaign Planner webhook not configured.</span> Add it in Settings → Integrations before generating.
        </div>
      )}

      {/* ── STEP: SETUP ── */}
      {step === 'setup' && (
        <Card className="p-6 space-y-5">
          {/* Instagram is the only platform with a generation pipeline, so a
              required picker with one option was a mandatory click that could
              only ever be answered one way. */}
          <Select label="Which month? *" value={month} onChange={e => pickMonth(e.target.value)}>
            <option value="">Select month…</option>
            {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </Select>

          {/* ── Cadence: shared by manual + AI posts alike ── */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-medium text-text-secondary mb-2">Which days do you post? (optional)</p>
              <div className="flex gap-1.5">
                {WEEKDAYS.map(d => (
                  <button key={d.value} onClick={() => toggleDay(d.value)} title={d.weekend ? 'Saudi weekend' : ''}
                    className={`w-9 h-9 rounded-xl border text-[11px] font-semibold transition-all ${postingDays.includes(d.value) ? 'bg-amber-600 text-white border-amber-600' : d.weekend ? 'bg-stone-50 border-border text-text-tertiary hover:border-amber-400' : 'bg-white border-border text-text-secondary hover:border-amber-400'}`}>
                    {d.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-text-tertiary mt-1.5">Leave all unselected to let the AI choose freely.</p>
            </div>
            <Input label="Default posting time" type="time" value={defaultTime} onChange={e => update({ defaultTime: e.target.value })} />
          </div>

          <Toggle checked={includeHolidays} onChange={e => update({ includeHolidays: e.target.checked })}
            label="Flag Saudi seasonal & cultural moments in range (Ramadan, Eid al-Fitr, Eid al-Adha, Founding Day, National Day)" />

          {month && setupMoments.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap rounded-xl bg-amber-50/60 border border-amber-100 px-3.5 py-2.5">
              <span className="text-[11px] font-semibold text-amber-800">Falls in this month:</span>
              {setupMoments.map((m, i) => (
                <span key={i} className="text-[10px] font-semibold px-1.5 py-0.5 leading-[1.4] bg-amber-100 text-amber-800 border border-amber-200">★ {m.name}</span>
              ))}
              <span className="text-[11px] text-amber-700/80">— worth a post yourself, or let AI cover it below.</span>
            </div>
          )}
          {month && includeHolidays && setupMoments.length === 0 && (
            <p className="text-[11px] text-text-tertiary px-1">No major Saudi moments fall in this month.</p>
          )}

          {/* ── Brand Brain: universal, not AI-only. This context feeds every
              post's actual content generation (caption + image) at approval
              time — your own curated posts included, not just AI-proposed
              ones — so it belongs here, shared, not behind the AI toggle. ── */}
          <div>
            <p className="text-xs font-medium text-text-secondary mb-2">Pull from Brand Brain</p>
            <div className="flex gap-2 flex-wrap">
              {getBrandBrainSections(directory.schema).map(s => {
                const count = s.value === 'assets'
                  ? directory.assets.length
                  : (directory.rowsBySection[s.value] || []).length
                const active = brandBrainSections.includes(s.value)
                return (
                  <button key={s.value} onClick={() => toggleSection(s.value)}
                    className={`px-3 py-1.5 rounded-xl border text-sm font-medium transition-all ${active ? 'bg-amber-600 text-white border-amber-600' : 'bg-white border-border text-text-secondary hover:border-amber-400'}`}>
                    {s.label}{count > 0 && <span className={active ? 'opacity-75 ml-1' : 'text-text-tertiary ml-1'}>({count})</span>}
                  </button>
                )
              })}
            </div>
            <p className="text-[11px] text-text-tertiary mt-1.5">Feeds every post's content generation — your own posts and any AI-proposed ones alike.</p>

            {/* The exact text the plan call will receive. Built by the SAME
                buildContext() that assembles the payload, so this preview
                cannot drift from what is actually sent — and it lands before
                the Opus call rather than after it. */}
            <div className="mt-3">
              <BrandContextPanel context={setupContext} task="plan" />
            </div>
            {activeRuleCount > 0 && (
              <p className="text-[11px] text-text-tertiary mt-1.5">
                <span className="font-medium text-text-secondary">{activeRuleCount} learned rule{activeRuleCount === 1 ? '' : 's'}</span>
                {' '}steering this plan — see Brand Brain → Learned Guidance.
              </p>
            )}
          </div>

          <div className="h-px bg-border" />

          {/* ── PRIMARY: individually curated posts. This is the main planning
              surface — every other section on this page is secondary to it. ── */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-bold text-text">Your posts</p>
              {seedPosts.some(s => s.text.trim()) && (
                <span className="text-[11px] text-text-tertiary">{seedPosts.filter(s => s.text.trim()).length} added</span>
              )}
            </div>
            <p className="text-[11px] text-text-tertiary mb-2.5">The exact posts you want this month — each one goes straight onto the plan for you to refine, no AI guessing. Add as many as you like.</p>

            {seedPosts.length > 0 && (
              <div className="space-y-2.5 mb-2.5">
                {seedPosts.map((s, i) => {
                  const refCount = (s.references || []).length
                  const usingImage = s.imageMode === 'use_reference'
                  const ownCopy = s.copyMode === 'own'
                  const sFormat = s.postFormat || defaultFormat(s.platform)
                  const sRatios = aspectRatiosFor(s.platform, sFormat)
                  const sSlides = slideRange(s.platform, sFormat)
                  function onPlatformChange(p) {
                    const fmt = defaultFormat(p)
                    updateSeed(i, { platform: p, postFormat: fmt, aspectRatio: defaultAspectRatio(p, fmt), slideCount: slideRange(p, fmt)?.default || 1 })
                  }
                  function onFormatChange(fmt) {
                    updateSeed(i, { postFormat: fmt, aspectRatio: defaultAspectRatio(s.platform, fmt), slideCount: slideRange(s.platform, fmt)?.default || 1 })
                  }
                  return (
                    <div key={i} className="rounded-xl border border-border p-3 space-y-2 bg-white">
                      <textarea
                        className={`w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:border-amber-400 resize-none ${ownCopy ? 'font-medium' : ''}`}
                        rows={ownCopy ? 4 : 2}
                        placeholder={ownCopy
                          ? 'Type the post exactly as it should go out.'
                          : 'e.g. Announce the new Riyadh showroom opening'}
                        value={s.text} onChange={e => updateSeed(i, { text: e.target.value })}
                      />
                      {/* The one decision that separates a brief from a post.
                          Off by default: the existing meaning of this box is
                          "a topic I want covered", and silently reinterpreting
                          everyone's seed posts as finished captions would
                          publish notes-to-self. */}
                      <label className="flex items-start gap-2 cursor-pointer select-none">
                        <input type="checkbox" checked={ownCopy}
                          onChange={e => updateSeed(i, { copyMode: e.target.checked ? 'own' : 'ai' })}
                          className="mt-0.5 accent-amber-600" />
                        <span className="text-[11px] leading-snug">
                          <span className={ownCopy ? 'font-semibold text-amber-700' : 'text-text-secondary'}>
                            This text is my final caption
                          </span>
                          <span className="block text-text-tertiary">
                            {ownCopy
                              ? 'Posted exactly as typed — no AI writes or rewrites it.'
                              : 'Leave off to have the caption written from this as a brief.'}
                          </span>
                        </span>
                      </label>
                      <div className="flex items-center gap-2 flex-wrap">
                        <select value={s.platform} onChange={e => onPlatformChange(e.target.value)}
                          className="rounded-lg border border-border px-2 py-1.5 text-xs bg-white capitalize focus:outline-none focus:border-amber-400">
                          {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                        <select value={sFormat} onChange={e => onFormatChange(e.target.value)}
                          className="rounded-lg border border-border px-2 py-1.5 text-xs bg-white focus:outline-none focus:border-amber-400">
                          {formatsFor(s.platform).map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                        </select>
                        {sRatios.length > 1 && (
                          <select value={s.aspectRatio || defaultAspectRatio(s.platform, sFormat)} onChange={e => updateSeed(i, { aspectRatio: e.target.value })}
                            className="rounded-lg border border-border px-2 py-1.5 text-xs bg-white focus:outline-none focus:border-amber-400">
                            {sRatios.map(r => <option key={r} value={r}>{aspectLabel(r)} ({r})</option>)}
                          </select>
                        )}
                        {sSlides && (
                          <input type="number" min={sSlides.min} max={sSlides.max} value={s.slideCount || sSlides.default}
                            onChange={e => updateSeed(i, { slideCount: Number(e.target.value) || sSlides.default })}
                            title="Number of slides" className="w-14 rounded-lg border border-border px-2 py-1.5 text-xs bg-white focus:outline-none focus:border-amber-400" />
                        )}
                        <input type="date" value={s.date || ''} min={startDate || undefined} max={endDate || undefined}
                          onChange={e => updateSeed(i, { date: e.target.value })}
                          className="rounded-lg border border-border px-2 py-1.5 text-xs bg-white focus:outline-none focus:border-amber-400" />
                        <button onClick={() => openSeedImagePicker(i)}
                          className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium whitespace-nowrap transition-colors ${usingImage ? 'text-sage-700 bg-sage-50 hover:bg-sage-100' : refCount > 0 ? 'text-amber-700 bg-amber-50 hover:bg-amber-100' : 'text-text-tertiary hover:text-text hover:bg-surface-subtle border border-border'}`}>
                          {usingImage ? '🖼 Set' : refCount > 0 ? `📎 ${refCount}` : '🖼 Image'}
                        </button>
                        <button onClick={() => removeSeed(i)} className="ml-auto text-[11px] px-2 py-1.5 text-text-tertiary hover:text-red-500" title="Remove">✕ Remove</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            <button onClick={addSeed}
              className="w-full text-center text-sm font-semibold text-amber-700 hover:text-amber-800 px-3 py-2.5 rounded-xl border-2 border-dashed border-amber-200 hover:border-amber-300 hover:bg-amber-50/50 transition-colors">
              + Add a post
            </button>
          </div>

          {/* ── SECONDARY: AI-assist is an explicit, off-by-default add-on ── */}
          <div className="rounded-2xl border border-border bg-surface-subtle p-4 space-y-4">
            <Toggle checked={aiAssist} onChange={e => update({ aiAssist: e.target.checked })}
              label="Also let AI propose additional posts this month" />
            <p className="text-[11px] text-text-tertiary -mt-2.5">Fills out the rest of the month around your posts above. Leave this off for a plan that's exactly what you added.</p>

            {aiAssist && (
              <div className="space-y-4 pt-3 border-t border-border">
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label="Roughly how many AI posts? (optional)"
                    type="number" min="1" placeholder="Let AI decide"
                    value={approxCount} onChange={e => update({ approxCount: e.target.value })} />
                  <Select label="Focus category (optional)" value={goalCategory} onChange={e => update({ goalCategory: e.target.value })}>
                    <option value="">General</option>
                    {GOALS.map(g => <option key={g} value={g}>{g}</option>)}
                  </Select>
                </div>

                <Textarea
                  label="Focus for the month (optional)"
                  placeholder="Leave blank for a well-rounded month, or steer it — e.g. 'Push our facade & landscape lighting for hospitality developers ahead of Q2 projects.'"
                  value={goal} onChange={e => update({ goal: e.target.value })} rows={3}
                />

                <Input
                  label="Target content mix (optional)"
                  placeholder="e.g. 40% product, 20% educational, 20% trust/testimonials, 20% engagement"
                  value={contentMixTarget} onChange={e => update({ contentMixTarget: e.target.value })}
                />
                <p className="text-[11px] text-text-tertiary -mt-2.5">The planner will aim for this ratio. Once ideas are proposed, the board shows the actual breakdown next to it.</p>

                {featurableItems.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-text-secondary mb-2">Feature these this month (optional)</p>
                    <div className="flex gap-2 flex-wrap">
                      {featurableItems.map(item => {
                        const active = featuredProductIds.includes(item.id)
                        return (
                          <button key={item.id} onClick={() => toggleProduct(item.id)}
                            className={`px-3 py-1.5 rounded-xl border text-sm font-medium transition-all ${active ? 'bg-amber-600 text-white border-amber-600' : 'bg-white border-border text-text-secondary hover:border-amber-400'}`}>
                            {item.name}<span className={active ? 'opacity-75 ml-1' : 'text-text-tertiary ml-1'}>· {item.sectionTitle}</span>
                          </button>
                        )
                      })}
                    </div>
                    <p className="text-[11px] text-text-tertiary mt-1.5">The plan will spread coverage across these instead of picking whatever's easiest to write.</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {error && <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-xs text-red-600">{error}</div>}

          <div className="flex gap-3 pt-1">
            <Button variant="secondary" onClick={() => { clear(); navigate('/campaigns') }}>Cancel</Button>
            <Button onClick={handleGeneratePlan} disabled={loading}>
              {loading ? <><Spinner size="sm" /> Building the plan…</> : aiAssist ? 'Generate Monthly Plan' : 'Create Plan'}
            </Button>
          </div>
        </Card>
      )}

      {/* ── STEP: REVIEW & APPROVE ── */}
      {step === 'review' && (
        <div className="space-y-4">
          <Card className="p-5 space-y-4">
            <Input label="Plan name" value={name} onChange={e => update({ name: e.target.value })} />

            {/* Review progress */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Reviewed</span>
                <span className="text-[11px] font-bold text-text">{reviewedCount} / {ideas.length}{seasonalCount > 0 && <span className="text-amber-700 font-semibold ml-2">★ {seasonalCount} seasonal</span>}</span>
              </div>
              <div className="h-1.5 bg-stone-100 border border-border overflow-hidden flex">
                <div className="h-full bg-sage-400 transition-all duration-300" style={{ width: `${ideas.length ? (approvedCount / ideas.length) * 100 : 0}%` }} />
                <div className="h-full bg-red-300 transition-all duration-300" style={{ width: `${ideas.length ? (rejectedCount / ideas.length) * 100 : 0}%` }} />
              </div>
            </div>

            {/* Content mix — makes imbalance (7 product, 1 tip) visible at a
                glance instead of something you'd only notice reading every card. */}
            {(pillarBreakdown.sorted.length > 0 || contentMixTarget) && (
              <div className="bg-surface-subtle border border-border px-3 py-2.5">
                <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                  <span className="font-semibold text-text-secondary">Mix:</span>
                  {pillarBreakdown.sorted.map(([pillar, n]) => (
                    <span key={pillar} className="px-1.5 py-0.5 leading-[1.4] border bg-white border-border text-text-secondary">
                      {n} {pillar}
                    </span>
                  ))}
                  {pillarBreakdown.unlabeled > 0 && (
                    <span className="px-1.5 py-0.5 leading-[1.4] border bg-white border-border text-text-tertiary">
                      {pillarBreakdown.unlabeled} unlabeled
                    </span>
                  )}
                </div>
                {contentMixTarget && (
                  <p className="text-[11px] text-text-tertiary mt-1.5"><span className="font-medium">Target:</span> {contentMixTarget}</p>
                )}
              </div>
            )}

            {/* Status filters */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {[['all', 'All', ideas.length], ['undecided', 'Undecided', proposedCount], ['approved', 'Approved', approvedCount], ['rejected', 'Rejected', rejectedCount]].map(([val, label, n]) => (
                <button key={val} onClick={() => setStatusFilter(val)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${statusFilter === val ? 'bg-amber-600 text-white' : 'bg-white border border-border text-text-secondary hover:border-amber-300'}`}>
                  {label}{n > 0 && <span className={statusFilter === val ? 'opacity-75 ml-1' : 'text-text-tertiary ml-1'}>{n}</span>}
                </button>
              ))}
              {seasonalCount > 0 && (
                <button onClick={() => setSeasonalOnly(v => !v)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${seasonalOnly ? 'bg-amber-100 text-amber-800 border border-amber-300' : 'bg-white border border-border text-text-secondary hover:border-amber-300'}`}>
                  ★ Seasonal
                </button>
              )}
              {dayFilter && (
                <button onClick={() => setDayFilter(null)}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-amber-600 text-white flex items-center gap-1">
                  {formatDate(dayFilter)} ✕
                </button>
              )}
              <div className="flex items-center gap-1 ml-auto">
                {platforms.length > 1 && (
                  <div className="flex items-center gap-1 mr-2">
                    {['all', ...platforms].map(p => (
                      <button key={p} onClick={() => setPlatformFilter(p)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold capitalize transition-colors ${platformFilter === p ? 'bg-stone-800 text-white' : 'bg-white border border-border text-text-secondary hover:border-stone-300'}`}>
                        {p === 'all' ? 'Both' : p}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex items-center rounded-lg border border-border overflow-hidden">
                  <button onClick={() => setViewMode('list')}
                    className={`px-2.5 py-1 text-[11px] font-semibold transition-colors ${viewMode === 'list' ? 'bg-stone-800 text-white' : 'bg-white text-text-secondary hover:bg-surface-subtle'}`}>
                    ☰ List
                  </button>
                  <button onClick={() => setViewMode('calendar')}
                    className={`px-2.5 py-1 text-[11px] font-semibold transition-colors ${viewMode === 'calendar' ? 'bg-stone-800 text-white' : 'bg-white text-text-secondary hover:bg-surface-subtle'}`}>
                    📅 Calendar
                  </button>
                </div>
              </div>
            </div>

            {/* Bulk actions */}
            <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-border">
              <span className="text-[11px] text-text-tertiary pt-2">Bulk:</span>
              <Button variant="secondary" size="xs" onClick={() => bulkStatus('approved')} disabled={busy}>Approve all</Button>
              <Button variant="secondary" size="xs" onClick={() => bulkStatus('rejected')} disabled={busy}>Reject all</Button>
              <Button variant="secondary" size="xs" onClick={() => bulkStatus('proposed')} disabled={busy}>Reset</Button>
              <Button variant="ghost" size="xs" onClick={() => setShowMoreModal(true)} disabled={busy} className="ml-auto">✨ Generate more with AI</Button>
              <Button variant="ghost" size="xs" onClick={addIdea} disabled={busy}>+ Add idea</Button>
            </div>

            {/* What the copy on this board was written against. Shown once for
                the board rather than once per card: it is the same context for
                every idea here, and twelve identical chips would be noise. No
                mute control — the captions were already written, so a toggle
                here would only describe a past call. */}
            <div className="pt-1">
              <BrandContextPanel context={draftContext} task="caption" />
            </div>
          </Card>

          {showMoreModal && (
            <GenerateMoreModal defaultCount={5} loading={moreLoading} error={moreError}
              onClose={() => { setShowMoreModal(false); setMoreError('') }} onGenerate={handleGenerateMore} />
          )}

          {/* Month overview — clicking a day filters the list below to it */}
          {viewMode === 'calendar' && ideas.length > 0 && (
            <CalendarView ideas={ideas} startDate={startDate} endDate={endDate} selectedDay={dayFilter} onDayClick={pickCalendarDay} />
          )}

          {/* Grouped, filtered idea list */}
          {viewMode === 'calendar' ? null : ideas.length === 0 ? (
            <Card className="p-6"><p className="text-xs text-text-tertiary text-center">No ideas left — go back and regenerate.</p></Card>
          ) : filteredIdeas.length === 0 ? (
            <Card className="p-6"><p className="text-xs text-text-tertiary text-center">No ideas match this filter.</p></Card>
          ) : (
            <div className="space-y-5">
              {weekGroups.map(group => (
                <div key={group.key} className="space-y-2.5">
                  <div className="flex items-center gap-2 px-1">
                    <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wide">{group.label}</span>
                    <span className="text-[10px] text-text-tertiary">{group.ideas.length} post{group.ideas.length !== 1 ? 's' : ''}</span>
                    <div className="h-px bg-border flex-1" />
                  </div>
                  {group.ideas.map(idea => (
                    <IdeaCard key={idea.id} idea={idea} index={ideas.indexOf(idea)} accessToken={accessToken} workspaceId={activeWorkspaceId}
                      autoEdit={idea.id === autoEditId} mediaOptionsUrl={state.webhooks?.mediaOptions}
                      brandName={state.brandProfile?.customFields?.brand_name || ''}
                      onChange={onIdeaChange} onRemove={onIdeaRemove} onCreate={onIdeaCreate}
                      onOpenStudio={openStudio} studioSession={studioSessions[idea.id]}
                      onRedraft={redraftIdea} />
                  ))}
                </div>
              ))}
            </div>
          )}

          {error && <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-xs text-red-600">{error}</div>}

          <div className="sticky bottom-0 -mx-1 px-1 pb-1">
            <div className="flex items-center gap-3 bg-white/95 backdrop-blur-sm border border-border rounded-2xl shadow-dropdown px-5 py-3.5">
              {/* A plan opened from the list (or returned to from Studio) never
                  had its setup step filled out in this session — stepping
                  "back" to setup would drop you on a blank form unrelated to
                  this plan. Send those back to where they came from instead. */}
              <Button variant="secondary" onClick={() => openedFromPlanList ? navigate('/campaigns/plans') : update({ step: 'setup' })}>Back</Button>
              <Button onClick={() => update({ step: 'media' })} disabled={approvedCount === 0}>
                Next — make the pictures ({approvedCount} approved)
              </Button>
              <p className="text-xs text-text-tertiary flex-1">
                {aiCopyCount === 0
                  ? 'Attach your own image to each, or make one in the Studio. Your captions go out exactly as written.'
                  : 'Every approved idea gets its image or video made by hand in the Studio, then the captions are written to match.'}
              </p>
            </div>
          </div>
        </div>
      )}


      {/* ── STEP: MEDIA ──
          The stage the marketing team actually works in. An image is finished
          when the person making it has edited and re-iterated until she is
          happy with it — never when a model returns something first time — so
          this is a worklist, not a progress bar you watch. Nothing here
          generates anything; every card is a door into the Studio. */}
      {step === 'media' && (
        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex items-baseline justify-between gap-4 mb-3">
              <div>
                <h2 className="text-base font-bold text-text tracking-tight">Make the pictures</h2>
                <p className="text-xs text-text-secondary mt-0.5">
                  Open each idea in the Studio and work on it until it's right. Captions come after —
                  written against the picture you actually chose.
                </p>
              </div>
              <p className="text-sm font-semibold text-text flex-shrink-0">
                {mediaReadyCount} of {approvedIdeas.length} ready
              </p>
            </div>
            <div className="h-1.5 bg-surface-subtle overflow-hidden">
              <div className="h-full bg-sage-500 transition-all"
                style={{ width: `${approvedIdeas.length ? (mediaReadyCount / approvedIdeas.length) * 100 : 0}%` }} />
            </div>
          </Card>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {approvedIdeas.map(idea => {
              // An own-image idea reads as ready without ever entering the
              // Studio — the picture is the one the operator attached.
              const ownMedia = hasOwnMedia(idea)
              const st = idea.mediaStatus === 'ready' || ownMedia ? 'ready' : (idea.mediaStatus || 'none')
              const sess = studioSessions[idea.id]
              return (
                <Card key={idea.id} className={`p-3 flex flex-col gap-2 ${st === 'ready' ? 'border-sage-200 bg-sage-50/30' : ''}`}>
                  <div className="flex items-start gap-2.5">
                    {idea.previewImageUrl ? (
                      <img src={idea.previewImageUrl} alt="" className="w-14 h-14 object-cover border border-border flex-shrink-0" />
                    ) : (
                      <div className="w-14 h-14 border border-dashed border-border bg-surface-subtle flex items-center justify-center flex-shrink-0 text-text-disabled text-lg">
                        {idea.mediaType === 'video' ? '🎬' : '🖼'}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-text leading-snug line-clamp-2">{idea.title || idea.topic || 'Untitled idea'}</p>
                      <p className="text-[10px] text-text-tertiary mt-0.5">
                        {idea.date ? formatDate(idea.date) : 'No date'} · {aspectLabel(idea.aspectRatio)}
                      </p>
                      <span className={`inline-block mt-1 text-[10px] font-bold px-1.5 py-0.5 leading-[1.4] ${
                        st === 'ready' ? 'bg-sage-100 text-sage-700'
                        : st === 'in_studio' ? 'bg-violet-50 text-violet-700'
                        : 'bg-stone-100 text-text-tertiary'}`}>
                        {ownMedia ? '✓ Your image' : st === 'ready' ? '✓ Ready' : st === 'in_studio' ? '🎬 In Studio' : 'Not started'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 mt-auto pt-1 flex-wrap">
                    {/* Two ways to get a picture, neither privileged. Someone
                        posting a photo they already have should never have to
                        go through a generation surface to attach it. */}
                    <Button size="xs" variant={ownMedia ? 'secondary' : 'primary'} onClick={() => openMediaPicker(idea)}>
                      {ownMedia ? 'Change image' : 'Use my image'}
                    </Button>
                    <Button size="xs" variant="secondary" onClick={() => openStudio(idea)}>
                      {idea.mediaStatus === 'ready' ? 'Change it' : sess ? 'Back to Studio' : 'Open Studio'}
                    </Button>
                    {idea.mediaStatus === 'ready' && (
                      <button onClick={() => redoMedia(idea)}
                        title="Start this one over — the picture is unset, the Studio session is kept"
                        className="text-[11px] text-text-tertiary hover:text-red-500 transition-colors ml-auto">Reset</button>
                    )}
                  </div>
                </Card>
              )
            })}
          </div>

          {error && <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-xs text-red-600">{error}</div>}

          <div className="sticky bottom-0 -mx-1 px-1 pb-1">
            <div className="flex items-center gap-3 bg-white/95 backdrop-blur-sm border border-border rounded-2xl shadow-dropdown px-5 py-3.5">
              <Button variant="secondary" onClick={() => update({ step: 'review' })}>Back to ideas</Button>
              {/* The label is the promise this button makes, so it has to
                  match which halves actually exist. Telling someone who wrote
                  every caption themselves that we are about to "write the
                  captions" describes the one thing they opted out of. */}
              <Button onClick={finalizePlan} disabled={busy || approvedCount === 0}>
                {busy
                  ? <><Spinner size="sm" /> {aiCopyCount ? 'Writing captions…' : 'Saving your posts…'}</>
                  : aiCopyCount === 0 ? 'Schedule my posts'
                  : ownCopyCount === 0 ? 'Write the captions'
                  : `Write ${aiCopyCount} caption${aiCopyCount === 1 ? '' : 's'} · save ${ownCopyCount} of mine`}
              </Button>
              {/* A soft gate. Blocking outright would just get worked around,
                  and there are real reasons to move on with one picture
                  outstanding. */}
              <p className="text-xs text-text-tertiary flex-1">
                {mediaReadyCount < approvedIdeas.length
                  ? aiCopyCount === 0
                    // Nothing generates on a fully manual plan, so the old
                    // reassurance ("they'll generate one instead") would be a
                    // promise this path cannot keep — those posts go out with
                    // no picture at all unless one is attached.
                    ? `${approvedIdeas.length - mediaReadyCount} still without a picture — those will be saved as text-only.`
                    : `${approvedIdeas.length - mediaReadyCount} still without a picture — you can carry on, they'll generate one instead.`
                  : aiCopyCount === 0
                    ? 'Every post has its media and its words. Nothing left to write.'
                    : 'Every idea has its media. Captions will be written against them.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── STEP: DONE ── */}
      {step === 'done' && (
        <Card className="p-8 text-center space-y-4">
          <div className="w-12 h-12 border border-sage-200 bg-sage-100 flex items-center justify-center mx-auto">
            <svg className="w-7 h-7 text-sage-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <div>
            {/* The heading has to be true for a fully manual plan too — there
                is nothing generating, and saying so would leave someone
                watching Approvals for posts that already arrived complete. */}
            <h2 className="text-lg font-bold text-text tracking-tight">
              {pushResult ? 'Plan approved — generating content now.' : 'Plan approved — your posts are ready to review.'}
            </h2>
            <p className="text-sm text-text-secondary mt-1 max-w-md mx-auto">
              <span className="font-semibold text-text">{approvedCount} idea{approvedCount === 1 ? '' : 's'}</span> approved for <span className="font-semibold text-text">{name}</span>.
              {manualResult?.count > 0 && (
                <> <span className="font-semibold text-text">{manualResult.count} written by you</span> {manualResult.count === 1 ? 'is' : 'are'} already sitting in Post Approvals, exactly as you typed {manualResult.count === 1 ? 'it' : 'them'}.</>
              )}
              {pushResult && pushResult.failedCount === 0
                ? ' The rest are being generated now (caption + image for each). This takes a few minutes — open Post Approvals and watch them appear as they\'re ready, where you can approve, reject, or regenerate each before scheduling.'
                : pushResult
                  ? ` ${pushResult.results.filter(r => r.ok).map(r => `${r.count} ${r.platform}`).join(', ') || '0'} sent to generate; some platforms failed — ${pushResult.results.filter(r => !r.ok).map(r => r.error).join(' ')}`
                  : ' Nothing was sent to AI — open Post Approvals to check them over and schedule.'}
            </p>
            {manualResult?.warnings?.length > 0 && (
              <p className="text-xs text-red-600 mt-2 max-w-md mx-auto">
                Some didn't save: {manualResult.warnings.join(' · ')}
              </p>
            )}
          </div>
          <div className="flex items-center justify-center gap-3 pt-2 flex-wrap">
            <Button onClick={() => navigate('/social/approvals')}>Open Post Approvals</Button>
            <Button variant="secondary" onClick={() => navigate('/campaigns/plans')}>View all plans</Button>
            <Button variant="secondary" onClick={() => { clear(); navigate('/campaigns/plan') }}>Plan another month</Button>
          </div>
        </Card>
      )}

      {/* Media-stage image picker — persists straight to the idea, since by
          this point the idea is a real row. No mode toggle: choosing here
          always means "this image IS the post". */}
      {mediaPickIdea && (
        <ReferencePicker
          value={mediaPickIdea.references || []}
          onSave={saveMediaImages}
          onClose={() => setMediaPickIdea(null)}
          format={mediaPickIdea.postFormat}
        />
      )}

      {/* Per-seed-post image picker (Stage-1 brief) — stores URLs + mode on the
          draft; nothing is persisted until the plan itself is created. */}
      {pickingSeedIdx !== null && (
        <ReferencePicker
          value={seedPosts[pickingSeedIdx]?.references || []}
          onSave={saveSeedImages}
          onClose={() => setPickingSeedIdx(null)}
          mode={seedPickerMode} onModeChange={setSeedPickerMode}
          format={seedPosts[pickingSeedIdx]?.postFormat}
        />
      )}
    </div>
  )
}

// ─── Kept for route compatibility; the per-post editor is now an inline modal
// on each idea card, so this simply routes back to the plan. ────────────────
export function CampaignPostEditor() {
  const navigate = useNavigate()
  useParams()
  return (
    <div className="max-w-2xl">
      <Card className="p-6">
        <Empty
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>}
          title="Edit ideas from the plan"
          description="Ideas are now edited inline — open a plan and click Edit on any idea."
          action={<Button onClick={() => navigate('/campaigns/plan')}>Back to planner</Button>}
        />
      </Card>
    </div>
  )
}
