import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../../store/appStore'
import { useAuth } from '../../store/AuthContext'
import { Button, Card, Modal, SectionHead, Select, Spinner, Textarea, Empty } from '../../components/ui/index'
import { BranchChat, BranchPill } from '../../components/studio/BranchChat'
import { PromptBubble } from '../../components/studio/VersionCard'
import { OverlayEditor } from '../../components/studio/OverlayEditor'
import { VideoPanel } from '../../components/studio/VideoPanel'
import { MediaPicker, AttachmentChip } from '../../components/studio/MediaPicker'
import { AudioToggle, CostLine, LookPicker, ModelPicker, MotionPicker, QualityRow } from '../../components/studio/VideoSettings'
import { buildVideoPrompt } from '../../components/studio/motionPresets'
import { getVideoModel } from '../../components/studio/videoModels'
import { aspectLabel } from '../../lib/postFormats'
import { uploadReferenceImage } from '../../lib/referenceImages'
import { buildInstructionsString } from '../../lib/brandBrain'
import {
  buildBranches, createSession, downloadVersion, fetchSessions, fetchVersions, finalizeVersion,
  insertPendingVersions, requestEdit, requestEnhance, requestGenerate, requestVideo, selectVersion,
  touchSession, updateVersion, uploadToStudio,
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
// 'image_video' was dropped from the picker — it was never a third mode, just
// the image flow with a hint, and every image already animates from its own
// lane's 🎬 button. Sessions created under it still open normally (the DB
// check constraint and openSession's label both still accept it); it just
// can't be chosen for new work.
const INTENTS = [
  { value: 'image', label: 'An image', hint: 'A post, story or ad visual — animate it after if you want' },
  { value: 'video', label: 'A video',  hint: 'A clip generated straight from a description' },
]
const emptyComposer = { text: '', baseId: null, attach: null }

// What the ➕ can attach, per tab. `kind` filters the library grid; `notes`
// says whether the chip offers a "what should it take from this?" box.
const IMAGE_SLOTS = [
  { id: 'reference', label: 'Reference image', hint: 'Take inspiration from it', kind: 'image', notes: true,
    notePlaceholder: 'e.g. same style, but a hotel lobby' },
]
// Style reference is the ➕'s only slot on the video tab too — start/end
// frame get their own small boxes beside it instead (VIDEO_FRAME_SLOTS
// below), since they're core to what a video render actually is, not an
// optional extra to bury in a dropdown.
const VIDEO_MENU_SLOTS = [
  { id: 'reference', label: 'Style reference', hint: 'An image or clip to echo', kind: 'all', notes: true,
    notePlaceholder: 'e.g. match this pacing and grade' },
]
// Seedance genuinely takes a start frame and an end frame (image_url /
// end_image_url) — the end frame is what makes clip-to-clip chaining look
// deliberate rather than cut.
const VIDEO_FRAME_SLOTS = [
  { id: 'startFrame', label: 'Start frame', hint: 'The clip opens on this image', kind: 'image', notes: false },
  { id: 'endFrame',   label: 'End frame',   hint: 'The clip lands on this image', kind: 'image', notes: false },
]

// ⚠️ Frontend only, by decision (2026-08-10). These three attachments are
// collected and shown, but nothing is sent to the video workflow yet:
//   · startFrame → maps cleanly to Seedance's image_url (switches t2v → i2v)
//   · endFrame   → maps cleanly to end_image_url
//   · reference  → has NO model input; would need a separate describe-then-
//     inject step, so it's the one that needs design rather than plumbing.
// Wire these up when the video backend pass happens.
const VIDEO_BACKEND_PENDING = true

// The ➕ itself. Icon only — the label crowded a row that already has
// Enhance and the auto-enhance checkbox on it, and the icon alone reads
// fine once it's not the only unlabelled thing in view. A menu only when
// there's a real choice to make; both tabs currently have one slot
// (style reference), so this always attaches directly rather than opening.
function AttachMenu({ slots, taken, onChoose }) {
  const [open, setOpen] = useState(false)
  const free = slots.filter(s => !taken[s.id])
  const disabled = free.length === 0

  function click() {
    if (disabled) return
    if (slots.length === 1) { onChoose(slots[0]); return }
    setOpen(o => !o)
  }

  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="relative">
        <button type="button" onClick={click} disabled={disabled}
          title={disabled ? 'Everything that can be attached already is' : 'Attach a style reference'}
          className="inline-flex items-center justify-center w-7 h-7 rounded-lg border border-border hover:border-amber-400 hover:bg-amber-50 disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-transparent">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
        </button>
        {open && (
          <>
            {/* Click-away sits behind the menu, not over it. */}
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className="absolute z-20 mt-1 w-56 rounded-xl border border-border bg-white shadow-dropdown p-1">
              {free.map(s => (
                <button key={s.id} type="button"
                  onClick={() => { setOpen(false); onChoose(s) }}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-surface-muted transition-colors">
                  <p className="text-[11px] font-semibold text-text">{s.label}</p>
                  <p className="text-[10px] text-text-tertiary leading-snug">{s.hint}</p>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <span className="text-[9px] text-text-tertiary leading-none whitespace-nowrap">Attach ref:</span>
    </div>
  )
}

// Small, separate from the ➕ on purpose (see VIDEO_MENU_SLOTS above) — a
// start or end frame is a fixed input on the video tab, not one option among
// several, so it gets its own always-visible square rather than living a
// click deep in a menu. Empty shows a plus; filled shows the thumbnail with
// its own remove button.
function FrameSlot({ label, hint, value, onPick, onRemove }) {
  const isVideo = /\.(mp4|mov|webm)(\?|$)/i.test(value?.url || '')
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="relative">
        <button type="button" onClick={onPick} title={hint}
          className={`w-7 h-7 rounded-lg overflow-hidden flex items-center justify-center transition-colors ${
            value ? 'border border-border hover:border-amber-400 hover:bg-amber-50' : 'border border-dashed border-border hover:border-amber-400 hover:bg-amber-50'
          }`}>
          {value ? (
            isVideo
              ? <video src={value.url} className="w-full h-full object-cover" muted />
              : <img src={value.url} alt="" className="w-full h-full object-cover" />
          ) : (
            <svg className="w-3 h-3 text-text-tertiary" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
          )}
        </button>
        {value && (
          <button type="button" onClick={onRemove} title="Remove"
            className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-white border border-border text-text-tertiary hover:text-red-500 text-[9px] leading-none flex items-center justify-center">×</button>
        )}
      </div>
      <span className="text-[9px] text-text-tertiary leading-none whitespace-nowrap">{label}</span>
    </div>
  )
}

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
  // Images per model per round. Default 1 so a round costs exactly what it did
  // before unless more is deliberately asked for — 4 means EIGHT images (four
  // per model), which the picker says out loud rather than leaving to arithmetic.
  const [variants, setVariants] = useState(1)
  // Keyed by slot id (see IMAGE_SLOTS / VIDEO_MENU_SLOTS / VIDEO_FRAME_SLOTS): { url, name, note }.
  const [attachments, setAttachments] = useState({})
  const [pickerSlot, setPickerSlot] = useState(null)

  // Per-lane state, keyed by branch id, so the two conversations never share
  // a draft, a base image or a dropped reference.
  const [composers, setComposers] = useState({})
  const [focusedBranch, setFocusedBranch] = useState(null)

  // Round-0 text-to-video settings. Same controls as the Animate modal (they
  // share VideoSettings.jsx), plus a look picker — with no source still, the
  // look has to come from somewhere, and writing one in prose is exactly the
  // job the preset library exists to remove.
  const [modelId, setModelId] = useState('seedance-2')
  const [duration, setDuration] = useState('5')
  const [resolution, setResolution] = useState('720p')
  const [audio, setAudio] = useState(false)
  const model = getVideoModel(modelId)
  // Each model has its own allowed durations/resolutions (Kling and Hailuo
  // have no resolution dial at all) — carrying over the previous model's
  // values would silently send a setting the new one doesn't accept.
  function pickModel(id) {
    const next = getVideoModel(id)
    setModelId(id)
    setDuration(next.defaultDuration)
    setResolution(next.defaultResolution)
    if (next.audio === 'unsupported') setAudio(false)
  }
  const [motionNote, setMotionNote] = useState('')
  const [motionPresetId, setMotionPresetId] = useState('')
  const [motionStrength, setMotionStrength] = useState('medium')
  const [lookId, setLookId] = useState('none')
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
    setSession(null); setVersions([]); setPrompt(''); setAttachments({})
    setPromptRaw(''); setPromptSource('raw')
    setMotionNote(''); setMotionPresetId(''); setMotionStrength('medium'); setLookId('none')
    // Back to the cheap default — an 8-image round should be asked for each
    // time, not inherited from whatever the last session happened to use.
    setVariants(1)
    setModelId('seedance-2'); setDuration('5'); setResolution('720p'); setAudio(false)
    setComposers({}); setFocusedBranch(null); setError('')
  }

  // ── Attachments ──
  // Only the ➕ menu's own slots — start/end frame render their own compact
  // boxes and don't need a spot in the bigger note-bearing chip list below.
  const activeSlots = intent === 'video' ? VIDEO_MENU_SLOTS : IMAGE_SLOTS

  function setAttachment(slotId, value) {
    setAttachments(prev => {
      const next = { ...prev }
      if (value) next[slotId] = value
      else delete next[slotId]
      return next
    })
  }

  function openPickerFor(slot) { setPickerSlot(slot) }

  // Switching tabs must not carry an attachment into a slot the other tab
  // doesn't have — a start frame left over on the image tab would be invisible
  // and still get sent.
  function changeIntent(next) {
    if (next === intent) return
    setIntent(next)
    setAttachments({})
  }

  const refUrl   = attachments.reference?.url  || ''
  const refNotes = attachments.reference?.note || ''

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
    // Scene, then look, then movement — one assembled string, because the
    // model takes a single prompt. The scene stays first and unmodified: it's
    // what the human actually asked for, and these models weight the opening
    // most heavily. What's stored on the row is the assembled text, since
    // that's what genuinely produced the clip.
    const videoPrompt = videoOnly
      ? buildVideoPrompt({ scene: finalPrompt, lookId, motion: motionNote, strength: motionStrength, duration })
      : finalPrompt

    // Video has one provider, so a video-only session gets one render rather
    // than a two-way comparison — variations come from re-rendering, not from
    // a second model.
    const rows = videoOnly
      // provider stays the generic 'seedance' DB tag (the check constraint
      // only allows a fixed list) — the actual model choice lives in its own
      // `model` column (20260810_creative_studio_video_model.sql) instead.
      ? [{ round: 0, kind: 'video', provider: 'seedance', mediaType: 'video',
           userPrompt: videoPrompt, originalPrompt, promptSource: source,
           aspectRatio: aspect, model: modelId, duration, resolution, generateAudio: audio }]
      // N rows per provider rather than asking fal for num_images: N. Same
      // image count and same cost (fal bills per image), but each variant gets
      // its own row and lands the moment it's ready — the workflow already
      // renders exactly one image per target, so this needed no change there.
      : ['openai', 'gemini'].flatMap(provider =>
          Array.from({ length: variants }, () => ({
            round: 0, kind: 'generate', provider, mediaType: 'image',
            userPrompt: finalPrompt, originalPrompt, promptSource: source,
            aspectRatio: aspect,
            referenceUrl: refUrl, referenceNotes: refNotes,
          })))

    const ins = await insertPendingVersions(activeWorkspaceId, accessToken, s.id, rows)
    if (ins.error) { setBusy(''); setError(ins.error); return }

    const fired = videoOnly
      ? await requestVideo(webhooks.creativeVideo, {
          session_id: s.id, version_id: ins.rows[0].id, prompt: videoPrompt,
          model: modelId, duration, aspect_ratio: aspect, resolution, generate_audio: audio,
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

    // Walk root → base and collect what's already been asked for. Without
    // this the model sees one image and one instruction, so a follow-up like
    // "a bit more" or "actually go back a little" refers to nothing. Sent as
    // context only — the workflow says plainly that these are already applied,
    // or the model re-applies them and the change lands twice.
    //
    // The chain, not the whole lane: continuing from an earlier version means
    // the edits made after it never happened as far as this image is concerned.
    const chain = []
    { let cur = base, guard = 0
      while (cur && guard++ < 50) {
        chain.unshift(cur)
        cur = cur.parent_version_id ? branch.versions.find(v => v.id === cur.parent_version_id) : null
      } }
    const history = chain.filter(v => v.kind === 'edit' && v.user_prompt).map(v => v.user_prompt)
    const originalPrompt = chain[0]?.user_prompt || ''

    // Edit with the model that MADE this lane, not always Gemini. This was
    // hardcoded to 'gemini' and never sent in the payload, so the workflow's
    // provider switch always fell through — editing the ChatGPT candidate
    // silently handed it to Nano Banana and the look changed mid-conversation,
    // which also quietly invalidated the side-by-side the screen exists for.
    // Editing a dropped-in image is the one exception: it came from the other
    // lane, so the model that made THAT image is the right one for it.
    const editProvider = (editingDropped && attach?.provider) || branch.provider || 'gemini'

    setFocusedBranch(branch.rootId)
    const created = await runStep(branch, {
      label: 'edit',
      row: {
        round: nextRound, kind: 'edit', provider: editProvider, mediaType: 'image',
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
        provider: editProvider,
        original_prompt: originalPrompt,
        history,
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
  async function handleAnimate({ prompt: motionText, model: animateModel, duration: dur, resolution, generateAudio }) {
    const target = videoTarget
    const branch = branches.find(b => b.versions.some(v => v.id === target?.id))
    if (!target || !branch || !motionText.trim()) return
    setVideoTarget(null); setVideoPrefill(null)
    await runStep(branch, {
      label: 'video',
      row: {
        round: nextRound, kind: 'video', provider: 'seedance', mediaType: 'video',
        parentVersionId: target.id, userPrompt: motionText.trim(), aspectRatio: session.aspect_ratio,
        model: animateModel, duration: dur, resolution, generateAudio,
      },
      payload: {
        image_url: target.image_url, prompt: motionText.trim(), model: animateModel,
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
      model: video.model || 'seedance-2',
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

  // Re-run one failed candidate against the same brief. Most failures at this
  // point are transient — a rate limit, a momentary provider error — and the
  // only previous way out was abandoning the session and retyping everything.
  //
  // A new row rather than reviving the old one: the failure is a real event in
  // the thread and overwriting it would hide that this took two attempts. The
  // dead row is removed from view once the replacement exists, so the lane
  // doesn't accumulate red cards.
  async function handleRetry(version) {
    if (!version || !session) return
    setBusy(`retry:${version.id}`); setError('')

    const isRound0 = !version.parent_version_id
    const row = {
      round: version.round, kind: version.kind, provider: version.provider,
      mediaType: version.media_type, parentVersionId: version.parent_version_id || null,
      userPrompt: version.user_prompt, originalPrompt: version.original_prompt || '',
      promptSource: version.prompt_source || 'raw', aspectRatio: version.aspect_ratio,
      referenceUrl: version.reference_url || '', referenceNotes: version.reference_notes || '',
      duration: version.duration || '', resolution: version.resolution || '',
      generateAudio: !!version.generate_audio, model: version.model || '',
    }
    const ins = await insertPendingVersions(activeWorkspaceId, accessToken, session.id, [row])
    if (ins.error) { setBusy(''); setError(ins.error); return }
    const fresh = ins.rows[0]

    let fired
    if (version.kind === 'video') {
      fired = await requestVideo(webhooks.creativeVideo, {
        session_id: session.id, version_id: fresh.id, prompt: version.user_prompt,
        image_url: version.parent_version_id
          ? versions.find(v => v.id === version.parent_version_id)?.image_url || ''
          : '',
        model: version.model || 'seedance-2', duration: version.duration || '5',
        aspect_ratio: version.aspect_ratio, resolution: version.resolution || '720p',
        generate_audio: !!version.generate_audio,
      })
    } else if (isRound0) {
      fired = await requestGenerate(webhooks.creativeGenerate, {
        session_id: session.id, prompt: version.user_prompt, aspect_ratio: version.aspect_ratio,
        instructions: brandInstructions,
        reference_url: version.reference_url || '', reference_notes: version.reference_notes || '',
        targets: [{ version_id: fresh.id, provider: version.provider }],
      })
    } else {
      const parent = versions.find(v => v.id === version.parent_version_id)
      fired = await requestEdit(webhooks.creativeEdit, {
        session_id: session.id, version_id: fresh.id,
        source_image_url: parent?.image_url || '',
        reference_image_urls: version.reference_url ? [version.reference_url] : [],
        instruction: version.user_prompt, provider: version.provider,
      })
    }

    setBusy('')
    // Swap the failed card for the fresh pending one in a single update, so
    // the lane never briefly shows both.
    setVersions(prev => [...prev.filter(v => v.id !== version.id), fresh])
    if (fired.error) {
      setError(fired.error)
      await updateVersion(accessToken, fresh.id, { status: 'failed', error: fired.error })
      refresh(session.id)
    }
  }

  // Save and Download are deliberately both here and do different things:
  // Save files it in the Media Library and stops. Download puts the file on
  // your disk — and files it too, if it wasn't already, because downloading
  // something is a clearer statement of "I'm keeping this" than pressing Save
  // is. The is_final flag is what keeps a second download from duplicating it.
  async function handleDownload(version) {
    if (!version) return
    setBusy(`download:${version.id}`); setError('')
    const res = await downloadVersion(activeWorkspaceId, accessToken, version, session?.title)
    setBusy('')
    if (res.error) { setError(res.error); return }
    if (res.savedError) { setError(`Downloaded, but couldn't add it to the Media Library: ${res.savedError}`); return }
    if (res.alsoSaved) {
      setVersions(prev => prev.map(v => (v.id === version.id ? { ...v, is_final: true } : v)))
    }
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
    onDownload: handleDownload,
    onRetry: handleRetry,
    pendingKey: busy,
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
                <div className="grid grid-cols-2 gap-2">
                  {INTENTS.map(i => (
                    <button key={i.value} onClick={() => changeIntent(i.value)}
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
                    {/* Attach sits with the prompt, the way every chat app puts
                        it — the old reference box lived at the bottom of the
                        form, past the settings, which read as a separate step
                        rather than part of what you're asking for. */}
                    <AttachMenu
                      slots={intent === 'video' ? VIDEO_MENU_SLOTS : IMAGE_SLOTS}
                      taken={attachments}
                      onChoose={openPickerFor}
                    />
                    {intent === 'video' && VIDEO_FRAME_SLOTS.map(s => (
                      <FrameSlot key={s.id} label={s.label} hint={s.hint}
                        value={attachments[s.id]}
                        onPick={() => openPickerFor(s)}
                        onRemove={() => setAttachment(s.id, null)}
                      />
                    ))}
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

                {activeSlots.some(s => attachments[s.id]) && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                    {activeSlots.filter(s => attachments[s.id]).map(s => (
                      <AttachmentChip key={s.id}
                        label={s.label}
                        url={attachments[s.id].url}
                        note={attachments[s.id].note}
                        notePlaceholder={s.notePlaceholder}
                        onNote={s.notes ? v => setAttachment(s.id, { ...attachments[s.id], note: v }) : undefined}
                        onRemove={() => setAttachment(s.id, null)}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className={intent === 'video' ? '' : 'grid grid-cols-2 gap-3'}>
                <Select label="Shape" value={aspect} onChange={e => setAspect(e.target.value)}>
                  {RATIOS.map(r => <option key={r} value={r}>{aspectLabel(r)} ({r})</option>)}
                </Select>
                {intent !== 'video' && (
                  <Select label="Options per model" value={String(variants)}
                    onChange={e => setVariants(Number(e.target.value))}>
                    <option value="1">1 each — 2 images</option>
                    <option value="2">2 each — 4 images</option>
                    <option value="4">4 each — 8 images</option>
                  </Select>
                )}
              </div>

              {/* Text-to-video gets the same controls as the Animate modal —
                  they were only ever in the modal, which meant a video-only
                  session silently rendered at 1080p with no way to pick a
                  move. Plus a look picker, which only makes sense here: with
                  no source still, nothing else decides how the clip looks. */}
              {intent === 'video' && (
                <div className="rounded-xl border border-border bg-surface-subtle/40 p-3 space-y-3">
                  <ModelPicker modelId={modelId} onPick={pickModel} />

                  <LookPicker lookId={lookId} onPick={setLookId} />

                  <MotionPicker
                    label="How should the camera move? (optional)"
                    presetId={motionPresetId}
                    onPickPreset={p => { setMotionPresetId(p ? p.id : ''); setMotionNote(p ? p.prompt : '') }}
                    strength={motionStrength}
                    onStrength={setMotionStrength}
                  />

                  <Textarea rows={2} value={motionNote}
                    onChange={e => { setMotionNote(e.target.value); setMotionPresetId('') }}
                    placeholder="…or describe the movement yourself. Leave empty to let the model decide." />

                  <QualityRow
                    model={model} audio={audio}
                    duration={duration} onDuration={setDuration}
                    resolution={resolution} onResolution={setResolution}
                  />

                  <AudioToggle model={model} audio={audio} onAudio={setAudio} />

                  <div className="flex items-center justify-between gap-2">
                    <CostLine model={model} resolution={resolution} duration={duration} audio={audio} />
                    <p className="text-[10px] text-text-tertiary">{model.durations[model.durations.length - 1]}s is the most one render can produce.</p>
                  </div>
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
          initialModel={videoPrefill?.model}
          initialDuration={videoPrefill?.duration}
          initialResolution={videoPrefill?.resolution}
          initialAudio={videoPrefill?.generateAudio}
        />
      </Modal>

      {/* ── Attach a reference ── */}
      <MediaPicker
        open={!!pickerSlot}
        onClose={() => setPickerSlot(null)}
        title={pickerSlot ? `Add ${pickerSlot.label.toLowerCase()}` : ''}
        kind={pickerSlot?.kind || 'image'}
        accessToken={accessToken}
        onUpload={file => uploadReferenceImage(activeWorkspaceId, accessToken, file)}
        onPick={picked => setAttachment(pickerSlot.id, picked)}
      />

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
