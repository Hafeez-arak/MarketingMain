import { useState } from 'react'
import { Button, Spinner } from './ui/index'
import { updateIdea } from '../lib/contentPlans'
import { requestMediaOptions } from '../lib/campaignPlanner'

// Lives directly on the plan-board card (not hidden behind Edit) — the
// caption + media prompt need to be visible and editable at review time,
// not just at approve/reject time. Three states per idea:
//   drafting  -> spinner
//   ready, no selection yet -> pick from 3 caption + 3 media-prompt options
//   selected  -> the picked (or hand-edited) text, editable, with a
//                "generate image options" action once a media prompt exists
export function IdeaDraftPanel({ idea, accessToken, mediaOptionsUrl, onIdeaChange, onRedraft, redrafting }) {
  const [savingField, setSavingField] = useState('')     // which field is mid-save, for a subtle spinner
  const [genLoading, setGenLoading] = useState(false)
  const [genError, setGenError] = useState('')
  const [imageCandidates, setImageCandidates] = useState([])
  const [pickingImage, setPickingImage] = useState(false)

  async function save(patch, localPatch) {
    setSavingField(Object.keys(patch)[0])
    const res = await updateIdea(accessToken, idea.id, patch)
    setSavingField('')
    if (res.ok) onIdeaChange({ ...idea, ...localPatch })
  }

  function pickCaption(opt) {
    save({ caption_ar: opt.caption_ar || '', caption_en: opt.caption_en || '' },
         { captionAr: opt.caption_ar || '', captionEn: opt.caption_en || '' })
  }
  function pickMediaPrompt(opt) {
    save({ media_prompt: opt.media_prompt || '', motion_prompt: opt.motion_prompt || '' },
         { mediaPrompt: opt.media_prompt || '', motionPrompt: opt.motion_prompt || '' })
  }

  async function generateImageOptions() {
    if (!mediaOptionsUrl) { setGenError('Media Options webhook not configured (Settings → Integrations).'); return }
    if (!idea.mediaPrompt?.trim()) { setGenError('Pick or write a media prompt first.'); return }
    setGenLoading(true); setGenError(''); setImageCandidates([])
    const res = await requestMediaOptions(mediaOptionsUrl, {
      plan_idea_id: idea.id, platform: idea.platform, media_prompt: idea.mediaPrompt,
      aspect_ratio: idea.aspectRatio, style: idea.suggestedStyle || 'photorealistic',
      reference_image_urls: idea.references || [], count: 3,
    })
    setGenLoading(false)
    if (res.error) { setGenError(res.error); return }
    setImageCandidates(res.images || [])
    setPickingImage(true)
  }

  function pickImage(url) {
    setPickingImage(false); setImageCandidates([])
    save({ preview_image_url: url }, { previewImageUrl: url })
  }

  const wantsCaption = idea.wantsCaption !== false
  const wantsMedia = idea.mediaType !== 'none'
  const hasCaptionSelection = !!(idea.captionAr || idea.captionEn)
  const hasMediaSelection = !!idea.mediaPrompt

  if (idea.draftStatus === 'not_started' || !idea.draftStatus) return null

  if (idea.draftStatus === 'drafting') {
    return (
      <div className="mt-2 pl-8 flex items-center gap-2 text-[11px] text-text-tertiary">
        <Spinner size="sm" /> Writing caption + media prompt options…
      </div>
    )
  }

  if (idea.draftStatus === 'failed') {
    return (
      <div className="mt-2 pl-8 flex items-center gap-2 text-[11px]">
        <span className="text-red-500">{idea.draftError || 'Drafting failed.'}</span>
        <button onClick={onRedraft} disabled={redrafting} className="font-semibold text-amber-700 hover:text-amber-800 disabled:opacity-50">
          {redrafting ? <Spinner size="sm" /> : '↻ Retry'}
        </button>
      </div>
    )
  }

  // draftStatus === 'ready'
  return (
    <div className="mt-3 pl-8 space-y-3">
      {wantsCaption && !hasCaptionSelection && idea.captionOptions?.length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wide mb-1.5">Pick a caption</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {idea.captionOptions.map((opt, i) => (
              <button key={i} onClick={() => pickCaption(opt)}
                className="text-left rounded-lg border border-border bg-surface-subtle/40 hover:border-amber-300 hover:bg-amber-50/40 p-2.5 transition-colors">
                {opt.caption_ar && <p className="text-xs text-text leading-relaxed line-clamp-4" dir="rtl">{opt.caption_ar}</p>}
                {opt.caption_en && <p className="text-xs text-text leading-relaxed line-clamp-4 mt-1">{opt.caption_en}</p>}
              </button>
            ))}
          </div>
        </div>
      )}

      {hasCaptionSelection && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-text-tertiary uppercase tracking-wide">Caption</span>
            {idea.captionOptions?.length > 0 && (
              <button onClick={() => onIdeaChange({ ...idea, captionAr: '', captionEn: '' })} className="text-[11px] font-medium text-amber-700 hover:text-amber-800">
                ↻ Choose a different option
              </button>
            )}
          </div>
          {idea.captionAr !== '' && (
            <textarea value={idea.captionAr} dir="rtl" rows={2}
              onChange={e => onIdeaChange({ ...idea, captionAr: e.target.value })}
              onBlur={e => save({ caption_ar: e.target.value }, {})}
              className="w-full text-xs bg-white border border-border rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-amber-400" />
          )}
          {idea.captionEn !== '' && (
            <textarea value={idea.captionEn} rows={2}
              onChange={e => onIdeaChange({ ...idea, captionEn: e.target.value })}
              onBlur={e => save({ caption_en: e.target.value }, {})}
              className="w-full text-xs bg-white border border-border rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-amber-400" />
          )}
        </div>
      )}

      {wantsMedia && !hasMediaSelection && idea.mediaPromptOptions?.length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wide mb-1.5">Pick a {idea.mediaType === 'video' ? 'video' : 'media'} direction</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {idea.mediaPromptOptions.map((opt, i) => (
              <button key={i} onClick={() => pickMediaPrompt(opt)}
                className="text-left rounded-lg border border-border bg-surface-subtle/40 hover:border-sky-300 hover:bg-sky-50/40 p-2.5 transition-colors">
                <p className="text-xs text-text leading-relaxed line-clamp-4">{opt.media_prompt}</p>
                {opt.motion_prompt && <p className="text-[10px] text-sky-700 mt-1 line-clamp-2">🎬 {opt.motion_prompt}</p>}
              </button>
            ))}
          </div>
        </div>
      )}

      {wantsMedia && hasMediaSelection && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-text-tertiary uppercase tracking-wide">{idea.mediaType === 'video' ? 'Video direction' : 'Media prompt'}</span>
            {idea.mediaPromptOptions?.length > 0 && (
              <button onClick={() => onIdeaChange({ ...idea, mediaPrompt: '', motionPrompt: '' })} className="text-[11px] font-medium text-amber-700 hover:text-amber-800">
                ↻ Choose a different option
              </button>
            )}
          </div>
          <textarea value={idea.mediaPrompt} rows={2}
            onChange={e => onIdeaChange({ ...idea, mediaPrompt: e.target.value })}
            onBlur={e => save({ media_prompt: e.target.value }, {})}
            className="w-full text-xs bg-white border border-border rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-sky-400" />
          {idea.mediaType === 'video' && (
            <textarea value={idea.motionPrompt} rows={2} placeholder="How the still should animate — camera move, light behavior, pacing"
              onChange={e => onIdeaChange({ ...idea, motionPrompt: e.target.value })}
              onBlur={e => save({ motion_prompt: e.target.value }, {})}
              className="w-full text-xs bg-white border border-border rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-sky-400" />
          )}

          <div className="flex items-center gap-2 pt-1">
            <Button size="xs" variant="outline" onClick={generateImageOptions} disabled={genLoading}>
              {genLoading ? <><Spinner size="sm" /> Generating…</> : idea.previewImageUrl ? '🖼 New image options' : `🖼 Generate ${idea.mediaType === 'video' ? 'cover ' : ''}image options`}
            </Button>
            {idea.previewImageUrl && !pickingImage && (
              <img src={idea.previewImageUrl} alt="" className="w-10 h-10 rounded-lg object-cover border border-border" />
            )}
          </div>
          {genError && <p className="text-[11px] text-red-600">{genError}</p>}

          {pickingImage && imageCandidates.length > 0 && (
            <div className="grid grid-cols-3 gap-2 pt-1">
              {imageCandidates.map((url, i) => (
                <button key={i} onClick={() => pickImage(url)} className="rounded-lg overflow-hidden border-2 border-transparent hover:border-amber-400 transition-colors">
                  <img src={url} alt="" className="w-full aspect-square object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {savingField && <p className="text-[10px] text-text-tertiary">Saving…</p>}
    </div>
  )
}
