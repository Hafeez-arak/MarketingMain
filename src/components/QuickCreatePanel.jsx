import { useState, useEffect } from 'react'
import { Card, Button, Textarea, Select, Spinner, Toggle } from './ui/index'
import { formatsFor, defaultFormat, aspectRatiosFor, defaultAspectRatio, slideRange, aspectLabel } from '../lib/postFormats'
import { createQuickPost, finalizeQuickPost } from '../lib/quickCreate'
import { fetchIdeaDrafts, markIdeaDraftFailed } from '../lib/contentPlans'
import { IdeaDraftPanel } from './IdeaDraftPanel'

// One post, generated now, through the same engine the monthly planner
// uses — Draft Copy for caption + media-prompt options, Media Options for
// real candidate images, the same commit-only Finalize. Reuses
// IdeaDraftPanel unchanged for the review step (it already knows how to
// render/poll/edit a draft idea; a quick-created idea is the same shape).
export function QuickCreatePanel({ platform, tones, workspaceId, accessToken, webhooks, instructions, captionLanguage, onDone }) {
  const [topic, setTopic] = useState('')
  const [tone, setTone] = useState(tones[0]?.value || '')
  const [postFormat, setPostFormat] = useState(defaultFormat(platform))
  const [aspectRatio, setAspectRatio] = useState(defaultAspectRatio(platform, defaultFormat(platform)))
  const [slideCount, setSlideCount] = useState(1)
  const [wantsCaption, setWantsCaption] = useState(true)
  const [imageIdea, setImageIdea] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const [plan, setPlan] = useState(null)   // { id, ... }
  const [idea, setIdea] = useState(null)   // draft-shaped idea, once created
  const [redrafting, setRedrafting] = useState(false)
  const [finalizing, setFinalizing] = useState(false)
  const [finalizeError, setFinalizeError] = useState('')
  const [done, setDone] = useState(false)

  const formats = formatsFor(platform)
  const currentFormat = formats.find(f => f.id === postFormat) || formats[0]
  const ratios = aspectRatiosFor(platform, postFormat)
  const slides = slideRange(platform, postFormat)
  const showsMediaFields = currentFormat?.media !== 'none'

  function onFormatChange(fmt) {
    setPostFormat(fmt)
    setAspectRatio(defaultAspectRatio(platform, fmt))
    const s = slideRange(platform, fmt)
    if (s) setSlideCount(s.default)
  }

  async function handleCreate() {
    if (!topic.trim()) { setError('Add a topic for the post.'); return }
    setError(''); setCreating(true)
    const res = await createQuickPost({
      workspaceId, accessToken, platform, topic, tone, postFormat, aspectRatio,
      mediaType: currentFormat?.media || 'image', wantsCaption, imageIdea,
      webhooks, instructions, captionLanguage,
    })
    setCreating(false)
    if (res.error) { setError(res.error); return }
    setPlan(res.plan)
    setIdea(res.idea)
  }

  // Poll while drafting — same shape as the plan board's poll, scoped to
  // this one idea.
  useEffect(() => {
    if (!idea || idea.draftStatus !== 'drafting') return
    const timer = setInterval(async () => {
      const rows = await fetchIdeaDrafts(accessToken, [idea.id])
      const row = rows[0]
      if (!row) return
      const staleMs = idea.draftedAt ? Date.now() - new Date(idea.draftedAt).getTime() : Infinity
      if (row.draft_status === 'drafting' && staleMs > 5 * 60 * 1000) {
        // Persisted, not just held in this component: the row is what the
        // board and every later page load read, and left 'drafting' there it
        // spins forever for a workflow that already failed to answer.
        markIdeaDraftFailed(accessToken, idea.id, 'Drafting timed out — no result came back from the workflow.')
        setIdea(i => ({ ...i, draftStatus: 'failed', draftError: 'Drafting timed out — try again.' }))
        return
      }
      if (row.draft_status === 'ready' || row.draft_status === 'failed') {
        setIdea(i => ({
          ...i, draftStatus: row.draft_status, draftError: row.draft_error || '',
          captionOptions: row.caption_options || [], mediaPromptOptions: row.media_prompt_options || [],
        }))
      }
    }, 4000)
    return () => clearInterval(timer)
  }, [idea, accessToken])

  async function handleRedraft() {
    // Without this guard, a rapid double-click (or a click while a genuinely
    // in-flight draft is still running — IdeaDraftPanel offers Retry during
    // 'drafting' on purpose, see its own comment) fires a second Draft Copy
    // call for the same idea id with no de-dupe: two n8n runs race writes to
    // the same plan_ideas row, and the AI call is billed twice.
    if (redrafting) return
    setRedrafting(true)
    setError('')
    const res = await createQuickPost({
      workspaceId, accessToken, platform, topic: idea.topic, tone: idea.tone,
      postFormat: idea.postFormat, aspectRatio: idea.aspectRatio, mediaType: idea.mediaType,
      wantsCaption: idea.wantsCaption, imageIdea: idea.imageIdea,
      webhooks, instructions, captionLanguage,
    })
    setRedrafting(false)
    // Redrafting a quick post just re-runs Draft Copy on the SAME idea
    // row (not a new plan) — reuse the existing idea id, only refresh its
    // draft status/options.
    if (!res.error) setIdea(i => ({ ...i, draftStatus: 'drafting', draftedAt: new Date().toISOString() }))
  }

  async function handleFinalize() {
    setFinalizing(true); setFinalizeError('')
    const result = await finalizeQuickPost({
      webhooks, planId: plan.id, idea, instructions, workspaceId, captionLanguage, accessToken,
    })
    setFinalizing(false)
    if (result.error) { setFinalizeError(result.error); return }
    setDone(true)
  }

  function reset() {
    setTopic(''); setImageIdea(''); setPlan(null); setIdea(null); setDone(false); setFinalizeError('')
  }

  if (done) {
    return (
      <Card className="p-8 text-center space-y-4 max-w-xl">
        <div className="w-14 h-14 rounded-2xl bg-sage-100 flex items-center justify-center mx-auto">
          <svg className="w-7 h-7 text-sage-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <div>
          <h3 className="text-sm font-bold text-text tracking-tight">Your post is generating.</h3>
          <p className="text-sm text-text-secondary mt-1">Since the caption and image were already chosen, this is quick — check the Posts tab in a moment.</p>
        </div>
        <div className="flex items-center justify-center gap-3">
          <Button onClick={() => { reset(); onDone?.() }}>Back to Posts</Button>
          <Button variant="secondary" onClick={reset}>Create another</Button>
        </div>
      </Card>
    )
  }

  if (idea) {
    return (
      <Card className="p-5 space-y-4 max-w-2xl">
        <div>
          <p className="text-sm font-semibold text-text">{idea.topic}</p>
          <p className="text-[11px] text-text-tertiary mt-0.5">
            {currentFormat?.label} · {aspectLabel(idea.aspectRatio)}{idea.postFormat === 'carousel' && idea.slideCount > 1 ? ` · ${idea.slideCount} slides` : ''}
          </p>
        </div>
        <IdeaDraftPanel idea={idea} accessToken={accessToken} workspaceId={workspaceId}
          mediaOptionsUrl={webhooks?.mediaOptions} onIdeaChange={setIdea}
          onRedraft={handleRedraft} redrafting={redrafting} />
        {finalizeError && <p className="text-xs text-red-600">{finalizeError}</p>}
        <div className="flex items-center gap-3 pt-2 border-t border-border">
          <Button variant="secondary" onClick={reset}>Cancel</Button>
          <Button onClick={handleFinalize} disabled={finalizing || idea.draftStatus === 'drafting'}>
            {finalizing ? <><Spinner size="sm" /> Generating…</> : '🚀 Generate post'}
          </Button>
        </div>
      </Card>
    )
  }

  return (
    <Card className="overflow-hidden max-w-2xl">
      <div className="h-1" style={{ background: '#E1306C' }} />
      <div className="p-5 space-y-4">
        <div>
          <p className="text-xs font-medium text-text-secondary mb-1.5">Topic / Brief <span className="text-red-400">*</span></p>
          <Textarea placeholder="e.g. Announce our new showroom opening in Riyadh" value={topic}
            onChange={e => { setTopic(e.target.value); setError('') }} rows={3} />
        </div>

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

        {slides && (
          <Select label="How many slides?" value={slideCount} onChange={e => setSlideCount(Number(e.target.value))}>
            {Array.from({ length: slides.max - slides.min + 1 }, (_, i) => slides.min + i).map(n => <option key={n} value={n}>{n}</option>)}
          </Select>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Select label="Tone" value={tone} onChange={e => setTone(e.target.value)}>
            {tones.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </div>

        {showsMediaFields && (
          <Toggle checked={wantsCaption} onChange={e => setWantsCaption(e.target.checked)}
            label="Include a caption with this post" />
        )}

        {showsMediaFields && (
          <Textarea label="Your vision for the image (optional)" rows={2}
            placeholder="Describe what you're imagining — leave blank to let AI decide."
            value={imageIdea} onChange={e => setImageIdea(e.target.value)} />
        )}

        {error && <p className="text-xs text-red-600">{error}</p>}
        <Button onClick={handleCreate} disabled={creating || !topic.trim()}>
          {creating ? <><Spinner size="sm" /> Starting…</> : '✨ Generate'}
        </Button>
      </div>
    </Card>
  )
}
