import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../../store/appStore'
import { useAuth } from '../../store/AuthContext'
import { Button, Card, Modal, SectionHead, Select, Spinner, Textarea, Empty } from '../../components/ui/index'
import { BranchChat, BranchPill } from '../../components/studio/BranchChat'
import { PromptBubble } from '../../components/studio/VersionCard'
import { OverlayEditor } from '../../components/studio/OverlayEditor'
import { VideoPanel } from '../../components/studio/VideoPanel'
import { DURATIONS } from '../../components/studio/motionPresets'
import { aspectLabel } from '../../lib/postFormats'
import { uploadReferenceImage } from '../../lib/referenceImages'
import { buildInstructionsString } from '../../lib/brandBrain'
import {
  buildBranches, createSession, fetchSessions, fetchVersions, finalizeVersion, insertPendingVersions,
  requestEdit, requestEnhance, requestGenerate, requestVideo, selectVersion, touchSession, updateVersion,
  uploadToStudio,
} from '../../lib/creativeStudio'

// ─── Creative Studio ───────────────────────────────────────────────────────
// Prompt → two candidates → keep talking to whichever one you like → animate.
//
// Deliberately TWO conversations, not one. The marketing team's job isn't
// "pick the better image and move on" — it's "push both and see which one
// gets there", so each candidate keeps its own chat box, its own edit history
// and its own toolbar. The lane you type in becomes the big one; the other
// waits as a pill you click to get the split view back.

const RATIOS = ['1:1', '4:5', '9:16', '16:9']
const INTENTS = [
  { value: 'image',       label: 'An image',        hint: 'A post, story or ad visual' },
  { value: 'video',       label: 'A video',         hint: 'A clip generated from a description' },
  { value: 'image_video', label: 'Image, then video', hint: 'Design the still, then bring it to life' },
]
const emptyComposer = { text: '', baseId: null, attach: null }

export function CreativeStudio() {
  const { state } = useApp()
  const { activeWorkspaceId, accessToken } = useAuth()
  const webhooks = state.webhooks || {}

  const [sessions, setSessions] = useState([])
  const [session, setSession] = useState(null)
  const [versions, setVersions] = useState([])
  // Derived, not set in an effect: with no workspace there is nothing to wait
  // for, so the list is already "loaded" (and empty) on first render.
  const [loading, setLoading] = useState(!!activeWorkspaceId)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')          // '' | 'generate' | '<action>:<branchId>'

  // Composer (new session)
  const [intent, setIntent] = useState('image')
  const [prompt, setPrompt] = useState('')
  // promptRaw is the human's own words, kept so Undo can put them back after
  // an enhance. promptSource is what tells the auto-toggle whether this text
  // has been touched — the browser is the only place that knows, which is why
  // the decision lives here and n8n just receives a finished string.
  const [promptRaw, setPromptRaw] = useState('')
  const [promptSource, setPromptSource] = useState('raw')   // raw | enhanced | enhanced_edited
  const [autoEnhance, setAutoEnhance] = useState(false)
  const [enhancing, setEnhancing] = useState('')            // '' | 'prompt' | 'motion'
  const [aspect, setAspect] = useState('4:5')
  const [refUrl, setRefUrl] = useState('')
  const [refNotes, setRefNotes] = useState('')
  const [uploadingRef, setUploadingRef] = useState(false)
  const fileRef = useRef(null)

  // Per-lane state, keyed by branch id, so the two conversations never share
  // a draft, a base image or a dropped reference.
  const [composers, setComposers] = useState({})
  const [focusedBranch, setFocusedBranch] = useState(null)

  const [duration, setDuration] = useState('5')
  const [videoTarget, setVideoTarget] = useState(null)      // the still being animated
  // Set only by the 🔄 re-render action: the exact prompt/duration/
  // resolution/audio of a past render, so VideoPanel reopens pre-filled
  // rather than asking the human to retype a motion note that already
  // worked. Null for the normal ✨ Animate path — that one starts blank.
  const [videoPrefill, setVideoPrefill] = useState(null)
  const [editingOverlay, setEditingOverlay] = useState(null)
  const [savingOverlay, setSavingOverlay] = useState(false)

  useEffect(() => {
    if (!activeWorkspaceId) return
    let cancelled = false
    fetchSessions(activeWorkspaceId, accessToken).then(rows => {
      if (cancelled) return          // workspace switched mid-fetch
      setSessions(rows); setLoading(false)
    })
    return () => { cancelled = true }
  }, [activeWorkspaceId, accessToken])

  const branches = useMemo(() => buildBranches(versions), [versions])
  const anyPending = versions.some(v => v.status === 'pending')

  const refresh = useCallback(async (sessionId) => {
    const rows = await fetchVersions(accessToken, sessionId)
    setVersions(rows)
    return rows
  }, [accessToken])

  // n8n owns writing results back, so the thread is refreshed from the table
  // rather than from webhook responses — that's also why a refresh or a closed
  // tab mid-generation loses nothing.
  useEffect(() => {
    if (!session || !anyPending) return
    const timer = setInterval(() => refresh(session.id), 4000)
    return () => clearInterval(timer)
  }, [session, anyPending, refresh])

  async function openSession(s) {
    setSession(s); setError(''); setVersions([]); setComposers({}); setFocusedBranch(null)
    setAspect(s.aspect_ratio || '4:5')
    const rows = await refresh(s.id)
    // Reopen where the work was left off: the last lane touched is the one
    // holding the selected version, and only if it has moved past round 0 —
    // landing in a lane you never edited would just hide the comparison.
    const picked = rows.find(v => v.is_selected)
    if (!picked) return
    const home = buildBranches(rows).find(b => b.versions.some(v => v.id === picked.id))
    if (home && home.versions.length > 1) setFocusedBranch(home.rootId)
  }

  function newSession() {
    setSession(null); setVersions([]); setPrompt(''); setRefUrl(''); setRefNotes('')
    setPromptRaw(''); setPromptSource('raw')
    setComposers({}); setFocusedBranch(null); setError('')
  }

  async function handleReferenceUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingRef(true); setError('')
    const res = await uploadReferenceImage(activeWorkspaceId, accessToken, file)
    setUploadingRef(false)
    if (fileRef.current) fileRef.current.value = ''
    if (res.error) { setError(`Reference upload failed: ${res.error}`); return }
    setRefUrl(res.url)
  }

  // ── Enhance ──
  // The brand profile has always been read by the Creative workflows
  // (`BRAND CONTEXT` in their prompt builders) but was never sent from this
  // screen, so that block has been arriving empty. Both calls below pass it.
  const brandInstructions = useMemo(
    () => buildInstructionsString(state.brandProfile) || '',
    [state.brandProfile],
  )

  // Rewrites the box in place and stops. It deliberately does NOT generate:
  // the whole point is that the prompt is read and editable before it costs a
  // round. Returns the enhanced text so the auto path can use it directly
  // without waiting on a state update.
  async function enhancePrompt() {
    if (!prompt.trim()) return null
    setEnhancing('prompt'); setError('')
    const res = await requestEnhance(webhooks.creativeEnhance, {
      mode: 'image',
      prompt: prompt.trim(),
      aspect_ratio: aspect,
      instructions: brandInstructions,
      reference_notes: refNotes,
      has_reference: !!refUrl,
    })
    setEnhancing('')
    if (res.error) { setError(`Couldn't enhance: ${res.error}`); return null }
    setPromptRaw(prompt)
    setPrompt(res.prompt)
    setPromptSource('enhanced')
    return res.prompt
  }

  function undoEnhance() {
    setPrompt(promptRaw)
    setPromptSource('raw')
  }

  // Passed into VideoPanel as onEnhance — it owns the text box, this just
  // does the webhook round-trip and hands the result back for the panel to
  // put in its own state, same contract as enhancePrompt() above.
  async function enhanceMotionPrompt(text, motionDuration) {
    if (!text.trim()) return null
    setEnhancing('motion'); setError('')
    const res = await requestEnhance(webhooks.creativeEnhance, {
      mode: 'motion',
      prompt: text.trim(),
      duration: motionDuration,
      instructions: brandInstructions,
      source_prompt: videoTarget?.user_prompt || '',
    })
    setEnhancing('')
    if (res.error) { setError(`Couldn't enhance: ${res.error}`); return null }
    return res.prompt
  }

  // ── Start a session ──
  async function handleGenerate() {
    if (!prompt.trim()) { setError('Describe what you want first.'); return }
    setBusy('generate'); setError('')

    // Only when they never touched it themselves — an enhanced or hand-edited
    // prompt is theirs, and rewriting it under them is the one thing this
    // feature must not do. A failed enhance degrades to the raw prompt rather
    // than blocking a generation.
    let finalPrompt = prompt.trim()
    let originalPrompt = promptRaw || prompt.trim()
    let source = promptSource
    if (autoEnhance && promptSource === 'raw') {
      const enhanced = await enhancePrompt()
      if (enhanced) { originalPrompt = finalPrompt; finalPrompt = enhanced; source = 'enhanced' }
    }

    const created = await createSession(activeWorkspaceId, accessToken, {
      title: finalPrompt.slice(0, 80), intent, aspectRatio: aspect,
    })
    if (created.error) { setBusy(''); setError(created.error); return }
    const s = created.session

    const videoOnly = intent === 'video'
    // Video has one provider, so a video-only session gets one render rather
    // than a two-way comparison — variations come from re-rendering, not from
    // a second model.
    const rows = videoOnly
      ? [{ round: 0, kind: 'video', provider: 'seedance', mediaType: 'video',
           userPrompt: finalPrompt, originalPrompt, promptSource: source,
           aspectRatio: aspect, duration, resolution: '1080p', generateAudio: false }]
      : ['openai', 'gemini'].map(provider => ({
          round: 0, kind: 'generate', provider, mediaType: 'image',
          userPrompt: finalPrompt, originalPrompt, promptSource: source,
          aspectRatio: aspect,
          referenceUrl: refUrl, referenceNotes: refNotes,
        }))

    const ins = await insertPendingVersions(activeWorkspaceId, accessToken, s.id, rows)
    if (ins.error) { setBusy(''); setError(ins.error); return }

    const fired = videoOnly
      ? await requestVideo(webhooks.creativeVideo, {
          session_id: s.id, version_id: ins.rows[0].id, prompt: finalPrompt,
          duration, aspect_ratio: aspect, resolution: '1080p', generate_audio: false,
        })
      : await requestGenerate(webhooks.creativeGenerate, {
          session_id: s.id, prompt: finalPrompt, aspect_ratio: aspect,
          instructions: brandInstructions,
          reference_url: refUrl, reference_notes: refNotes,
          targets: ins.rows.map(r => ({ version_id: r.id, provider: r.provider })),
        })

    setBusy('')
    setSessions(prev => [s, ...prev])
    setSession(s)
    setVersions(ins.rows)
    setComposers({}); setFocusedBranch(null)
    if (fired.error) {
      setError(fired.error)
      // The rows exist but nothing will ever fill them — say so on the cards
      // instead of leaving spinners running forever.
      for (const r of ins.rows) await updateVersion(accessToken, r.id, { status: 'failed', error: fired.error })
      refresh(s.id)
    }
  }

  // ── Per-lane follow-ups ──
  const nextRound = useMemo(
    () => (versions.length ? Math.max(...versions.map(v => v.round)) + 1 : 0),
    [versions],
  )

  const composerFor = useCallback(b => composers[b.rootId] || emptyComposer, [composers])
  const laneBusy = useCallback(
    rootId => (busy.endsWith(`:${rootId}`) ? busy.slice(0, busy.indexOf(':')) : ''),
    [busy],
  )

  function patchComposer(rootId, patch) {
    setComposers(prev => ({ ...prev, [rootId]: { ...emptyComposer, ...prev[rootId], ...patch } }))
  }

  // Every generating step in a lane inserts its pending row, fires the
  // webhook, and lets the poller fill it in — identical shape for edits and
  // renders, so one helper handles both failures the same way.
  async function runStep(branch, { row, payload, send, label }) {
    setBusy(`${label}:${branch.rootId}`); setError('')
    const ins = await insertPendingVersions(activeWorkspaceId, accessToken, session.id, [row])
    if (ins.error) { setBusy(''); setError(ins.error); return null }
    const fired = await send({ ...payload, session_id: session.id, version_id: ins.rows[0].id })
    setBusy('')
    setVersions(prev => [...prev, ...ins.rows])
    if (fired.error) {
      setError(fired.error)
      await updateVersion(accessToken, ins.rows[0].id, { status: 'failed', error: fired.error })
      refresh(session.id)
    }
    touchSession(accessToken, session.id)
    return ins.rows[0]
  }

  async function handleSend(branch) {
    const { text, baseId, attach } = composerFor(branch)
    const instruction = (text || '').trim()
    const base = branch.versions.find(v => v.id === baseId) || branch.latest
    if (!instruction || !base) return

    // A dropped image is either the thing to edit or something to take cues
    // from — the drop can't know which, so the chip asks and this reads the
    // answer. Either way `parent_version_id` stays inside THIS lane:
    // borrowing a picture from the other conversation must not move the
    // conversation into it.
    const editingDropped = attach?.mode === 'base'
    const sourceUrl = editingDropped ? attach.url : base.image_url

    setFocusedBranch(branch.rootId)
    const created = await runStep(branch, {
      label: 'edit',
      row: {
        round: nextRound, kind: 'edit', provider: 'gemini', mediaType: 'image',
        parentVersionId: base.id, userPrompt: instruction, aspectRatio: session.aspect_ratio,
        referenceUrl: attach?.url || '',
        referenceNotes: attach
          ? (editingDropped ? `Working on the ${attach.label} image` : `Taking cues from the ${attach.label} image`)
          : '',
      },
      payload: {
        source_image_url: sourceUrl,
        reference_image_urls: attach && !editingDropped ? [attach.url] : [],
        instruction,
      },
      send: p => requestEdit(webhooks.creativeEdit, p),
    })
    if (created) {
      patchComposer(branch.rootId, { ...emptyComposer })
      // Remembers which lane was in use, so reopening the session comes back here.
      selectVersion(accessToken, session.id, base.id)
    }
  }

  // Fired by VideoPanel's submit — it owns the prompt/duration/resolution/
  // audio choice, this just anchors the render to the right branch and lane.
  async function handleAnimate({ prompt: motionText, duration: dur, resolution, generateAudio }) {
    const target = videoTarget
    const branch = branches.find(b => b.versions.some(v => v.id === target?.id))
    if (!target || !branch || !motionText.trim()) return
    setVideoTarget(null); setVideoPrefill(null)
    await runStep(branch, {
      label: 'video',
      row: {
        round: nextRound, kind: 'video', provider: 'seedance', mediaType: 'video',
        parentVersionId: target.id, userPrompt: motionText.trim(), aspectRatio: session.aspect_ratio,
        duration: dur, resolution, generateAudio,
      },
      payload: {
        image_url: target.image_url, prompt: motionText.trim(),
        duration: dur, aspect_ratio: session.aspect_ratio, resolution, generate_audio: generateAudio,
      },
      send: p => requestVideo(webhooks.creativeVideo, p),
    })
  }

  // The 🔄 action on a past render: same words and settings, but against the
  // lane's CURRENT still — the whole point of never baking text into video
  // (CREATIVE-STUDIO.md) is that "fix the image, re-animate" stays a loop
  // rather than a from-scratch redo. Reopens the panel pre-filled rather than
  // firing silently, since re-render is not free and the human should see
  // what's about to run before it does.
  function handleReRender(branch, video) {
    const still = branch.latest
    if (!still || still.media_type === 'video') return
    setVideoTarget(still)
    setVideoPrefill({
      prompt: video.user_prompt || '',
      duration: video.duration || '5',
      resolution: video.resolution || '720p',
      generateAudio: !!video.generate_audio,
    })
  }

  // The overlay editor hands back a flattened image AND the text alone on
  // transparency. Both are stored: the flat one is the asset, the transparent
  // one is what will later composite over a video, and overlay_state keeps the
  // boxes editable so a typo six versions later isn't a redraw.
  async function handleOverlaySave({ compositeBlob, textLayerBlob, state: overlayState }) {
    setSavingOverlay(true)
    const base = await uploadToStudio(activeWorkspaceId, accessToken, compositeBlob, 'overlay.png')
    if (base.error) { setSavingOverlay(false); return { error: base.error } }
    const layer = await uploadToStudio(activeWorkspaceId, accessToken, textLayerBlob, 'textlayer.png')

    const ins = await insertPendingVersions(activeWorkspaceId, accessToken, session.id, [{
      round: nextRound, kind: 'overlay', provider: 'manual', mediaType: 'image',
      parentVersionId: editingOverlay.id, userPrompt: 'Added text',
      aspectRatio: session.aspect_ratio, imageUrl: base.url,
      overlayState: { ...overlayState, textLayerUrl: layer.url || '' },
      status: 'ready',
    }])
    setSavingOverlay(false)
    if (ins.error) return { error: ins.error }
    setEditingOverlay(null)
    setVersions(prev => [...prev, ...ins.rows])
    return {}
  }

  async function handleFinalize(branch, version) {
    if (!version) return
    setBusy(`finalize:${branch.rootId}`)
    const res = await finalizeVersion(activeWorkspaceId, accessToken, version, session.title)
    setBusy('')
    if (res.error) { setError(res.error); return }
    setVersions(prev => prev.map(v => (v.id === version.id ? { ...v, is_final: true } : v)))
  }

  // The opening prompt belongs to the session, not to either lane — shown once
  // above both so the split reads as one brief taken two ways.
  const opening = versions.find(v => v.round === 0) || null
  const focused = branches.find(b => b.rootId === focusedBranch) || null
  const others = focused ? branches.filter(b => b.rootId !== focused.rootId) : []
  const missingWebhook = !webhooks.creativeGenerate && !webhooks.creativeVideo

  const laneProps = branch => ({
    branch,
    composer: composerFor(branch),
    busy: laneBusy(branch.rootId),
    onChange: patch => patchComposer(branch.rootId, patch),
    onSend: () => handleSend(branch),
    onActivate: () => setFocusedBranch(branch.rootId),
    onAnimate: v => { setVideoTarget(v); setVideoPrefill(null) },
    // Only offered when the lane actually has a still to re-animate — a
    // video-only branch (no image round) has nothing for the button to do.
    onReRender: branch.versions.some(v => v.media_type !== 'video' && v.status === 'ready')
      ? v => handleReRender(branch, v)
      : undefined,
    onOpenEditor: v => setEditingOverlay(v),
    onFinalize: v => handleFinalize(branch, v),
  })

  return (
    <div className="p-6 lg:p-8 max-w-[1400px] mx-auto">
      <SectionHead
        title="Creative Studio"
        subtitle="Describe what you want, then keep talking to whichever option is going the right way."
        action={session ? <Button variant="secondary" onClick={newSession}>+ New</Button> : null}
      />

      {missingWebhook && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-xs text-amber-900">
            The Studio's workflows aren't connected yet — add the three Creative Studio webhook
            URLs in <span className="font-semibold">Settings → Integrations</span> before generating.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6">
        {/* ── Sessions ── */}
        <aside className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-text-tertiary px-1">Recent</p>
          {loading ? (
            <div className="py-6 flex justify-center"><Spinner /></div>
          ) : sessions.length === 0 ? (
            <p className="text-[11px] text-text-tertiary px-1">Nothing yet.</p>
          ) : (
            <div className="space-y-1 max-h-[70vh] overflow-y-auto pr-1">
              {sessions.map(s => (
                <button key={s.id} onClick={() => openSession(s)}
                  className={`w-full text-left px-3 py-2 rounded-xl transition-colors ${
                    session?.id === s.id ? 'bg-amber-50 border border-amber-300' : 'hover:bg-surface-subtle border border-transparent'
                  }`}>
                  <p className="text-xs font-medium text-text line-clamp-2 leading-snug">{s.title || 'Untitled'}</p>
                  <p className="text-[10px] text-text-tertiary mt-0.5">
                    {s.intent === 'video' ? 'Video' : s.intent === 'image_video' ? 'Image + video' : 'Image'} · {aspectLabel(s.aspect_ratio)}
                  </p>
                </button>
              ))}
            </div>
          )}
        </aside>

        {/* ── Thread / composer ── */}
        <main className="space-y-4 min-w-0">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5">
              <p className="text-xs text-red-700">{error}</p>
            </div>
          )}

          {!session ? (
            <Card className="p-5 space-y-4 max-w-2xl">
              <div>
                <p className="text-xs font-medium text-text-secondary mb-1.5">What are you making?</p>
                <div className="grid grid-cols-3 gap-2">
                  {INTENTS.map(i => (
                    <button key={i.value} onClick={() => setIntent(i.value)}
                      className={`text-left rounded-xl border p-2.5 transition-all ${
                        intent === i.value ? 'border-amber-500 bg-amber-50 ring-1 ring-amber-300' : 'border-border hover:border-amber-300'
                      }`}>
                      <p className="text-xs font-semibold text-text">{i.label}</p>
                      <p className="text-[10px] text-text-tertiary mt-0.5 leading-snug">{i.hint}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Textarea label="Describe it" rows={4} value={prompt}
                  onChange={e => {
                    setPrompt(e.target.value); setError('')
                    // Their edit makes it theirs again — auto-enhance won't
                    // touch it, and the button warns before overwriting.
                    if (promptSource === 'enhanced') setPromptSource('enhanced_edited')
                  }}
                  placeholder="e.g. A dusk shot of a modern Riyadh villa facade with warm linear lighting, for an Instagram post announcing our new residential range" />

                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={enhancePrompt}
                      disabled={!prompt.trim() || !!enhancing || busy === 'generate'}
                      title={promptSource === 'raw'
                        ? 'Rewrite this into a fuller prompt — nothing generates yet'
                        : 'Rewrite again, replacing the current text'}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium hover:border-amber-400 hover:bg-amber-50 disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-transparent">
                      {enhancing === 'prompt' ? <><Spinner size="sm" /> Enhancing…</> : '✨ Enhance prompt'}
                    </button>
                    {promptSource !== 'raw' && (
                      <span className="text-[10px] text-text-tertiary">
                        {promptSource === 'enhanced' ? 'Enhanced' : 'Enhanced, then edited'}
                        {promptRaw && (
                          <> · <button type="button" onClick={undoEnhance}
                            className="underline hover:text-text-secondary">Undo</button></>
                        )}
                      </span>
                    )}
                  </div>
                  <label className="inline-flex items-center gap-1.5 text-[10px] text-text-tertiary cursor-pointer">
                    <input type="checkbox" checked={autoEnhance} className="accent-amber-500"
                      onChange={e => setAutoEnhance(e.target.checked)} />
                    Enhance automatically when I generate
                  </label>
                </div>
                {promptSource === 'raw' && (
                  <p className="text-[10px] text-text-tertiary leading-snug">
                    Fills in lighting, framing and materials — never changes your subject. You see the
                    result here before anything is generated.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Select label="Shape" value={aspect} onChange={e => setAspect(e.target.value)}>
                  {RATIOS.map(r => <option key={r} value={r}>{aspectLabel(r)} ({r})</option>)}
                </Select>
                {intent === 'video' && (
                  <Select label="Length" value={duration} onChange={e => setDuration(e.target.value)}>
                    {DURATIONS.map(d => <option key={d} value={d}>{d} seconds</option>)}
                  </Select>
                )}
              </div>

              {intent !== 'video' && (
                <div className="rounded-xl border border-border bg-surface-subtle/40 p-3 space-y-2">
                  <p className="text-[11px] font-semibold text-text-secondary">Reference image (optional)</p>
                  <p className="text-[10px] text-text-tertiary leading-snug">
                    The AI takes inspiration from it — it won't copy it. Say what you want kept or changed.
                  </p>
                  <div className="flex items-center gap-2">
                    <input ref={fileRef} type="file" accept="image/*" onChange={handleReferenceUpload}
                      className="text-[11px] file:mr-2 file:px-2 file:py-1 file:rounded-lg file:border file:border-border file:bg-white file:text-[11px]" />
                    {uploadingRef && <Spinner size="sm" />}
                    {refUrl && <img src={refUrl} alt="" className="w-10 h-10 rounded-lg object-cover border border-border" />}
                  </div>
                  {refUrl && (
                    <Textarea rows={2} value={refNotes} onChange={e => setRefNotes(e.target.value)}
                      placeholder="e.g. same style but change the background to a hotel lobby" />
                  )}
                </div>
              )}

              <Button onClick={handleGenerate} disabled={busy === 'generate' || !prompt.trim()}>
                {busy === 'generate' ? <><Spinner size="sm" /> Starting…</> : '✨ Generate'}
              </Button>
            </Card>
          ) : branches.length === 0 ? (
            <Empty title="Nothing here yet" description="This session has no versions." />
          ) : (
            <div className="space-y-3">
              <PromptBubble text={opening?.user_prompt} note={opening?.reference_notes}
                referenceUrl={opening?.reference_url} />

              {focused ? (
                <div className="space-y-3">
                  {others.length > 0 && (
                    <div className="flex justify-end gap-2">
                      {others.map(b => (
                        <BranchPill key={b.rootId} branch={b} onClick={() => setFocusedBranch(null)} />
                      ))}
                    </div>
                  )}
                  <BranchChat {...laneProps(focused)} focused split={false} />
                </div>
              ) : (
                <>
                  <div className={branches.length > 1 ? 'grid grid-cols-1 xl:grid-cols-2 gap-4 items-start' : 'max-w-2xl'}>
                    {branches.map(b => (
                      <BranchChat key={b.rootId} {...laneProps(b)} split={branches.length > 1} />
                    ))}
                  </div>
                  {branches.length > 1 && (
                    <p className="text-[11px] text-text-tertiary">
                      Type in either box to work on that one — it opens full size and the other waits as a chip.
                      Drag an image from one chat into the other to reuse it there.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </main>
      </div>

      {/* ── Animate ── */}
      <Modal open={!!videoTarget} onClose={() => { setVideoTarget(null); setVideoPrefill(null) }}
        title="Animate this image" width="max-w-lg">
        <VideoPanel
          target={videoTarget}
          busy={busy.startsWith('video:')}
          onSubmit={handleAnimate}
          onCancel={() => { setVideoTarget(null); setVideoPrefill(null) }}
          onEnhance={enhanceMotionPrompt}
          enhancing={enhancing === 'motion'}
          initialPrompt={videoPrefill?.prompt}
          initialDuration={videoPrefill?.duration}
          initialResolution={videoPrefill?.resolution}
          initialAudio={videoPrefill?.generateAudio}
        />
      </Modal>

      {/* ── Text editor ── */}
      <Modal open={!!editingOverlay} onClose={() => setEditingOverlay(null)} title="Add text" width="max-w-5xl">
        <div className="p-6">
          {editingOverlay && (
            <OverlayEditor
              imageUrl={editingOverlay.image_url}
              initialState={editingOverlay.overlay_state}
              saving={savingOverlay}
              onSave={handleOverlaySave}
              onCancel={() => setEditingOverlay(null)}
            />
          )}
        </div>
      </Modal>
    </div>
  )
}
