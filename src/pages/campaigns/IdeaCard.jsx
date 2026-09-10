// ─── One idea, as a card and as an edit modal ──────────────────────────────
// The review step's unit of work: everything a person does to a single
// proposed post before it becomes a real one — approve, reject with a reason,
// retarget, redraft the copy, change the format, pick references.
//
// Just under 500 lines, and it was the largest thing inside CampaignPlanner's
// 2,300. The card and the modal move together because they are one feature:
// the card owns the idea, the modal is how it gets edited, and splitting them
// would mean threading the same six props through a third file.

import { useState } from 'react'
import { Button, Input, Textarea, Select, Spinner, Toggle, Modal } from '../../components/ui/index'
import { formatDate } from '../../lib/utils'
import {
  formatsFor, defaultFormat, aspectRatiosFor, defaultAspectRatio, slideRange,
  aspectLabel, stylesFor, derivePostKind,
} from '../../lib/postFormats'
import { logIdeaEvent, ideaSnapshot } from '../../lib/brandContext'
import { updateIdea } from '../../lib/contentPlans'
import { saveIdeaPlatforms } from '../../lib/studioBridge'
import { ReferencePicker } from '../../components/ReferencePicker'
import { IdeaDraftPanel } from '../../components/IdeaDraftPanel'
import { formatTime } from './planModel'
import {
  TARGET_PLATFORMS, targetLabel, IG_TONES, OBJECTIVES,
  REJECT_REASONS, rejectReasonLabel,
} from './planConstants'

// Chip styling, and the review statuses an idea moves between. Local on
// purpose: every one of these is read by this file alone, and the status set
// here (proposed / approved / rejected) is a REVIEW state, not the publish
// state that utils.js exports under the same name. Two different vocabularies
// that happen to share a word — keeping this one out of utils.js is what stops
// an import picking up the wrong one.
const OCCASION_STYLE = 'bg-amber-100 text-amber-800 border-amber-200'
const PILLAR_STYLE   = 'bg-purple-50 text-purple-700 border-purple-100'
const OWN_COPY_STYLE = 'bg-sage-100 text-sage-700 border-sage-200'
const STATUS_META = {
  proposed: { label: 'Proposed', cls: 'bg-stone-100 text-stone-600' },
  approved: { label: 'Approved', cls: 'bg-sage-100 text-sage-700' },
  rejected: { label: 'Rejected', cls: 'bg-red-50 text-red-500 line-through' },
}

// ─── One idea in the review list, with inline approve/reject + edit ─────────
export function IdeaCard({ idea, index, accessToken, workspaceId, onChange, onRemove, onCreate, onRedraft, onOpenStudio, studioSession, mediaOptionsUrl, brandName = '', autoEdit = false }) {
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

export function IdeaEditModal({ idea, tones, saving, saveError, onClose, onSave }) {
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
