import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useApp, actions } from '../../store/appStore'
import { useAuth } from '../../store/AuthContext'
import { Card, Button, Input, Textarea, Select, Spinner, Toggle, Empty, Modal } from '../../components/ui/index'
import { uid, formatDate } from '../../lib/utils'
import {
  isBrandProfileEmpty, useBrandProfileSync,
  BRAND_BRAIN_SECTIONS, DEFAULT_BRAND_BRAIN_SECTIONS, buildSectionBlocks,
} from '../../lib/brandBrain'
import { suppliersApi, competitorsApi, productsApi } from '../../lib/brandDirectory'
import { fetchBrandAssets } from '../../lib/brandAssets'
import { requestCampaignPlan, requestPlanContentGeneration, elongateIdea } from '../../lib/campaignPlanner'
import { suggestDesign } from '../../lib/designSuggestion'
import { ReferencePicker } from '../../components/ReferencePicker'
import {
  createPlan, insertIdeas, updateIdea, setAllIdeaStatus, deleteIdea, updatePlan, markIdeasProcessing,
  fetchPastIdeas,
} from '../../lib/contentPlans'

const GOALS = ['Brand awareness','Lead generation','Product launch','Community engagement','Event promotion','Sales & offers']
const PLATFORMS = ['instagram', 'linkedin'] // only platforms with a generation pipeline today

const IG_TONES = [
  { value: 'professional',  label: 'Professional' },
  { value: 'inspirational', label: 'Inspirational' },
  { value: 'educational',   label: 'Educational' },
  { value: 'casual',        label: 'Casual & Friendly' },
  { value: 'promotional',   label: 'Promotional' },
]
const LI_TONES = [
  { value: 'thought_leader',   label: 'Thought Leader' },
  { value: 'executive',        label: 'Executive' },
  { value: 'technical_expert', label: 'Technical Expert' },
  { value: 'warm_human',       label: 'Warm & Human' },
  { value: 'promotional',      label: 'Promotional' },
]
const toneLabel = p => (p.platform === 'linkedin' ? LI_TONES : IG_TONES).find(t => t.value === p.tone)?.label || p.tone

// IG and LinkedIn tones don't share a vocabulary — used when duplicating an
// idea across platforms so the copy lands on a sensible equivalent instead
// of an invalid value the other platform's dropdown won't recognize.
const TONE_CROSSWALK = {
  instagram_to_linkedin: { professional: 'thought_leader', inspirational: 'thought_leader', educational: 'technical_expert', casual: 'warm_human', promotional: 'promotional' },
  linkedin_to_instagram: { thought_leader: 'professional', executive: 'professional', technical_expert: 'educational', warm_human: 'casual', promotional: 'promotional' },
}
function crosswalkTone(tone, fromPlatform, toPlatform) {
  if (fromPlatform === toPlatform) return tone
  const map = TONE_CROSSWALK[`${fromPlatform}_to_${toPlatform}`]
  return map?.[tone] || (toPlatform === 'linkedin' ? 'thought_leader' : 'professional')
}
// Most visual styles are shared between platforms — only the "warm" variant
// has different names (warm_residential vs warm_interior) for what's really
// the same look.
function crosswalkStyle(style, fromPlatform, toPlatform) {
  if (fromPlatform === toPlatform || !style) return style
  if (style === 'warm_residential' && toPlatform === 'linkedin') return 'warm_interior'
  if (style === 'warm_interior' && toPlatform === 'instagram') return 'warm_residential'
  return style
}

const FORMATS = ['post', 'carousel', 'reel']

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

// What KIND of content each idea becomes — decided at plan time, drives the
// whole generation flow (caption? image? how many? text baked in?).
const POST_KINDS = [
  { value: 'caption_image', label: 'Caption + image',  hint: 'A caption and one image (the default).' },
  { value: 'caption_only',  label: 'Caption only',     hint: 'Just a caption, no image.' },
  { value: 'image_only',    label: 'Image only',       hint: 'Just an image, no caption.' },
  { value: 'carousel',      label: 'Carousel',         hint: 'A caption and multiple image slides.' },
  { value: 'text_image',    label: 'Text image',       hint: 'An image built around words/typography.' },
]
const postKindLabel = v => POST_KINDS.find(k => k.value === v)?.label || 'Caption + image'

// Saudi week (Sunday-first); Fri/Sat flagged as the weekend, not disabled —
// plenty of brands post through the weekend, this is just a hint.
const WEEKDAYS = [
  { value: 'sun', label: 'Sun' }, { value: 'mon', label: 'Mon' }, { value: 'tue', label: 'Tue' },
  { value: 'wed', label: 'Wed' }, { value: 'thu', label: 'Thu' },
  { value: 'fri', label: 'Fri', weekend: true }, { value: 'sat', label: 'Sat', weekend: true },
]

// Visual styles the generation pipeline understands, per platform. Shown as an
// editable chip on each idea (Stage 3) so the human can override the AI's pick.
const IG_STYLES = [
  { value: 'photorealistic',   label: 'Photorealistic' },
  { value: 'dramatic',         label: 'Dramatic' },
  { value: 'minimalist',       label: 'Minimalist' },
  { value: 'warm_residential', label: 'Warm residential' },
  { value: 'cool_commercial',  label: 'Cool commercial' },
  { value: 'facade_exterior',  label: 'Facade / exterior' },
]
const LI_STYLES = [
  { value: 'photorealistic',  label: 'Photorealistic' },
  { value: 'dramatic',        label: 'Dramatic' },
  { value: 'minimalist',      label: 'Minimalist' },
  { value: 'warm_interior',   label: 'Warm interior' },
  { value: 'cool_commercial', label: 'Cool commercial' },
  { value: 'facade_exterior', label: 'Facade / exterior' },
]
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const MONTH_ABBR  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// Client-side mirror of the seasonal moments the n8n planner knows about — used
// only to preview what falls in a chosen month before generating. Kept light;
// the workflow remains the source of truth for the actual plan.
const KSA_MOMENTS = [
  { name: 'Ramadan',       start: '2026-02-18', end: '2026-03-19' },
  { name: 'Founding Day',  start: '2026-02-22', end: '2026-02-22' },
  { name: 'Eid al-Fitr',   start: '2026-03-20', end: '2026-03-23' },
  { name: 'Eid al-Adha',   start: '2026-05-27', end: '2026-05-30' },
  { name: 'National Day',  start: '2026-09-23', end: '2026-09-23' },
  { name: 'Ramadan',       start: '2027-02-08', end: '2027-03-08' },
  { name: 'Eid al-Fitr',   start: '2027-03-09', end: '2027-03-12' },
  { name: 'National Day',  start: '2027-09-23', end: '2027-09-23' },
]
export function momentsInRange(startDate, endDate) {
  if (!startDate || !endDate) return []
  return KSA_MOMENTS.filter(m => m.start <= endDate && m.end >= startDate)
}

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

// Map a persisted plan_ideas row into the shape the UI/draft uses.
export function dbIdeaToDraft(row) {
  return {
    id: row.id,
    _rowId: row.id,
    platform: row.platform || 'instagram',
    date: row.scheduled_date || '',
    time: row.publish_time || '',
    title: row.title || '',
    topic: row.topic || '',
    angle: row.angle || '',
    tone: row.tone || '',
    occasion: row.occasion || '',
    pillar: row.content_pillar || '',
    rationale: row.rationale || '',
    objective: row.objective || '',
    cta: row.cta || '',
    hashtags: row.hashtags || '',
    firstComment: row.first_comment || '',
    series: row.series || '',
    rejectReason: row.reject_reason || '',
    format: row.suggested_format || 'post',
    suggestedStyle: row.suggested_style || '',
    suggestedAspectRatio: row.suggested_aspect_ratio || '',
    imageIdea: row.image_idea || '',
    postKind: row.post_kind || (row.suggested_format === 'carousel' ? 'carousel' : 'caption_image'),
    slideCount: row.slide_count || 1,
    imageText: row.image_text || '',
    imageMode: row.image_mode || 'generate',
    references: row.reference_image_urls || [],
    status: row.status || 'proposed',
    position: row.position ?? 0,
  }
}

const DEFAULT_DRAFT = {
  step: 'setup', // 'setup' | 'review' | 'done'
  month: '', goal: '', goalCategory: '', platforms: ['instagram', 'linkedin'],
  startDate: '', endDate: '', approxCount: '', includeHolidays: true,
  // Cadence: which weekdays this brand actually posts on (empty = AI decides
  // freely, today's behavior) and the default publish time for Instagram —
  // LinkedIn is biased to business hours by the planner regardless.
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
}

function useDraft() {
  const { state, dispatch } = useApp()
  // Merge over DEFAULT_DRAFT (not a plain `||` fallback) so an older persisted
  // draft missing newer fields (e.g. ideas, planId) can't leave them undefined.
  const draft = { ...DEFAULT_DRAFT, ...(state.campaignPlanDraft || {}) }
  const update = patch => dispatch(actions.setCampaignPlanDraft({ ...draft, ...patch }))
  const clear  = () => dispatch(actions.setCampaignPlanDraft(null))
  return { draft, update, clear, state, dispatch }
}

const OCCASION_STYLE = 'bg-amber-100 text-amber-800 border-amber-200'
const PILLAR_STYLE   = 'bg-purple-50 text-purple-700 border-purple-100'
const STATUS_META = {
  proposed: { label: 'Proposed', cls: 'bg-stone-100 text-stone-600' },
  approved: { label: 'Approved', cls: 'bg-sage-100 text-sage-700' },
  rejected: { label: 'Rejected', cls: 'bg-red-50 text-red-500 line-through' },
}

// ─── One idea in the review list, with inline approve/reject + edit ─────────
function IdeaCard({ idea, index, accessToken, onChange, onRemove, onCreate, onDuplicate, autoEdit = false }) {
  const [editing, setEditing] = useState(autoEdit)
  const [saving,  setSaving]  = useState(false)
  const [saveError, setSaveError] = useState('')
  const [duplicating, setDuplicating] = useState(false)
  const [showRejectReasons, setShowRejectReasons] = useState(false)
  const [pickingRefs, setPickingRefs] = useState(false)
  const [imgMode, setImgMode] = useState(idea.imageMode || 'generate')
  const tones = idea.platform === 'linkedin' ? LI_TONES : IG_TONES
  const refCount = (idea.references || []).length
  const usingImage = idea.imageMode === 'use_reference'

  // Persist both the chosen images and the AI-vs-use-image mode together, so
  // the card and generation always agree on how this idea's image is produced.
  async function saveReferences(urls) {
    const result = await updateIdea(accessToken, idea.id, { reference_image_urls: urls, image_mode: imgMode })
    if (result.ok) { onChange({ ...idea, references: urls, imageMode: imgMode }); setPickingRefs(false); return { ok: true } }
    return { error: result.error || 'Could not save.' }
  }
  function openImagePicker() { setImgMode(idea.imageMode || 'generate'); setPickingRefs(true) }

  async function duplicateToOtherPlatform() {
    setDuplicating(true)
    await onDuplicate(idea)
    setDuplicating(false)
  }

  async function setStatus(status, rejectReason = '') {
    setSaving(true)
    // Approving (or re-approving after a rejection) clears any old reason —
    // it shouldn't linger once the idea is no longer rejected.
    const result = await updateIdea(accessToken, idea.id, { status, reject_reason: rejectReason })
    setSaving(false)
    if (result.ok) onChange({ ...idea, status, rejectReason })
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
      suggested_format: patch.format,
      suggested_style: patch.suggestedStyle || '', image_idea: patch.imageIdea || '',
      objective: patch.objective || '', cta: patch.cta || '',
      hashtags: patch.hashtags || '', first_comment: patch.firstComment || '',
      series: patch.series || '',
      post_kind: patch.postKind || 'caption_image',
      slide_count: patch.slideCount || 1,
      image_text: patch.imageText || '',
    }
    const result = await updateIdea(accessToken, idea.id, dbPatch)
    setSaving(false)
    if (result.ok) { onChange({ ...idea, ...patch }); setEditing(false) }
  }

  const st = STATUS_META[idea.status] || STATUS_META.proposed
  const rejected = idea.status === 'rejected'

  return (
    <div className={`rounded-2xl border transition-all ${rejected ? 'border-border bg-surface-subtle/40 opacity-70' : idea.status === 'approved' ? 'border-sage-200 bg-sage-50/30' : 'border-border bg-white'}`}>
      <div className="p-4">
        <div className="flex items-start gap-3">
          <span className="text-[11px] font-bold text-text-disabled w-5 flex-shrink-0 text-right pt-0.5">{index + 1}</span>
          <div className="flex-1 min-w-0">
            {/* Badges */}
            <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${idea.platform === 'linkedin' ? 'bg-[#0A66C2]/10 text-[#0A66C2]' : 'bg-pink-50 text-pink-600'}`}>
                {idea.platform === 'linkedin' ? 'LinkedIn' : 'Instagram'}
              </span>
              {idea.occasion && <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${OCCASION_STYLE}`}>★ {idea.occasion}</span>}
              {idea.pillar && <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${PILLAR_STYLE}`}>{idea.pillar}</span>}
              {idea.series && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-violet-50 text-violet-700 border-violet-100" title="Deliberate recurring series — not flagged as repetition across months">🔁 {idea.series}</span>}
              {idea.objective && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full border bg-sky-50 text-sky-700 border-sky-100">{idea.objective}</span>}
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full border bg-indigo-50 text-indigo-700 border-indigo-100">{postKindLabel(idea.postKind)}{idea.postKind === 'carousel' && idea.slideCount > 1 ? ` ·${idea.slideCount}` : ''}</span>
              <span className="text-[10px] text-text-tertiary">{idea.date ? formatDate(idea.date) : 'No date'}{idea.time ? ` · ${formatTime(idea.time)}` : ''}</span>
              {idea.imageIdea && !usingImage && <span className="text-[10px] font-semibold text-purple-600" title={idea.imageIdea}>· 🎨 your vision</span>}
              {usingImage
                ? <span className="text-[10px] font-semibold text-sage-700">· 🖼 using {refCount || 'no'} image{refCount !== 1 ? 's' : ''}</span>
                : refCount > 0 && <span className="text-[10px] font-semibold text-amber-700">· 📎 {refCount} ref{refCount !== 1 ? 's' : ''}</span>}
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
          <span className={`text-[10px] font-semibold px-2 py-1 rounded-full flex-shrink-0 ${st.cls}`}>{st.label}</span>
        </div>

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
            <button onClick={duplicateToOtherPlatform} disabled={duplicating}
              title={`Copy this idea to ${idea.platform === 'linkedin' ? 'Instagram' : 'LinkedIn'} — tone adapts automatically, images are not carried over`}
              className="text-[11px] font-medium px-2.5 py-1 rounded-lg text-text-tertiary hover:text-text hover:bg-surface-subtle transition-colors disabled:opacity-50">
              {duplicating ? <><Spinner size="sm" /> Copying…</> : `⧉ Also ${idea.platform === 'linkedin' ? 'Instagram' : 'LinkedIn'}`}
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
          mode={imgMode} onModeChange={setImgMode} format={idea.postKind === 'carousel' ? 'carousel' : idea.format} />
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
  const [format,    setFormat]    = useState(idea.format || 'post')
  const [style,     setStyle]     = useState(idea.suggestedStyle || '')
  const [imageIdea, setImageIdea] = useState(idea.imageIdea || '')
  const [objective, setObjective] = useState(idea.objective || '')
  const [cta,       setCta]       = useState(idea.cta || '')
  const [hashtags,  setHashtags]  = useState(idea.hashtags || '')
  const [firstComment, setFirstComment] = useState(idea.firstComment || '')
  const [series, setSeries] = useState(idea.series || '')
  // "Post type" (caption/image/carousel/text) and "image source" (AI-generated
  // vs your own upload, set via the 🖼 Image button) are two separate
  // decisions. text_image means "bake words into the image" — meaningless
  // once the image is already your own fixed photo, so hide it in that case.
  const usingOwnImage = idea.imageMode === 'use_reference' && (idea.references || []).length > 0
  const availableKinds = usingOwnImage ? POST_KINDS.filter(k => k.value !== 'text_image') : POST_KINDS
  const [postKind,  setPostKind]  = useState(() => {
    const saved = idea.postKind || 'caption_image'
    return availableKinds.some(k => k.value === saved) ? saved : 'caption_image'
  })
  const [slideCount,setSlideCount]= useState(idea.slideCount || 3)
  const [imageText, setImageText] = useState(idea.imageText || '')
  const styles = idea.platform === 'linkedin' ? LI_STYLES : IG_STYLES
  const kindHint = POST_KINDS.find(k => k.value === postKind)?.hint || ''
  const showsImageFields = postKind !== 'caption_only'

  return (
    <Modal open onClose={onClose} title={idea.isNew ? 'Add idea' : 'Edit idea'} width="max-w-xl">
      <div className="p-6 space-y-4">
        <Input label="Topic / what the post is about" value={topic} onChange={e => setTopic(e.target.value)} />
        <Textarea label="Angle (optional)" rows={2} value={angle} onChange={e => setAngle(e.target.value)} />

        {/* Post type drives the whole flow — caption? image? how many? */}
        <div>
          <Select label="Post type" value={postKind} onChange={e => setPostKind(e.target.value)}>
            {availableKinds.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
          </Select>
          <p className="text-[11px] text-text-tertiary mt-1">{kindHint}</p>
          {usingOwnImage && showsImageFields && (
            <p className="text-[11px] text-sage-700 mt-1">
              📎 You've attached your own image for this post — no AI image generation will happen. "Image" here just means the post includes it; this setting only decides whether a caption is written to go with it.
            </p>
          )}
        </div>

        {postKind === 'carousel' && (
          <Input label="How many slides?" type="number" min="2" max="10"
            value={slideCount} onChange={e => setSlideCount(Number(e.target.value) || 3)} />
        )}
        {postKind === 'text_image' && (
          <Input label="Text to feature in the image"
            placeholder="e.g. رمضان كريم  ·  or  ·  40% OFF this week"
            value={imageText} onChange={e => setImageText(e.target.value)} />
        )}

        {/* Image direction — hidden for caption-only posts. */}
        {showsImageFields && (
          <Textarea
            label="Your vision for the image (optional)"
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
          {showsImageFields && (
            <Select label="Visual style" value={style} onChange={e => setStyle(e.target.value)}>
              <option value="">AI decides</option>
              {styles.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select>
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
          <Button onClick={() => onSave({ topic, angle, tone, date, time, format, suggestedStyle: style, imageIdea, objective, cta, hashtags, firstComment, series, postKind, slideCount, imageText })} disabled={saving || (idea.isNew && !topic.trim())}>
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
                        {i.platform === 'linkedin' ? '💼' : '📷'} {i.title || i.topic || 'Untitled'}
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
  const { activeWorkspaceId, accessToken } = useAuth()
  const webhookUrl = state.webhooks?.campaignPlanner || ''
  useBrandProfileSync(state, dispatch)

  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [busy,    setBusy]    = useState(false)

  // Directory data behind the Brand Brain section toggles — fetched once so
  // the setup step can show live counts and plan generation can pull from it.
  const [directory, setDirectory] = useState({ suppliers: [], competitors: [], products: [], assets: [] })
  useEffect(() => {
    if (!activeWorkspaceId) return
    Promise.all([
      suppliersApi.list(activeWorkspaceId, accessToken),
      competitorsApi.list(activeWorkspaceId, accessToken),
      productsApi.list(activeWorkspaceId, accessToken),
      fetchBrandAssets(activeWorkspaceId, accessToken),
    ]).then(([suppliers, competitors, products, assets]) => {
      setDirectory({ suppliers, competitors, products, assets })
    })
  }, [activeWorkspaceId, accessToken])

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

  const { step, month, goal, goalCategory, platforms, startDate, endDate, approxCount, includeHolidays, brandBrainSections, featuredProductIds, seedPosts, name, ideas, planId, pushResult, postingDays, defaultTime, aiAssist, contentMixTarget } = draft
  const months = monthOptions()

  const togglePlatform = p => update({ platforms: platforms.includes(p) ? platforms.filter(x => x !== p) : [...platforms, p] })
  const toggleSection  = s => update({ brandBrainSections: brandBrainSections.includes(s) ? brandBrainSections.filter(x => x !== s) : [...brandBrainSections, s] })
  const toggleProduct  = id => update({ featuredProductIds: featuredProductIds.includes(id) ? featuredProductIds.filter(x => x !== id) : [...featuredProductIds, id] })
  const toggleDay      = d  => update({ postingDays: postingDays.includes(d) ? postingDays.filter(x => x !== d) : [...postingDays, d] })

  // ── Seed posts (specific posts the user already wants, optionally with images) ──
  const addSeed    = ()          => update({ seedPosts: [...seedPosts, { text: '', platform: platforms[0] || 'instagram', format: 'post', date: '', references: [], imageMode: 'generate' }] })
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
        text: s.text.trim(), platform: s.platform, format: s.format, date: s.date || null,
        image_mode: s.imageMode || 'generate', reference_image_urls: s.references || [],
      }))
    const seedIdeas = cleanSeeds.map(s => ({
      platform: s.platform, date: s.date, title: s.text, topic: s.text, format: s.format,
      tone: s.platform === 'linkedin' ? 'thought_leader' : 'professional',
      rationale: 'You added this as a specific post you wanted.',
      imageMode: s.image_mode, references: s.reference_image_urls,
    }))

    let aiPosts = []
    let featuredProducts = []
    let effectiveGoal = ''
    if (aiAssist) {
      const blocks = buildSectionBlocks(state.brandProfile, directory)
      const instructions = brandBrainSections.map(s => blocks[s]).filter(Boolean).join('\n\n')
      effectiveGoal = goal.trim() ||
        'A well-rounded month of brand content for Arak Lighting — a mix of project showcases, product highlights, educational lighting content, and the seasonal/cultural moments falling in this month.'
      // Stage-1 brief material: the products to feature (full context, not
      // just ids), so the planner can build a coherent month around them.
      featuredProducts = directory.products
        .filter(p => featuredProductIds.includes(p.id))
        .map(p => ({ name: p.name, category: p.category || '', specs: p.specs || '', description: p.description || '' }))

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
        featured_products: featuredProducts,
        seed_posts: cleanSeeds,
        content_mix_target: contentMixTarget || null,
        past_ideas: pastIdeas,
        posting_days: postingDays,
        posting_time: defaultTime,
      })
      if (result.error) { setLoading(false); setError(result.error); return }
      aiPosts = result.posts
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

    update({
      planId: planRes.plan.id,
      ideas: ideasRes.rows.map(dbIdeaToDraft),
      name: planRes.plan.name,
      step: 'review',
    })
  }

  // Top up the existing plan with more AI ideas — same webhook, but with the
  // plan's current ideas (any status) sent as `existing_ideas` so the n8n
  // workflow's prompt can steer away from repeating them.
  async function handleGenerateMore({ count, focus }) {
    if (!webhookUrl) { setMoreError('Campaign Planner webhook not configured (Settings → Integrations).'); return }
    setMoreError(''); setMoreLoading(true)

    const blocks = buildSectionBlocks(state.brandProfile, directory)
    const instructions = brandBrainSections.map(s => blocks[s]).filter(Boolean).join('\n\n')
    const effectiveGoal = focus.trim() || goal.trim() ||
      'A well-rounded month of brand content for Arak Lighting — a mix of project showcases, product highlights, educational lighting content, and the seasonal/cultural moments falling in this month.'
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
      existing_ideas: existingIdeas,
      past_ideas: pastIdeas,
      posting_days: postingDays,
      posting_time: defaultTime,
    })
    if (result.error) { setMoreLoading(false); setMoreError(result.error); return }

    const ideasRes = await insertIdeas(activeWorkspaceId, accessToken, planId, result.posts, ideas.length)
    setMoreLoading(false)
    if (ideasRes.error) { setMoreError(`Generated but couldn't be saved: ${ideasRes.error}`); return }

    update({ ideas: [...ideas, ...ideasRes.rows.map(dbIdeaToDraft)] })
    setShowMoreModal(false)
  }

  function onIdeaChange(updated) {
    update({ ideas: ideas.map(i => i.id === updated.id ? updated : i) })
  }
  async function onIdeaRemove(idea) {
    update({ ideas: ideas.filter(i => i.id !== idea.id) })
    // isNew ideas never made it to the database (see addIdea/onIdeaCreate) —
    // nothing to delete server-side, and deleteIdea would just no-op on a
    // fake temp id anyway.
    if (!idea.isNew) await deleteIdea(accessToken, idea.id)
  }

  // Copies a fully-briefed idea onto the OTHER platform — same topic/angle/
  // objective/cta/image direction, with tone and style remapped to that
  // platform's own vocabulary (see crosswalkTone/crosswalkStyle). Deliberately
  // does NOT copy reference images: they were picked/cropped for the
  // original platform's aspect ratio, which the other platform doesn't share.
  // Not auto-elongated — this idea already has a full brief, unlike a bare
  // "+ Add idea" draft.
  async function onIdeaDuplicate(idea) {
    if (idea.isNew) return
    const targetPlatform = idea.platform === 'linkedin' ? 'instagram' : 'linkedin'
    const res = await insertIdeas(activeWorkspaceId, accessToken, planId, [{
      platform: targetPlatform, date: idea.date, time: idea.time,
      title: idea.title || idea.topic, topic: idea.topic, angle: idea.angle,
      tone: crosswalkTone(idea.tone, idea.platform, targetPlatform),
      occasion: idea.occasion, pillar: idea.pillar,
      objective: idea.objective, cta: idea.cta, format: idea.format,
      suggestedStyle: crosswalkStyle(idea.suggestedStyle, idea.platform, targetPlatform),
      imageIdea: idea.imageIdea,
      // Hashtag conventions differ by platform (Instagram: dense; LinkedIn:
      // few/none) — reset rather than carry over verbatim. First comment
      // isn't platform-specific, so it copies over fine.
      firstComment: idea.firstComment, series: idea.series,
      postKind: idea.postKind, slideCount: idea.slideCount, imageText: idea.imageText,
    }], ideas.length)
    if (res.error || !res.rows?.[0]) { setError(res.error || 'Could not duplicate idea.'); return }
    const created = dbIdeaToDraft(res.rows[0])
    update({ ideas: [...ideas, created] })
    setAutoEditId(created.id)
    setTimeout(() => setAutoEditId(null), 400)
  }

  // Called once the "+ Add idea" editor's Save is clicked — this is the
  // only point a manually-added idea actually gets written to the database.
  async function onIdeaCreate(tempIdea, patch) {
    const merged = { ...tempIdea, ...patch }
    const res = await insertIdeas(activeWorkspaceId, accessToken, planId, [{
      platform: merged.platform, date: merged.date, time: merged.time, title: merged.topic || 'New idea',
      topic: merged.topic, angle: merged.angle, tone: merged.tone, format: merged.format,
      suggestedStyle: merged.suggestedStyle, imageIdea: merged.imageIdea,
      objective: merged.objective, cta: merged.cta,
      hashtags: merged.hashtags, firstComment: merged.firstComment, series: merged.series,
      postKind: merged.postKind, slideCount: merged.slideCount, imageText: merged.imageText,
    }], ideas.length)
    if (res.error || !res.rows?.[0]) return { error: res.error || 'Could not save idea.' }
    let created = dbIdeaToDraft(res.rows[0])

    // A manually-typed idea only has a thin topic/tone — ask AI to flesh it
    // out into a real brief (angle/objective/cta/design direction), the same
    // fields an AI-suggested idea already gets, BEFORE the user approves it.
    // Best-effort: if this fails or isn't configured, the idea just stays as
    // typed — never blocks the save itself.
    const elongateUrl = state.webhooks?.elongateIdea
    if (elongateUrl) {
      const blocks = buildSectionBlocks(state.brandProfile, directory)
      const instructions = brandBrainSections.map(s => blocks[s]).filter(Boolean).join('\n\n')
      const elongated = await elongateIdea(elongateUrl, {
        instructions,
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

    update({ ideas: ideas.map(i => i.id === tempIdea.id ? created : i) })
    // Re-open the editor on the now-enriched idea (the card remounts under its
    // real id the instant `ideas` updates, since IdeaCard is keyed by id) so
    // the user sees the elongated brief and can adjust it before approving.
    setAutoEditId(created.id)
    setTimeout(() => setAutoEditId(null), 400)
    return { ok: true, idea: created }
  }

  async function bulkStatus(status) {
    setBusy(true)
    await setAllIdeaStatus(accessToken, planId, status)
    update({ ideas: ideas.map(i => ({ ...i, status })) })
    setBusy(false)
  }

  // Add a blank, unsaved idea card and open its editor — nothing is written
  // to the database until the user clicks Save (see onIdeaCreate).
  function addIdea() {
    const draftIdea = {
      id: `new_${uid()}`, isNew: true, status: 'proposed',
      platform: platformFilter !== 'all' ? platformFilter : (platforms[0] || 'instagram'),
      date: startDate, title: '', topic: '', angle: '', format: 'post',
      tone: (platformFilter === 'linkedin' || platforms[0] === 'linkedin') ? 'thought_leader' : 'professional',
    }
    setStatusFilter('all'); setSeasonalOnly(false); setPlatformFilter('all')
    setAutoEditId(draftIdea.id)
    update({ ideas: [...ideas, draftIdea] })
    // autoEdit only needs to be true for the new card's first mount; clear it
    // afterwards so re-filtering doesn't re-open the editor unexpectedly.
    setTimeout(() => setAutoEditId(null), 400)
  }

  async function finalizePlan() {
    const approved = ideas.filter(i => i.status === 'approved')
    if (approved.length === 0) { setError('Approve at least one idea before finalizing the plan.'); return }
    setError(''); setBusy(true)

    const blocks = buildSectionBlocks(state.brandProfile, directory)
    const instructions = brandBrainSections.map(s => blocks[s]).filter(Boolean).join('\n\n')
    // Fire the approved ideas at the Plan Generation webhooks — each one
    // generates the real caption + image into *_generated_posts as
    // 'pending_review'. The user then reviews the actual content (Instagram /
    // LinkedIn → Posts, "Pending review") before it's cleared to schedule.
    // Mark every approved idea 'processing' BEFORE firing the webhook — durable
    // and instant, so Post Approvals shows real state even on reload, not just
    // while this tab stays open waiting for n8n's background generation.
    await markIdeasProcessing(accessToken, planId)

    const pushResult = await requestPlanContentGeneration({
      webhooks: state.webhooks, planId, instructions, ideas: approved,
      workspaceId: activeWorkspaceId,
      captionLanguage: state.brandProfile?.captionLanguage || 'both',
    })
    if (pushResult.error) { setBusy(false); setError(pushResult.error); return }
    await updatePlan(accessToken, planId, { status: 'generating' })

    setBusy(false)
    update({ step: 'done', pushResult })
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
    <div className="max-w-4xl space-y-5">
      {/* Hero */}
      <div className="rounded-3xl overflow-hidden border border-purple-200/70 p-7"
        style={{ background: 'linear-gradient(135deg,#faf5ff 0%,#f5f3ff 55%,#fdf4ff 100%)' }}>
        <div className="flex items-start gap-5">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-sm"
            style={{ background: 'linear-gradient(180deg,#7c3aed,#a78bfa)' }}>
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 3v3m0 12v3m9-9h-3M6 12H3m15.36-6.36l-2.12 2.12M8.76 15.24l-2.12 2.12m12.72 0l-2.12-2.12M8.76 8.76L6.64 6.64"/></svg>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-purple-700 tracking-[0.14em] uppercase mb-1">Monthly Planning</p>
            <h1 className="font-display text-2xl font-bold text-stone-900 mb-1.5">Plan the month before it starts.</h1>
            <p className="text-sm text-text-secondary leading-relaxed max-w-xl">
              Pick a month and we'll propose a full slate of post ideas — pulling from your Brand Brain and
              the seasonal moments in range (Ramadan, Eid, National Day…). You approve the ideas worth making;
              only approved ones move on to content generation.
            </p>
          </div>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-[11px] font-semibold">
        {['Setup', 'Review & Approve', 'Approved'].map((label, i) => {
          const active = ['setup', 'review', 'done'].indexOf(step) === i
          const done = ['setup', 'review', 'done'].indexOf(step) > i
          return (
            <div key={label} className="flex items-center gap-2">
              <span className={`px-3 py-1 rounded-full ${active ? 'bg-purple-100 text-purple-700' : done ? 'bg-sage-100 text-sage-700' : 'bg-stone-100 text-text-tertiary'}`}>
                {done ? '✓ ' : ''}{label}
              </span>
              {i < 2 && <span className="text-text-disabled">→</span>}
            </div>
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
          <div className="grid grid-cols-2 gap-4">
            <Select label="Which month? *" value={month} onChange={e => pickMonth(e.target.value)}>
              <option value="">Select month…</option>
              {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </Select>
            <div>
              <p className="text-xs font-medium text-text-secondary mb-2">Platforms *</p>
              <div className="flex gap-2">
                {PLATFORMS.map(p => (
                  <button key={p} onClick={() => togglePlatform(p)}
                    className={`px-3 py-1.5 rounded-xl border text-sm font-medium capitalize transition-all ${platforms.includes(p) ? 'bg-amber-600 text-white border-amber-600' : 'bg-white border-border text-text-secondary hover:border-amber-400'}`}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>

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
            <Input label="Default posting time (Instagram)" type="time" value={defaultTime} onChange={e => update({ defaultTime: e.target.value })} />
          </div>
          <p className="text-[11px] text-text-tertiary -mt-3">LinkedIn posts are timed for business hours automatically, regardless of the time above — B2B engagement peaks during the work day.</p>

          <Toggle checked={includeHolidays} onChange={e => update({ includeHolidays: e.target.checked })}
            label="Flag Saudi seasonal & cultural moments in range (Ramadan, Eid al-Fitr, Eid al-Adha, Founding Day, National Day)" />

          {month && setupMoments.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap rounded-xl bg-amber-50/60 border border-amber-100 px-3.5 py-2.5">
              <span className="text-[11px] font-semibold text-amber-800">Falls in this month:</span>
              {setupMoments.map((m, i) => (
                <span key={i} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">★ {m.name}</span>
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
              {BRAND_BRAIN_SECTIONS.map(s => {
                const count = { suppliers: directory.suppliers.length, competitors: directory.competitors.length, products: directory.products.length }[s.value]
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
                  return (
                    <div key={i} className="rounded-xl border border-border p-3 space-y-2 bg-white">
                      <textarea
                        className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:border-amber-400 resize-none"
                        rows={2}
                        placeholder="e.g. Announce the new Riyadh showroom opening"
                        value={s.text} onChange={e => updateSeed(i, { text: e.target.value })}
                      />
                      <div className="flex items-center gap-2 flex-wrap">
                        <select value={s.platform} onChange={e => updateSeed(i, { platform: e.target.value })}
                          className="rounded-lg border border-border px-2 py-1.5 text-xs bg-white capitalize focus:outline-none focus:border-amber-400">
                          {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                        <select value={s.format} onChange={e => updateSeed(i, { format: e.target.value })}
                          className="rounded-lg border border-border px-2 py-1.5 text-xs bg-white capitalize focus:outline-none focus:border-amber-400">
                          {FORMATS.map(f => <option key={f} value={f}>{f}</option>)}
                        </select>
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
          <div className="rounded-2xl border border-border bg-surface-subtle/40 p-4 space-y-4">
            <Toggle checked={aiAssist} onChange={e => update({ aiAssist: e.target.checked })}
              label="Also let AI propose additional posts this month" />
            <p className="text-[11px] text-text-tertiary -mt-2.5">Fills out the rest of the month around your posts above. Leave this off for a plan that's exactly what you added.</p>

            {aiAssist && (
              <div className="space-y-4 pt-3 border-t border-border/70">
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

                {directory.products.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-text-secondary mb-2">Feature these products this month (optional)</p>
                    <div className="flex gap-2 flex-wrap">
                      {directory.products.map(p => {
                        const active = featuredProductIds.includes(p.id)
                        return (
                          <button key={p.id} onClick={() => toggleProduct(p.id)}
                            className={`px-3 py-1.5 rounded-xl border text-sm font-medium transition-all ${active ? 'bg-amber-600 text-white border-amber-600' : 'bg-white border-border text-text-secondary hover:border-amber-400'}`}>
                            {p.name}{p.category && <span className={active ? 'opacity-75 ml-1' : 'text-text-tertiary ml-1'}>· {p.category}</span>}
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
              <div className="h-1.5 rounded-full bg-stone-100 overflow-hidden flex">
                <div className="h-full bg-sage-400 transition-all duration-300" style={{ width: `${ideas.length ? (approvedCount / ideas.length) * 100 : 0}%` }} />
                <div className="h-full bg-red-300 transition-all duration-300" style={{ width: `${ideas.length ? (rejectedCount / ideas.length) * 100 : 0}%` }} />
              </div>
            </div>

            {/* Content mix — makes imbalance (7 product, 1 tip) visible at a
                glance instead of something you'd only notice reading every card. */}
            {(pillarBreakdown.sorted.length > 0 || contentMixTarget) && (
              <div className="rounded-xl bg-surface-subtle/60 border border-border/70 px-3 py-2.5">
                <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                  <span className="font-semibold text-text-secondary">Mix:</span>
                  {pillarBreakdown.sorted.map(([pillar, n]) => (
                    <span key={pillar} className="px-2 py-0.5 rounded-full border bg-white border-border text-text-secondary">
                      {n} {pillar}
                    </span>
                  ))}
                  {pillarBreakdown.unlabeled > 0 && (
                    <span className="px-2 py-0.5 rounded-full border bg-white border-border text-text-tertiary">
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
                    <IdeaCard key={idea.id} idea={idea} index={ideas.indexOf(idea)} accessToken={accessToken}
                      autoEdit={idea.id === autoEditId}
                      onChange={onIdeaChange} onRemove={onIdeaRemove} onCreate={onIdeaCreate} onDuplicate={onIdeaDuplicate} />
                  ))}
                </div>
              ))}
            </div>
          )}

          {error && <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-xs text-red-600">{error}</div>}

          <div className="sticky bottom-0 -mx-1 px-1 pb-1">
            <div className="flex items-center gap-3 bg-white/95 backdrop-blur-sm border border-border rounded-2xl shadow-dropdown px-5 py-3.5">
              <Button variant="secondary" onClick={() => update({ step: 'setup' })}>Back</Button>
              <Button onClick={finalizePlan} disabled={busy || approvedCount === 0}>
                {busy ? <><Spinner size="sm" /> Queuing for generation…</> : `Finalize Plan — ${approvedCount} approved`}
              </Button>
              <p className="text-xs text-text-tertiary flex-1">Approved ideas are pushed to Instagram/LinkedIn schedules — generate, approve, or regenerate each one there.</p>
            </div>
          </div>
        </div>
      )}

      {/* ── STEP: DONE ── */}
      {step === 'done' && (
        <Card className="p-8 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-sage-100 flex items-center justify-center mx-auto">
            <svg className="w-7 h-7 text-sage-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <div>
            <h2 className="font-display text-xl font-bold text-stone-900">Plan approved — generating content now.</h2>
            <p className="text-sm text-text-secondary mt-1 max-w-md mx-auto">
              <span className="font-semibold text-text">{approvedCount} idea{approvedCount === 1 ? '' : 's'}</span> approved for <span className="font-semibold text-text">{name}</span>.
              {pushResult && pushResult.failedCount === 0
                ? ' They\'re being generated now (caption + image for each). This takes a few minutes — open Post Approvals and watch them appear as they\'re ready, where you can approve, reject, or regenerate each before scheduling.'
                : pushResult
                  ? ` ${pushResult.results.filter(r => r.ok).map(r => `${r.count} ${r.platform}`).join(', ') || '0'} sent to generate; some platforms failed — ${pushResult.results.filter(r => !r.ok).map(r => r.error).join(' ')}`
                  : ' They\'re being generated now.'}
            </p>
          </div>
          <div className="flex items-center justify-center gap-3 pt-2 flex-wrap">
            <Button onClick={() => navigate('/social/approvals')}>Open Post Approvals</Button>
            <Button variant="secondary" onClick={() => navigate('/campaigns/plans')}>View all plans</Button>
            <Button variant="secondary" onClick={() => { clear(); navigate('/campaigns/plan') }}>Plan another month</Button>
          </div>
        </Card>
      )}

      {/* Per-seed-post image picker (Stage-1 brief) — stores URLs + mode on the
          draft; nothing is persisted until the plan itself is created. */}
      {pickingSeedIdx !== null && (
        <ReferencePicker
          value={seedPosts[pickingSeedIdx]?.references || []}
          onSave={saveSeedImages}
          onClose={() => setPickingSeedIdx(null)}
          mode={seedPickerMode} onModeChange={setSeedPickerMode}
          format={seedPosts[pickingSeedIdx]?.format}
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
