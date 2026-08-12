import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useApp } from '../../store/app'
import { useAuth } from '../../store/auth'
import { Button, Card, Modal, SectionHead, Select, Spinner, Textarea, Empty } from '../../components/ui/index'
import { BranchChat, BranchPill } from '../../components/studio/BranchChat'
import { SessionSidebar } from '../../components/studio/SessionSidebar'
import { Lightbox } from '../../components/studio/Lightbox'
import { PromptBubble } from '../../components/studio/VersionCard'
import { PhotoEditor } from '../../components/studio/editor/index'
import { VideoPanel } from '../../components/studio/VideoPanel'
import { MediaPicker, AttachmentChip, MultiRefRow } from '../../components/studio/MediaPicker'
import { AudioToggle, CostLine, LookPicker, ModelPicker, MotionPicker, QualityRow } from '../../components/studio/VideoSettings'
import { buildVideoPrompt } from '../../components/studio/motionPresets'
import { ClipBoard } from '../../components/studio/ClipBoard'
import { useClipSequencer } from '../../components/studio/useClipSequencer'
import {
  MULTI_CLIP_MAX, emptyStoryboard, moveClip, newClip, nextClipAttempt, normalizeStoryboard,
  saveStoryboard, stitchRowsOf, storyboardTotals,
} from '../../lib/creativeStoryboard'
import {
  canEditVideoDuration, estimateVideoCost, estimateVideoEditCost, getVideoModel, modelImageMax,
  modelImageRole, VIDEO_EDIT_MAX_REFERENCES,
} from '../../components/studio/videoModels'
import { aspectLabel } from '../../lib/postFormats'
import { uploadReferenceImage } from '../../lib/referenceImages'
import { buildInstructionsString } from '../../lib/brandBrain'
import { captureFirstFrame, parentStillOf } from '../../components/studio/videoFrame'
import {
  buildBranches, createSession, deleteSession, downloadVersion, fetchFalBalance, fetchSessions,
  fetchVersions, finalizeVersion, insertPendingVersions, renameSession, requestCompose, requestEdit,
  requestEnhance, requestGenerate, requestVideo, requestStitch, requestVideoEdit, selectVersion,
  touchSession, updateVersion, uploadToStudio,
} from '../../lib/creativeStudio'
import { fetchIdeaForStudio } from '../../lib/studioBridge'
import { UseThisSheet } from '../../components/studio/UseThisSheet'

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
// 'multi_video' IS a third mode, unlike 'image_video': no model here renders a
// long video affordably (Seedance 2.5 is the only one that reaches 30s at all,
// at $14.19 a take), so length has to come from several short clips chained
// and stitched rather than from one long render.
const INTENTS = [
  { value: 'image', label: 'An image', hint: 'A post, story or ad visual' },
  { value: 'video', label: 'A video',  hint: 'A clip generated straight from a description' },
  { value: 'multi_video', label: 'A long video', hint: 'Several shots, chained and stitched into one' },
]
const emptyComposer = { text: '', baseId: null, attach: null, refs: [] }

// Which model a fresh render starts on, and the settings that come with it.
// Read from the catalog rather than repeated as literals, because pickModel
// already resets duration/resolution to the chosen model's own defaults —
// hardcoding them here too would mean switching away from the default model
// and back gave you different settings than you started with.
const DEFAULT_VIDEO_MODEL = 'seedance-2.5'
const videoDefaults = () => {
  const m = getVideoModel(DEFAULT_VIDEO_MODEL)
  return { modelId: m.id, duration: m.defaultDuration, resolution: m.defaultResolution }
}

// Animation was parked on 2026-08-11 while the image side was finished, and
// un-parked the same day once video compositing landed — the reason for the
// pause (a clip you couldn't put editable text on) is exactly what Creative
// Compose removed.

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
//
// `multi: true` because fal's reference-to-video (and the video-edit
// endpoint below) genuinely take several — up to 9 images on generate, 4
// combined on an edit. `attachments.reference` is an ARRAY for this slot,
// unlike every single-value slot elsewhere, which is what `multi` signals to
// the render code. No per-reference note: nothing downstream ever read it —
// Seedance's reference-to-video is addressed generically as "@Image1 and
// @Image2 show the look to follow" (built server-side), not from marketer text.
const VIDEO_MENU_SLOTS = [
  { id: 'reference', label: 'Style reference', hint: 'Up to 4 images or clips to echo', kind: 'all',
    multi: true, max: VIDEO_EDIT_MAX_REFERENCES, notes: false },
]
// Seedance genuinely takes a start frame and an end frame (image_url /
// end_image_url) — the end frame is what makes clip-to-clip chaining look
// deliberate rather than cut.
const VIDEO_FRAME_SLOTS = [
  { id: 'startFrame', label: 'Start frame', hint: 'The clip opens on this image', kind: 'image', notes: false },
  { id: 'endFrame',   label: 'End frame',   hint: 'The clip lands on this image', kind: 'image', notes: false },
]

// All three are wired as of 2026-08-11. The note that used to sit here said the
// style reference had "NO model input" — that was true of the image-to-video
// endpoints we were calling and false of fal, which hosts a separate
// reference-to-video endpoint taking an `image_urls` array. So:
//   · startFrame → image_url (switches text-to-video → image-to-video)
//   · endFrame   → end_image_url (Seedance only; what makes a cut deliberate)
//   · reference  → reference_image_urls → the r2v endpoint, addressed in the
//     prompt as @Image1. Seedance 2.0/2.5 only; the picker says so.

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
          className="inline-flex items-center justify-center w-7 h-7 border border-border hover:border-amber-400 hover:bg-amber-50 disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-transparent">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
        </button>
        {open && (
          <>
            {/* Click-away sits behind the menu, not over it. */}
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className="absolute z-20 mt-1 w-56 border border-border bg-white shadow-dropdown p-1">
              {free.map(s => (
                <button key={s.id} type="button"
                  onClick={() => { setOpen(false); onChoose(s) }}
                  className="w-full text-left px-2.5 py-1.5 hover:bg-surface-muted transition-colors">
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
          className={`w-7 h-7 overflow-hidden flex items-center justify-center transition-colors ${
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
            className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-white border border-border text-text-tertiary hover:text-red-500 text-[9px] leading-none flex items-center justify-center">×</button>
        )}
      </div>
      <span className="text-[9px] text-text-tertiary leading-none whitespace-nowrap">{label}</span>
    </div>
  )
}

// Shown while a session's versions are being fetched. Shaped like the thread
// that's about to replace it — opening prompt, then one or two lanes — so the
// panel doesn't jump when the real rows land.
function ThreadSkeleton() {
  return (
    <div className="space-y-3 animate-pulse" aria-busy="true" aria-label="Loading this session">
      <div className="flex justify-end">
        <div className="h-9 w-1/2 max-w-sm bg-surface-muted border border-border" />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        {[0, 1].map(i => (
          <div key={i} className="border border-border bg-white p-3 space-y-2.5">
            <div className="aspect-[4/5] w-full bg-surface-muted" />
            <div className="h-2.5 w-2/3 bg-surface-muted" />
            <div className="h-8 w-full bg-surface-muted" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function CreativeStudio() {
  const { state } = useApp()
  const { activeWorkspaceId, accessToken } = useAuth()
  const webhooks = state.webhooks || {}
  const [searchParams] = useSearchParams()

  const [sessions, setSessions] = useState([])
  const [session, setSession] = useState(null)
  const [versions, setVersions] = useState([])
  // Derived, not set in an effect: with no workspace there is nothing to wait
  // for, so the list is already "loaded" (and empty) on first render.
  const [loading, setLoading] = useState(!!activeWorkspaceId)
  // Which session's versions are still in flight. openSession clears the old
  // thread before the new rows land, so without this the "Nothing here yet"
  // empty state renders for the length of the fetch on every open — the thread
  // looked briefly empty and then filled in. Holds the session id rather than a
  // boolean so a fast second click doesn't have the first fetch clear its flag.
  const [openingId, setOpeningId] = useState(null)
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
  // The last successful enhance, kept so Redo can restore it without a second
  // round-trip. Cleared whenever a fresh enhance runs or the raw text changes
  // underneath it (see the textarea's onChange) — stale means "not this text
  // any more", and reapplying an enhance for different words would be wrong.
  const [promptEnhanced, setPromptEnhanced] = useState('')
  const [promptSource, setPromptSource] = useState('raw')   // raw | enhanced | enhanced_edited
  const [autoEnhance, setAutoEnhance] = useState(false)
  const [enhancing, setEnhancing] = useState('')            // '' | 'prompt' | 'motion'
  const [aspect, setAspect] = useState('4:5')
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
  const [modelId, setModelId] = useState(videoDefaults().modelId)
  const [duration, setDuration] = useState(videoDefaults().duration)
  const [resolution, setResolution] = useState(videoDefaults().resolution)
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

  // Multi-clip. The shot list lives on the SESSION (creative_sessions.
  // storyboard), not on the version rows, because the video workflow replaces
  // creative_versions.overlay_state wholesale when it records a fal request
  // id — anything the browser writes there on a video row is destroyed the
  // moment the render is submitted. n8n never writes creative_sessions.
  const [storyboard, setStoryboard] = useState(null)
  const [stitching, setStitching] = useState(false)
  // null means "no figure to show" — either the webhook isn't configured or
  // the lookup failed. Deliberately not 0: a balance of zero and a balance we
  // couldn't read must never render the same, since one of them means "stop".
  const [falBalance, setFalBalance] = useState(null)

  const [videoTarget, setVideoTarget] = useState(null)      // the still being animated
  // Set only by the 🔄 re-render action: the exact prompt/duration/
  // resolution/audio of a past render, so VideoPanel reopens pre-filled
  // rather than asking the human to retype a motion note that already
  // worked. Null for the normal ✨ Animate path — that one starts blank.
  const [videoPrefill, setVideoPrefill] = useState(null)
  const [editingOverlay, setEditingOverlay] = useState(null)
  const [savingOverlay, setSavingOverlay] = useState(false)
  // Text/logos on a finished clip. Held separately from editingOverlay because
  // the two open the SAME editor in different modes against different bases,
  // and one piece of state trying to mean both is how you end up compositing an
  // image or saving a clip as a PNG.
  // Shape: { version, frameUrl } — the clip's row plus whatever frame one
  // resolved to (its source still, or a frame captured from the clip itself).
  const [editingClip, setEditingClip] = useState(null)
  const [preparingClip, setPreparingClip] = useState('')
  // Every finished still in this session, offered inside the editor as image
  // layers you can drop onto another one — the "put the logo from round 1 on
  // this background" move, without a round trip through Downloads.
  const editorLibrary = useMemo(() => (
    versions
      .filter(v => v.status === 'ready' && v.media_type !== 'video' && v.image_url)
      .map(v => ({ url: v.image_url, label: v.user_prompt || 'Earlier version' }))
  ), [versions])
  // Which lane's 📎 opened the picker — null when closed. Separate from
  // `pickerSlot` above: that one fills a slot on the pre-generation form,
  // this one fills a single lane's composer.attach once a session exists.
  const [attachLane, setAttachLane] = useState(null)
  // The full-screen viewer: { versions, startId }. One instance for the whole
  // page rather than one per lane, so opening it from either side can page
  // through that lane's own history with ← →.
  const [zoomView, setZoomView] = useState(null)

  useEffect(() => {
    if (!activeWorkspaceId) return
    let cancelled = false
    fetchSessions(activeWorkspaceId, accessToken).then(rows => {
      if (cancelled) return          // workspace switched mid-fetch
      setSessions(rows); setLoading(false)
    })
    return () => { cancelled = true }
  }, [activeWorkspaceId, accessToken])

  // ── Arriving from the plan board ────────────────────────────────────────
  // Two entry points, neither of which creates anything:
  //
  //   /studio?session=<id>  an idea that already has a session — just open it.
  //                         Handled by SessionSidebar's autoOpenId, because
  //                         opening a session is the rail's job and routing it
  //                         there keeps exactly one way in.
  //   /studio?ideaId=<id>   a fresh idea — pre-fill this composer and let the
  //                         normal generate path create the session, carrying
  //                         the plan link with it (see startSession below).
  //
  // Creating the session up front instead would land the operator on a session
  // with no versions, which renders as "Nothing here yet" and offers no
  // composer — a dead end.
  //
  // All three modes carry the plan link — image, video and "A long video"
  // alike. The composer opens on image or video (a plan idea says nothing
  // about shot count, and guessing long-form would spend an order of magnitude
  // more than asked), but switching to long video keeps the idea attached, and
  // the stitched result gets its own "Use this →" on the clip board.
  //
  // Guarded by a ref rather than by `session`, so navigating away inside the
  // studio isn't undone by the effect re-firing while the param is still set.
  // The version the "Use this" sheet is open for, or null.
  const [useThisFor, setUseThisFor] = useState(null)
  const [planBrief, setPlanBrief] = useState(null)
  const seededIdeaRef = useRef(null)
  useEffect(() => {
    const ideaId = searchParams.get('ideaId')
    if (!ideaId || seededIdeaRef.current === ideaId || !accessToken) return
    seededIdeaRef.current = ideaId
    let alive = true
    fetchIdeaForStudio(accessToken, ideaId).then(seed => {
      if (!alive || !seed) return
      setPlanBrief({ ideaId, brief: seed.brief, title: seed.idea.title || seed.idea.topic })
      // Pre-fill the composer as if the operator had typed it. promptRaw is
      // set alongside prompt so Undo after an enhance returns to the brief's
      // words rather than to an empty box.
      setPrompt(seed.prompt); setPromptRaw(seed.prompt); setPromptSource('raw')
      setIntent(seed.intent)
      setAspect(seed.aspect)
    })
    return () => { alive = false }
  }, [searchParams, accessToken])

  const branches = useMemo(() => buildBranches(versions), [versions])
  const anyPending = versions.some(v => v.status === 'pending')

  const refresh = useCallback(async (sessionId) => {
    const rows = await fetchVersions(accessToken, sessionId)
    setVersions(rows)
    return rows
  }, [accessToken])

  // Read once per page load, and again whenever a render run finishes — often
  // enough to be useful, rare enough that a spend figure never turns into a
  // poll against someone else's API.
  useEffect(() => {
    let cancelled = false
    fetchFalBalance(webhooks.falBalance).then(n => { if (!cancelled) setFalBalance(n) })
    return () => { cancelled = true }
  }, [webhooks.falBalance, versions.length])

  const isMulti = session?.intent === 'multi_video'

  // The multi-clip render run. Sequential and browser-driven, same as every
  // other generation here — see useClipSequencer for why one clip at a time
  // is a cost safeguard as much as a continuity one.
  const sequencer = useClipSequencer({
    session: isMulti ? session : null,
    versions, storyboard, webhooks,
    workspaceId: activeWorkspaceId, accessToken,
    onVersions: rows => setVersions(prev => [...prev, ...rows]),
    onError: setError,
    refresh,
  })

  // n8n owns writing results back, so the thread is refreshed from the table
  // rather than from webhook responses — that's also why a refresh or a closed
  // tab mid-generation loses nothing.
  //
  // `sequencer.running` is in the condition as well as `anyPending`: between
  // one clip going ready and the next clip's row existing there is a couple of
  // seconds with nothing pending at all, and tearing the poller down inside
  // that gap makes the run depend on the insert to restart it.
  useEffect(() => {
    if (!session || (!anyPending && !sequencer.running)) return
    const timer = setInterval(() => refresh(session.id), 4000)
    return () => clearInterval(timer)
  }, [session, anyPending, sequencer.running, refresh])

  async function openSession(s) {
    // Any storyboard edit still sitting in the debounce belongs to the session
    // being left, not the one being opened. flushStoryboard writes it against
    // the id it was made under.
    flushStoryboard()
    setSession(s); setError(''); setVersions([]); setComposers({}); setFocusedBranch(null)
    setAspect(s.aspect_ratio || '4:5')
    setOpeningId(s.id)
    // Normalised on the way in: a blob written by an older build may be
    // missing fields added since, and a half-written storyboard must not be
    // able to crash the page it renders on.
    setStoryboard(s.intent === 'multi_video' ? normalizeStoryboard(s.storyboard) : null)
    let rows
    try {
      rows = await refresh(s.id)
    } finally {
      // Only the newest open clears the flag — an earlier, slower fetch
      // finishing after a second click must not unmask the empty state.
      setOpeningId(prev => (prev === s.id ? null : prev))
    }
    // A multi-clip session has no lanes to reopen into — its clips are
    // siblings on one board, not competing edit lineages, and buildBranches
    // would read each hard-cut clip as its own chat lane.
    if (s.intent === 'multi_video') return
    // Reopen where the work was left off: the last lane touched is the one
    // holding the selected version, and only if it has moved past round 0 —
    // landing in a lane you never edited would just hide the comparison.
    const picked = rows.find(v => v.is_selected)
    if (!picked) return
    const home = buildBranches(rows).find(b => b.versions.some(v => v.id === picked.id))
    if (home && home.versions.length > 1) setFocusedBranch(home.rootId)
  }

  function newSession() {
    setSession(null); setVersions([]); setOpeningId(null); setPrompt(''); setAttachments({})
    setPromptRaw(''); setPromptSource('raw')
    setMotionNote(''); setMotionPresetId(''); setMotionStrength('medium'); setLookId('none')
    const d = videoDefaults()
    setModelId(d.modelId); setDuration(d.duration); setResolution(d.resolution); setAudio(false)
    setComposers({}); setFocusedBranch(null); setError('')
    setStoryboard(null); setStitching(false)
    // Starting a fresh session by hand means it is no longer the plan idea's —
    // without this, the next session created in this tab would silently
    // attach itself to a plan card the operator has moved on from.
    setPlanBrief(null)
  }

  // Renamed in place in the list — no need to also touch the open thread's
  // header, since the title only ever shows up in the sidebar.
  async function handleRenameSession(target, title) {
    setSessions(prev => prev.map(s => (s.id === target.id ? { ...s, title } : s)))
    if (session?.id === target.id) setSession(prev => ({ ...prev, title }))
    const res = await renameSession(accessToken, target.id, title)
    if (res.error) setError(res.error)
  }

  // Cascades in the database (creative_versions.session_id is ON DELETE
  // CASCADE), so one call removes the whole thread. If the deleted session
  // was open, fall back to the new-session form rather than showing a chat
  // with nothing behind it.
  async function handleDeleteSession(target) {
    if (!target) return
    setSessions(prev => prev.filter(s => s.id !== target.id))
    if (session?.id === target.id) newSession()
    const res = await deleteSession(accessToken, target.id)
    if (res.error) setError(res.error)
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

  // The `multi: true` sibling of setAttachment above — appends instead of
  // replacing, and caps at the slot's own `max` (fal's real limit, not a
  // preference) rather than growing without bound.
  function addAttachment(slotId, value, max) {
    setAttachments(prev => {
      const cur = Array.isArray(prev[slotId]) ? prev[slotId] : []
      if (cur.length >= max) return prev
      return { ...prev, [slotId]: [...cur, value] }
    })
  }
  function removeAttachmentAt(slotId, index) {
    setAttachments(prev => {
      const cur = Array.isArray(prev[slotId]) ? prev[slotId] : []
      const next = cur.filter((_, i) => i !== index)
      const out = { ...prev }
      if (next.length) out[slotId] = next
      else delete out[slotId]
      return out
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
    setPromptEnhanced(res.prompt)
    setPromptSource('enhanced')
    return res.prompt
  }

  function undoEnhance() {
    setPrompt(promptRaw)
    setPromptSource('raw')
  }

  // The other half of Undo: brings back the enhanced text without spending a
  // second webhook call. Only offered when there's something to bring back —
  // right after an Undo, before the raw text is touched further (see the
  // textarea's onChange, which clears promptEnhanced the moment it would stop
  // matching what's on screen).
  function redoEnhance() {
    if (!promptEnhanced) return
    setPrompt(promptEnhanced)
    setPromptSource('enhanced')
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

    // Multi-clip starts as a PLAN, not a render: the session is created with
    // clip 1 already typed, the board opens, and nothing is spent until
    // "Render all". That gap is deliberate — eight 20s clips on Seedance 2.5
    // is $75.68, so the storyboard is where the cost becomes visible before
    // it becomes real, not after.
    if (intent === 'multi_video') {
      const sb = emptyStoryboard({ model: modelId, lookId, prompt: finalPrompt })
      const madeMulti = await createSession(activeWorkspaceId, accessToken, {
        title: finalPrompt.slice(0, 80), intent, aspectRatio: aspect, storyboard: sb,
        // A long video started from a plan card belongs to that idea just as
        // much as a single image does. This used to be left off, so choosing
        // "A long video" silently detached the session and the finished reel
        // had no way back to the post it was meant to become.
        planIdeaId: planBrief?.ideaId, brief: planBrief?.brief,
      })
      setBusy('')
      if (madeMulti.error) { setError(madeMulti.error); return }
      const ms = { ...madeMulti.session, storyboard: sb }
      setSessions(prev => [ms, ...prev])
      setSession(ms); setStoryboard(sb); setVersions([])
      setComposers({}); setFocusedBranch(null)
      return
    }

    const created = await createSession(activeWorkspaceId, accessToken, {
      title: finalPrompt.slice(0, 80), intent, aspectRatio: aspect,
      // Set only when the studio was opened from a plan card, so the finished
      // asset can find its way back to the idea it was made for. Undefined on
      // every other path, which writes exactly what it always did.
      planIdeaId: planBrief?.ideaId, brief: planBrief?.brief,
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
      // One row per provider — two candidates, which is what the split view
      // compares. Each lands the moment it's ready; the workflow renders
      // exactly one image per target.
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
          session_id: s.id, version_id: ins.rows[0].id, prompt: videoPrompt,
          model: modelId, duration, aspect_ratio: aspect, resolution, generate_audio: audio,
          // Collected by the frame slots beside the ➕ and, until this pass,
          // thrown away. An absent slot sends '' rather than being omitted, so
          // the workflow's own falsy checks decide the mode.
          image_url: attachments.startFrame?.url || '',
          end_image_url: attachments.endFrame?.url || '',
          // The video tab's reference slot is multi (VIDEO_MENU_SLOTS above),
          // so attachments.reference is an ARRAY here — unlike the image tab's
          // single-value slot of the same id.
          //
          // Sent ONLY to a model that has a reference-to-video endpoint, which
          // is Seedance and nothing else. The workflow would discard them
          // anyway (useRefs requires cfg.r2v), but sending them regardless made
          // the stored request claim inputs the render never used. The composer
          // warns before this point rather than dropping them silently.
          reference_image_urls: modelImageRole(modelId) === 'references'
            ? (attachments.reference || []).map(r => r.url)
            : [],
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

  // ── Multi-clip storyboard ──
  // Every edit writes the WHOLE blob back to creative_sessions.storyboard.
  //
  // This used to fire one PATCH per edit with no coalescing, on the reasoning
  // that losing typed text is worse than an extra write. It lost typed text.
  // Each PATCH carries the entire storyboard, so several in flight at once is
  // not "a few redundant writes" — it is several complete versions of the
  // board racing, and Postgres keeps whichever ARRIVES last, not whichever was
  // issued last. Two shot descriptions were silently discarded that way on
  // 2026-08-12 and were only noticed because the clips rendered with nothing
  // but the style bible in them.
  //
  // Coalescing to one trailing write per burst removes the race outright:
  // there is only ever one PATCH in flight, and it always carries the newest
  // state. The original worry is answered by flushing on session change and on
  // unmount rather than by writing constantly.
  const saveTimer = useRef(null)
  const pendingSave = useRef(null)

  const flushStoryboard = useCallback(() => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
    const p = pendingSave.current
    pendingSave.current = null
    // Pinned to the session it was edited in, so a flush triggered BY a
    // session switch can't write one board's clips onto another's row.
    if (p) saveStoryboard(accessToken, p.sessionId, p.storyboard)
  }, [accessToken])

  const queueSave = useCallback((sessionId, storyboard) => {
    if (!sessionId) return
    pendingSave.current = { sessionId, storyboard }
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      const p = pendingSave.current
      pendingSave.current = null
      if (p) saveStoryboard(accessToken, p.sessionId, p.storyboard)
    }, 600)
  }, [accessToken])

  // Closing the tab mid-edit is the case the immediate write was protecting,
  // and it's the one a debounce could genuinely regress. Flushed here instead.
  useEffect(() => flushStoryboard, [flushStoryboard])

  const patchBoard = useCallback(patch => {
    setStoryboard(prev => {
      if (!prev) return prev
      const next = { ...prev, ...patch }
      // Switching model re-bases every clip's length and quality: each model
      // has its own allowed durations (Kling does 5 or 10 only) and some have
      // no resolution dial at all, so carrying the old values over would send
      // settings the new endpoint rejects.
      if (patch.model && patch.model !== prev.model) {
        const m = getVideoModel(patch.model)
        // Images get re-based along with length and quality, because how many
        // a model can use changes too: Seedance reads up to nine as references,
        // everything else takes exactly one as a start frame. Without this a
        // board built on Seedance and switched to Hailuo keeps nine images per
        // shot, shows "9/1", and quietly renders using only the first.
        const cap = modelImageMax(patch.model)
        next.clips = prev.clips.map(c => ({
          ...c,
          duration: m.durations.includes(c.duration) ? c.duration : m.defaultDuration,
          resolution: m.defaultResolution,
          refs: (c.refs || []).slice(0, cap),
        }))
        if (m.audio === 'unsupported') next.audio = false
      }
      if (session) queueSave(session.id, next)
      return next
    })
  }, [queueSave, session])

  const patchClip = useCallback((index, patch) => {
    setStoryboard(prev => {
      if (!prev) return prev
      const next = { ...prev, clips: prev.clips.map((c, i) => (i === index ? { ...c, ...patch } : c)) }
      if (session) queueSave(session.id, next)
      return next
    })
  }, [queueSave, session])

  const addClip = useCallback(() => {
    // Disarms any finished run first. Without this, adding a shot after a run
    // completed makes the board "not all ready" again and the sequencer would
    // start paying for the new clip the moment it appeared — the storyboard
    // must never spend without someone pressing Render.
    sequencer.stop('')
    setStoryboard(prev => {
      if (!prev || prev.clips.length >= MULTI_CLIP_MAX) return prev
      // A new shot continues from the one before it by default — that's the
      // reason to build a video this way rather than as separate clips.
      const next = { ...prev, clips: [...prev.clips, newClip(prev.model, { continueFromPrevious: true })] }
      if (session) queueSave(session.id, next)
      return next
    })
  }, [queueSave, session, sequencer])

  const removeClip = useCallback(index => {
    setStoryboard(prev => {
      if (!prev || prev.clips.length <= 1) return prev
      const next = { ...prev, clips: prev.clips.filter((_, i) => i !== index) }
      // Clip 1 can never continue from something before it.
      if (next.clips[0]) next.clips[0] = { ...next.clips[0], continueFromPrevious: false }
      if (session) queueSave(session.id, next)
      return next
    })
  }, [queueSave, session])

  // Reordering only ever moves shots that have no take — canMoveClip enforces
  // it and the arrows are disabled otherwise. clip_index is positional and
  // rendered rows are keyed by it, so moving a rendered clip would leave clip
  // 3's footage answering to "clip 2".
  const moveClipTo = useCallback((from, to) => {
    setStoryboard(prev => {
      if (!prev) return prev
      const next = moveClip(prev, from, to)
      if (session) queueSave(session.id, next)
      return next
    })
  }, [queueSave, session])

  // Rendering one shot — a first take, a re-take, or a try again after a
  // failure. All one operation: nextClipAttempt gives a fresh attempt number,
  // so the unique index never collides with the previous try and that try
  // stays in history rather than being overwritten. What differs is only what
  // the button is called.
  // The sequencer writes clip_run_status to the DB; the open session object
  // was read once and would otherwise keep claiming whatever was true then.
  // Mirroring it locally is what keeps the "this run stopped" banner honest
  // in the tab that did the stopping, not just in the one that reopens later.
  const markRun = useCallback(status => {
    setSession(prev => (prev ? { ...prev, clip_run_status: status } : prev))
  }, [])

  const startRun = useCallback(() => { markRun('running'); sequencer.start() }, [markRun, sequencer])
  const stopRun = useCallback(() => { markRun('paused'); sequencer.stop('paused') }, [markRun, sequencer])
  const renderClip = useCallback(index => { markRun(''); sequencer.renderOne(index) }, [markRun, sequencer])
  const cancelClip = useCallback(index => { markRun('paused'); sequencer.cancelClip(index) }, [markRun, sequencer])

  function addStoryboardRef() { setPickerSlot({ id: 'storyboardRef', label: 'Image for every new shot', kind: 'all' }) }
  const removeStoryboardRef = useCallback(i => {
    patchBoard({ sharedRefs: (storyboard?.sharedRefs || []).filter((_, n) => n !== i) })
  }, [patchBoard, storyboard])

  // Images belonging to ONE shot. The picker slot carries the clip index so
  // the result lands on the right card — there is one picker and up to twelve
  // places it can be opened from.
  function addClipRef(index) {
    setPickerSlot({ id: 'clipRef', clipIndex: index, label: `Image for clip ${index + 1}`, kind: 'all' })
  }
  const removeClipRef = useCallback((index, n) => {
    patchClip(index, { refs: (storyboard?.clips?.[index]?.refs || []).filter((_, i) => i !== n) })
  }, [patchClip, storyboard])

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

  // Send under a finished VIDEO edits the footage itself — a genuinely
  // different action from Send under a still, which is why this is its own
  // function rather than a branch bolted onto handleSend's image logic below.
  // No model touches a photo the way Kling O1 Edit touches a clip: the source
  // video goes back in whole, so there's no "editing dropped image instead"
  // concept here — there is nothing else in the request to edit.
  async function handleVideoEdit(branch, instruction, base, refs) {
    if (!canEditVideoDuration(base.duration)) {
      setError(
        `Kling O1 Edit only accepts 3–10s clips — this one is ${base.duration || '?'}s. `
        + 'Use 🔄 Re-render for a fresh take instead.',
      )
      return
    }
    setFocusedBranch(branch.rootId)
    const created = await runStep(branch, {
      label: 'edit',
      row: {
        round: nextRound, kind: 'video', provider: 'seedance', mediaType: 'video',
        parentVersionId: base.id, userPrompt: instruction, aspectRatio: session.aspect_ratio,
        model: 'kling-o1-edit', duration: base.duration || '', resolution: base.resolution || '',
        generateAudio: !!base.generate_audio,
      },
      payload: {
        video_url: base.video_url,
        prompt: instruction,
        reference_image_urls: (refs || []).map(r => r.url),
      },
      send: p => requestVideoEdit(webhooks.creativeVideoEdit, p),
    })
    if (created) {
      patchComposer(branch.rootId, { ...emptyComposer })
      selectVersion(accessToken, session.id, base.id)
    }
  }

  async function handleSend(branch) {
    const { text, baseId, attach, refs } = composerFor(branch)
    const instruction = (text || '').trim()
    const base = branch.versions.find(v => v.id === baseId) || branch.latest
    if (!instruction || !base) return

    if (base.media_type === 'video') return handleVideoEdit(branch, instruction, base, refs)

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

  // The overlay editor hands back THREE images: the flattened composite (the
  // asset, shown everywhere), the text alone on transparency (for later video
  // compositing), and a "clean plate" — photo + adjustments/crop, no text or
  // shapes. All three are stored, but only the clean one is what the NEXT
  // edit session opens against (see overlayState.baseImageUrl below and the
  // PhotoEditor imageUrl prop where it's read back). Reopening against the
  // FLATTENED image instead — which is what this used to do — bakes this
  // round's text into pixels while overlay_state ALSO replays the same
  // layers on top from scratch, so the original text becomes an
  // unselectable, undeletable part of the photo and every further edit
  // looks like it's duplicating on top of it. overlay_state itself still
  // keeps the boxes editable so a typo six versions later isn't a redraw —
  // it just now has a non-destructive image to redraw them onto.
  async function handleOverlaySave({ compositeBlob, textLayerBlob, cleanBlob, state: overlayState }) {
    setSavingOverlay(true)
    const base = await uploadToStudio(activeWorkspaceId, accessToken, compositeBlob, 'overlay.png')
    if (base.error) { setSavingOverlay(false); return { error: base.error } }
    const layer = await uploadToStudio(activeWorkspaceId, accessToken, textLayerBlob, 'textlayer.png')
    const clean = await uploadToStudio(activeWorkspaceId, accessToken, cleanBlob, 'base.png')
    const newOverlayState = { ...overlayState, textLayerUrl: layer.url || '', baseImageUrl: clean.url || '' }

    // The row being edited already IS a manual edit (kind 'overlay') — this
    // isn't the first hand-edit since the last AI generation, it's a further
    // tweak of one, so it overwrites in place rather than minting a new
    // numbered version. Only the FIRST manual edit after an AI-generated (or
    // freshly retried) row creates a new version; every edit after that on
    // the same row replaces it, until AI generation produces a new row again.
    if (editingOverlay.kind === 'overlay') {
      const patch = {
        image_url: base.url, overlay_state: newOverlayState, status: 'ready',
      }
      const upd = await updateVersion(accessToken, editingOverlay.id, patch)
      setSavingOverlay(false)
      if (upd.error) return { error: upd.error }
      setEditingOverlay(null)
      setVersions(prev => prev.map(v => (v.id === editingOverlay.id ? { ...v, ...patch } : v)))
      return {}
    }

    const ins = await insertPendingVersions(activeWorkspaceId, accessToken, session.id, [{
      round: nextRound, kind: 'overlay', provider: 'manual', mediaType: 'image',
      parentVersionId: editingOverlay.id, userPrompt: 'Edited image',
      aspectRatio: session.aspect_ratio, imageUrl: base.url,
      overlayState: newOverlayState,
      status: 'ready',
    }])
    setSavingOverlay(false)
    if (ins.error) return { error: ins.error }
    setEditingOverlay(null)
    setVersions(prev => [...prev, ...ins.rows])
    return {}
  }

  // ── Text and logos on a finished clip ───────────────────────────────────
  // The free half of the studio. Nothing here calls a model: the clip stays
  // exactly as it was rendered and ffmpeg stamps our own layer over it, so a
  // wording, font or colour change costs seconds and nothing else.
  async function openClipEditor(version) {
    if (!version?.video_url) return
    setPreparingClip(version.id); setError('')
    try {
      // The still it was animated from IS frame one, exactly — no decoding, no
      // CORS, no guessing. Only a text-to-video clip, which has no source
      // still, has to have a frame read out of it.
      //
      // A stitched reel is the worst case for that read: it's the biggest file
      // in the session and it has no parent at all. Its opening frame is
      // clip 1's opening frame, so borrow that instead when clip 1 has one.
      const stitchOpener = version.clip_role === 'stitch'
        ? (sequencer.clipRows[0]?.image_url || '')
        : ''
      // A chained storyboard clip carries its own opening frame: image_url is
      // the still it was told to start from, which is frame one by definition.
      // parentStillOf can't find it — a clip's parent is its previous attempt,
      // a video row, which that function correctly refuses to read a still from.
      const chainedOpener = version.clip_index != null && !version.clip_role
        ? (version.image_url || '')
        : ''
      const still = stitchOpener || chainedOpener || parentStillOf(version, versions)
      const frameUrl = still || await captureFirstFrame(version.video_url)
      setEditingClip({ version, frameUrl })
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setPreparingClip('')
    }
  }

  // Mirrors handleOverlaySave, with one invariant that matters more here than
  // it does on images: the composite is ALWAYS built from the original clip.
  //
  // `baseVideoUrl` is the clip as the model rendered it, and re-editing reads
  // that rather than the row's own video_url — which, on a row that has already
  // been composited once, is the version WITH text burnt in. Compositing over
  // that would burn the old wording permanently into the footage while
  // overlay_state replays the same layers on top, so fixing a typo would leave
  // both spellings visible and no way back.
  // ── Stitch the storyboard into one reel ──
  // Explicit, never automatic: the clips are reviewed and re-rendered first,
  // and auto-stitching would burn a pass after every single re-render.
  //
  // Never overwrites a previous stitch either — a marketer comparing hard
  // cuts against a crossfade needs both to still exist, and the version tree
  // is the studio's whole answer to "keep the earlier one".
  async function handleStitch() {
    if (!session || !storyboard) return
    const rows = sequencer.clipRows
    if (rows.some(r => r?.status !== 'ready')) { setError('Every clip has to render before the reel can be assembled.'); return }
    setStitching(true); setError('')

    const clips = rows.map((r, i) => ({
      url: r.video_url,
      // The seam BEFORE this clip; clip 0's is ignored by the workflow.
      transition: i > 0 ? (storyboard.clips[i]?.transition || 'cut') : 'cut',
      transition_duration: storyboard.clips[i]?.transitionDuration ?? 0.5,
    }))

    // The reel's expected runtime is stored on the row up front because the
    // text editor reads `duration` to size its timeline — an empty one would
    // give a 5-second timeline for a two-minute video.
    const totals = storyboardTotals(storyboard)
    const ins = await insertPendingVersions(activeWorkspaceId, accessToken, session.id, [{
      round: nextRound, kind: 'video', provider: 'manual', mediaType: 'video',
      clipRole: 'stitch',
      // Deliberately parentless: it keeps the reel out of every lineage walk
      // (parentStillOf, the lane chain) and the board finds it by clip_role.
      parentVersionId: null,
      userPrompt: `The reel — ${storyboard.clips.length} clips`,
      aspectRatio: session.aspect_ratio || '',
      model: storyboard.model,
      duration: String(Math.round(totals.seconds)),
      resolution: storyboard.clips[0]?.resolution || '',
    }])
    if (ins.error) { setStitching(false); setError(ins.error); return }

    const fired = await requestStitch(webhooks.creativeStitch, {
      session_id: session.id, version_id: ins.rows[0].id, clips,
    })
    setStitching(false)
    setVersions(prev => [...prev, ...ins.rows])
    if (fired.error) {
      setError(fired.error)
      await updateVersion(accessToken, ins.rows[0].id, { status: 'failed', error: fired.error })
      refresh(session.id)
    }
  }

  async function handleComposeSave({ overlays, state: overlayState }) {
    const target = editingClip?.version
    if (!target) return { error: 'No clip to compose onto.' }
    setSavingOverlay(true)

    const sourceVideo = target.overlay_state?.baseVideoUrl || target.video_url
    const uploaded = []
    for (const [i, o] of overlays.entries()) {
      const up = await uploadToStudio(activeWorkspaceId, accessToken, o.blob, `overlay-${i}.png`)
      if (up.error) { setSavingOverlay(false); return { error: up.error } }
      uploaded.push({ url: up.url, tIn: o.tIn, tOut: o.tOut, fade: o.fade })
    }
    const newOverlayState = { ...overlayState, overlays: uploaded, baseVideoUrl: sourceVideo }
    const payload = {
      video_url: sourceVideo,
      overlays: uploaded.map(o => ({ url: o.url, t_in: o.tIn, t_out: o.tOut, fade: o.fade })),
    }

    // Editing a row that is already a composite replaces it in place, exactly
    // as the image path does — it's a further tweak of one manual edit, not a
    // new step in the thread. The row goes back to 'pending' so the existing
    // poller picks up the re-composite.
    if (target.kind === 'overlay' && target.media_type === 'video') {
      const patch = { overlay_state: newOverlayState, status: 'pending', error: '' }
      const upd = await updateVersion(accessToken, target.id, patch)
      if (upd.error) { setSavingOverlay(false); return { error: upd.error } }
      setVersions(prev => prev.map(v => (v.id === target.id ? { ...v, ...patch } : v)))
      const fired = await requestCompose(webhooks.creativeCompose, {
        ...payload, session_id: session.id, version_id: target.id,
      })
      setSavingOverlay(false)
      if (fired.error) {
        await updateVersion(accessToken, target.id, { status: 'failed', error: fired.error })
        refresh(session.id)
        return { error: fired.error }
      }
      setEditingClip(null)
      return {}
    }

    // Text stamped on a STORYBOARD clip has to become that clip's current
    // take, or the reel silently ships without it: handleStitch reads
    // sequencer.clipRows, clipRowsByIndex ignores every row whose clip_index
    // is null, and an overlay row carrying neither would leave the stitcher
    // assembling the original, un-lettered footage with no error anywhere.
    // Same clip_index, next attempt — "the latest take of this shot" is
    // exactly what a composite of it is.
    const clipCols = target.clip_index != null && !target.clip_role
      ? { clipIndex: target.clip_index, clipAttempt: nextClipAttempt(versions, target.clip_index) }
      : {}

    const ins = await insertPendingVersions(activeWorkspaceId, accessToken, session.id, [{
      round: nextRound, kind: 'overlay', provider: 'manual', mediaType: 'video',
      parentVersionId: target.id, userPrompt: 'Text on the clip',
      aspectRatio: session.aspect_ratio, overlayState: newOverlayState,
      duration: target.duration || '', resolution: target.resolution || '',
      model: target.model || '',
      ...clipCols,
    }])
    if (ins.error) { setSavingOverlay(false); return { error: ins.error } }
    const row = ins.rows[0]
    const fired = await requestCompose(webhooks.creativeCompose, {
      ...payload, session_id: session.id, version_id: row.id,
    })
    setSavingOverlay(false)
    setVersions(prev => [...prev, row])
    if (fired.error) {
      await updateVersion(accessToken, row.id, { status: 'failed', error: fired.error })
      refresh(session.id)
      return { error: fired.error }
    }
    setEditingClip(null)
    touchSession(accessToken, session.id)
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
  // Called out separately: without it the whole free half of the video flow —
  // text, logos, colours — silently isn't there, and it's easy to miss because
  // generation itself keeps working.
  const missingCompose = !!webhooks.creativeVideo && !webhooks.creativeCompose
  // Only surfaced on a multi-clip session — everywhere else the stitcher is
  // irrelevant, and a banner about a webhook you don't need is noise.
  const missingStitch = isMulti && !webhooks.creativeStitch

  // What the 📎 mid-conversation picker is actually attaching to — needed
  // because that one picker is shared by every lane, and a still's reference
  // (single, "edit this instead / take cues from it") and a video's
  // reference (multi, style-only) are different shapes on the composer.
  function attachLaneBase() {
    const b = branches.find(x => x.rootId === attachLane)
    if (!b) return null
    const c = composerFor(b)
    return b.versions.find(v => v.id === c.baseId) || b.latest
  }

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
    onEditClip: openClipEditor,
    // What a re-render would cost, shown before the click. The free actions
    // carry no badge at all, which is the whole distinction.
    reRenderCost: v => estimateVideoCost(v.model || 'seedance-2', {
      resolution: v.resolution || '720p', duration: v.duration || '5', audio: !!v.generate_audio,
    }),
    // What asking for a change in the chat box would cost — Kling O1 Edit
    // bills by the SOURCE clip's own duration, not a model/resolution pair,
    // so this is a plain per-second rate rather than reRenderCost's lookup.
    editVideoCost: v => estimateVideoEditCost(v.duration || '5'),
    // Whether that action is even offered — fal's own 3–10s limit on the
    // source clip, checked here so the button can explain itself instead of
    // firing and failing.
    editVideoAllowed: v => canEditVideoDuration(v.duration),
    preparingClip,
    onFinalize: v => handleFinalize(branch, v),
    onUseThis: v => setUseThisFor(v),
    onDownload: handleDownload,
    onRetry: handleRetry,
    onAttach: () => setAttachLane(branch.rootId),
    // Only this lane's versions, so ← → in the viewer walks one candidate's
    // own history rather than interleaving the two models' results.
    onZoom: v => setZoomView({
      versions: branch.versions.filter(x => x.status === 'ready' && (x.image_url || x.video_url)),
      startId: v.id,
    }),
    pendingKey: busy,
  })

  return (
    <div className="p-6 lg:p-8 max-w-[1400px] mx-auto">
      <SectionHead
        title="Creative Studio"
        subtitle="Describe what you want, then keep talking to whichever option is going the right way."
        action={falBalance == null ? null : (
          <span className="text-[11px] text-text-secondary whitespace-nowrap"
            title="Credit left on the fal.ai account, refreshed when this page loads">
            fal credit <span className="font-semibold text-text">${falBalance.toFixed(2)}</span>
          </span>
        )}
      />

      {missingWebhook && (
        <div className="mb-4 border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-xs text-amber-900">
            The Studio's workflows aren't connected yet — add the Creative Studio webhook
            URLs in <span className="font-semibold">Settings → Integrations</span> before generating.
          </p>
        </div>
      )}

      {missingCompose && (
        <div className="mb-4 border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-xs text-amber-900">
            Adding text to a clip needs the <span className="font-semibold">Creative Studio — Compose</span> webhook,
            which isn't set. Video will still generate; you just won't be able to put words on it yet.
          </p>
        </div>
      )}

      {missingStitch && (
        <div className="mb-4 border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-xs text-amber-900">
            Joining the clips into one video needs the <span className="font-semibold">Creative Studio — Stitch</span> webhook,
            which isn't set. The clips will still render; you'd just have to assemble them yourself.
          </p>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-6">
        <SessionSidebar
          sessions={sessions}
          session={session}
          loading={loading}
          onOpen={openSession}
          onNew={newSession}
          onRename={handleRenameSession}
          onDelete={handleDeleteSession}
          autoOpenId={searchParams.get('session')}
        />

        {/* ── Thread / composer ── */}
        <main className="space-y-4 min-w-0 flex-1">
          {error && (
            <div className="border border-red-200 bg-red-50 px-4 py-2.5">
              <p className="text-xs text-red-700">{error}</p>
            </div>
          )}

          {!session && planBrief && (
            <div className="max-w-2xl border border-violet-200 bg-violet-50 px-4 py-2.5">
              <p className="text-[11px] font-semibold text-violet-800">
                From plan: {planBrief.title || 'Untitled idea'}
              </p>
              <p className="text-[11px] text-violet-700 mt-0.5 leading-relaxed">
                {[
                  planBrief.brief?.pillar,
                  planBrief.brief?.occasion,
                  planBrief.brief?.tone,
                  (planBrief.brief?.platforms || []).join(' · '),
                  planBrief.brief?.aspectRatio,
                ].filter(Boolean).join(' — ')}
              </p>
              {planBrief.brief?.cta && (
                <p className="text-[11px] text-violet-700 mt-0.5"><span className="font-semibold">CTA:</span> {planBrief.brief.cta}</p>
              )}
            </div>
          )}

          {!session ? (
            <Card className="p-5 space-y-4 max-w-2xl">
              <div>
                <p className="text-xs font-medium text-text-secondary mb-1.5">What are you making?</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {INTENTS.map(i => (
                    <button key={i.value} onClick={() => changeIntent(i.value)}
                      className={`text-left border p-2.5 transition-all ${
                        intent === i.value ? 'border-amber-500 bg-amber-50 ring-1 ring-amber-300' : 'border-border hover:border-amber-300'
                      }`}>
                      <p className="text-xs font-semibold text-text">{i.label}</p>
                      <p className="text-[10px] text-text-tertiary mt-0.5 leading-snug">{i.hint}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Textarea label="Describe it" rows={4} autoGrow value={prompt}
                  onChange={e => {
                    const v = e.target.value
                    setPrompt(v); setError('')
                    // Their edit makes it theirs again — auto-enhance won't
                    // touch it, and the button warns before overwriting.
                    if (promptSource === 'enhanced') setPromptSource('enhanced_edited')
                    // Typing something new after an Undo means the enhanced
                    // text no longer corresponds to what's on screen — Redo
                    // bringing it back at that point would silently overwrite
                    // words the marketer just wrote, so it stops being offered.
                    else if (promptSource === 'raw' && v !== promptRaw) setPromptEnhanced('')
                  }}
                  placeholder="e.g. A dusk shot of a modern Riyadh villa facade with warm linear lighting, for an Instagram post announcing our new residential range" />

                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    {/* Attach sits with the prompt, the way every chat app puts
                        it — the old reference box lived at the bottom of the
                        form, past the settings, which read as a separate step
                        rather than part of what you're asking for. */}
                    {/* Multi-clip attaches nothing here: its references are
                        shared by every shot, so they live on the storyboard
                        itself rather than on this one opening prompt. */}
                    {intent !== 'multi_video' && (
                      <AttachMenu
                        slots={intent === 'video' ? VIDEO_MENU_SLOTS : IMAGE_SLOTS}
                        taken={intent === 'video'
                          ? { reference: (attachments.reference?.length || 0) >= VIDEO_EDIT_MAX_REFERENCES }
                          : attachments}
                        onChoose={openPickerFor}
                      />
                    )}
                    {intent === 'video' && VIDEO_FRAME_SLOTS.map(s => (
                      <FrameSlot key={s.id} label={s.label} hint={s.hint}
                        value={attachments[s.id]}
                        onPick={() => openPickerFor(s)}
                        onRemove={() => setAttachment(s.id, null)}
                      />
                    ))}
                    {/* Style references only exist on Seedance's
                        reference-to-video endpoint. Every other model here
                        falls through to text-to-video and DISCARDS them —
                        no error, full price, pictures ignored. Said out loud
                        rather than letting someone attach four images to a
                        Kling render and wonder why none of them showed up. */}
                    {intent === 'video' && (attachments.reference?.length || 0) > 0
                      && modelImageRole(modelId) !== 'references' && (
                      <span className="text-[10px] text-amber-700 leading-snug max-w-md">
                        {getVideoModel(modelId).label} can't take style references — it would ignore
                        {(attachments.reference?.length || 0) === 1 ? ' that image' : ' those images'} and
                        still charge for the render. Use Start frame instead, or switch to Seedance.
                      </span>
                    )}
                    <button type="button" onClick={enhancePrompt}
                      disabled={!prompt.trim() || !!enhancing || busy === 'generate'}
                      title={promptSource === 'raw'
                        ? 'Rewrite this into a fuller prompt — nothing generates yet'
                        : 'Rewrite again, replacing the current text'}
                      className="inline-flex items-center gap-1.5 border border-border px-2.5 py-1 text-[11px] font-medium hover:border-amber-400 hover:bg-amber-50 disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-transparent">
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
                    {/* Only after an Undo, and only while the text still matches
                        what Undo left behind (see the textarea's onChange) — the
                        one moment "bring the enhanced version back" is safe to
                        offer without a second webhook call. */}
                    {promptSource === 'raw' && promptEnhanced && (
                      <span className="text-[10px] text-text-tertiary">
                        <button type="button" onClick={redoEnhance}
                          className="underline hover:text-text-secondary">Redo</button>
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

                {activeSlots.some(s => (attachments[s.id]?.length ?? attachments[s.id])) && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                    {activeSlots.filter(s => (attachments[s.id]?.length ?? attachments[s.id])).map(s => (
                      s.multi ? (
                        <MultiRefRow key={s.id} label={s.label} items={attachments[s.id]} max={s.max}
                          onRemove={i => removeAttachmentAt(s.id, i)}
                          onAdd={attachments[s.id].length < s.max ? () => openPickerFor(s) : undefined}
                        />
                      ) : (
                        <AttachmentChip key={s.id}
                          label={s.label}
                          url={attachments[s.id].url}
                          note={attachments[s.id].note}
                          notePlaceholder={s.notePlaceholder}
                          onNote={s.notes ? v => setAttachment(s.id, { ...attachments[s.id], note: v }) : undefined}
                          onRemove={() => setAttachment(s.id, null)}
                        />
                      )
                    ))}
                  </div>
                )}
              </div>

              {/* One image per model, always — the 2-each and 4-each rounds
                  are gone (2026-08-11). Two candidates is the comparison the
                  split view is built around; four or eight was a bigger bill
                  and a longer wait for lanes nobody read. */}
              <div>
                <Select label="Shape" value={aspect} onChange={e => setAspect(e.target.value)}>
                  {RATIOS.map(r => <option key={r} value={r}>{aspectLabel(r)} ({r})</option>)}
                </Select>
                {intent === 'image' && (
                  <p className="text-[11px] text-text-tertiary mt-1.5">
                    Two options — one from each model — so you can compare and keep going with whichever works.
                  </p>
                )}
                {intent === 'multi_video' && (
                  <p className="text-[11px] text-text-tertiary mt-1.5">
                    This becomes the opening shot. You'll add the rest — and pick the model, look and lengths —
                    on the storyboard next. Nothing renders until you say so.
                  </p>
                )}
              </div>

              {/* Text-to-video gets the same controls as the Animate modal —
                  they were only ever in the modal, which meant a video-only
                  session silently rendered at 1080p with no way to pick a
                  move. Plus a look picker, which only makes sense here: with
                  no source still, nothing else decides how the clip looks. */}
              {intent === 'video' && (
                <div className="border border-border bg-surface-subtle p-3 space-y-3">
                  <ModelPicker modelId={modelId} onPick={pickModel} />

                  <LookPicker lookId={lookId} onPick={setLookId} />

                  <MotionPicker
                    label="How should the camera move? (optional)"
                    presetId={motionPresetId}
                    onPickPreset={p => { setMotionPresetId(p ? p.id : ''); setMotionNote(p ? p.prompt : '') }}
                    strength={motionStrength}
                    onStrength={setMotionStrength}
                  />

                  <Textarea rows={2} autoGrow value={motionNote}
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
          ) : openingId === session.id ? (
            <ThreadSkeleton />
          /* Before the branches.length check, not after: a multi-clip session
             starts with a storyboard and ZERO version rows, so the empty state
             below would swallow the board on every new one. */
          ) : isMulti && storyboard ? (
            <ClipBoard
              storyboard={storyboard}
              clipRows={sequencer.clipRows}
              versions={versions}
              states={sequencer.states}
              activeIndex={sequencer.activeIndex}
              running={sequencer.running}
              allReady={sequencer.allReady}
              busy={sequencer.busy}
              stitchRow={stitchRowsOf(versions)[0] || null}
              stitching={stitching}
              preparingClipId={preparingClip}
              runStatus={session.clip_run_status || ''}
              onPatchClip={patchClip}
              onPatchBoard={patchBoard}
              onAddClip={addClip}
              onRemoveClip={removeClip}
              onMoveClip={moveClipTo}
              onStart={startRun}
              onStop={stopRun}
              onRenderClip={renderClip}
              onCancelClip={cancelClip}
              onStitch={handleStitch}
              onAddRef={addStoryboardRef}
              onRemoveRef={removeStoryboardRef}
              onAddClipRef={addClipRef}
              onRemoveClipRef={removeClipRef}
              onOpenClip={openClipEditor}
              onDownloadStitch={handleDownload}
              onUseThis={v => setUseThisFor(v)}
            />
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
                      Click a picture to open it full size. Type in either box to work on that one — it fills the
                      width and the other waits as a chip. Drag an image from one into the other to reuse it there.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </main>
      </div>

      {/* ── Full-screen viewer ── */}
      {zoomView && (
        <Lightbox
          versions={zoomView.versions}
          startId={zoomView.startId}
          onClose={() => setZoomView(null)}
          onDownload={handleDownload}
        />
      )}

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

      {/* ── Attach a reference (pre-generation form) ── */}
      <MediaPicker
        open={!!pickerSlot}
        onClose={() => setPickerSlot(null)}
        title={pickerSlot ? `Add ${pickerSlot.label.toLowerCase()}` : ''}
        kind={pickerSlot?.kind || 'image'}
        accessToken={accessToken}
        onUpload={file => uploadReferenceImage(activeWorkspaceId, accessToken, file)}
        onPick={picked => {
          // The storyboard's shared references live on the session blob, not
          // in `attachments` — they apply to every clip rather than to one
          // pending generation.
          if (pickerSlot.id === 'storyboardRef') {
            const refs = storyboard?.sharedRefs || []
            if (refs.length < 9) patchBoard({ sharedRefs: [...refs, { url: picked.url, name: picked.name || '' }] })
            setPickerSlot(null)
            return
          }
          // Same blob, one clip deeper. The slot carries which clip opened it,
          // because one picker serves up to twelve cards.
          if (pickerSlot.id === 'clipRef') {
            const i = pickerSlot.clipIndex
            const refs = storyboard?.clips?.[i]?.refs || []
            const cap = modelImageMax(storyboard?.model)
            if (refs.length < cap) patchClip(i, { refs: [...refs, { url: picked.url, name: picked.name || '' }] })
            setPickerSlot(null)
            return
          }
          return pickerSlot.multi
            ? addAttachment(pickerSlot.id, picked, pickerSlot.max)
            : setAttachment(pickerSlot.id, picked)
        }}
      />

      {/* ── Attach a reference (a lane's 📎, mid-conversation) ── */}
      <MediaPicker
        open={!!attachLane}
        onClose={() => setAttachLane(null)}
        title={attachLaneBase()?.media_type === 'video' ? 'Add a style reference for this edit' : 'Add a reference for this edit'}
        // A still can only take an IMAGE reference (the edit endpoint has no
        // video input); a video's reference goes to Kling O1 Edit's
        // image_urls, but it too only accepts images — 'all' would let
        // someone pick a clip that the endpoint would then reject.
        kind="image"
        accessToken={accessToken}
        onUpload={file => uploadReferenceImage(activeWorkspaceId, accessToken, file)}
        onPick={picked => {
          const base = attachLaneBase()
          if (base?.media_type === 'video') {
            const c = composerFor(branches.find(b => b.rootId === attachLane))
            const next = [...(c.refs || []), { url: picked.url, name: picked.name || 'reference' }]
              .slice(0, VIDEO_EDIT_MAX_REFERENCES)
            patchComposer(attachLane, { refs: next })
          } else {
            patchComposer(attachLane, { attach: { url: picked.url, label: picked.name || 'your upload', mode: 'reference' } })
          }
          setAttachLane(null)
        }}
      />

      {/* ── Text and logos on a clip ── */}
      {/* The SAME editor as below, in video mode: same fonts, same Arabic
          shaping, same snapping and undo. What differs is the base (frame one
          of the clip, standing in for footage this editor never alters) and the
          save (a brand layer for ffmpeg, not a flattened picture). */}
      <Modal open={!!editingClip} onClose={() => setEditingClip(null)}
        title="Text on this clip — free, no re-render" width="max-w-[96vw]">
        <div className="p-0">
          {editingClip && (
            <PhotoEditor
              mode="video"
              duration={Number(editingClip.version.duration) || 5}
              imageUrl={editingClip.frameUrl}
              initialState={editingClip.version.overlay_state}
              saving={savingOverlay}
              onSave={handleComposeSave}
              onCancel={() => setEditingClip(null)}
              onUploadImage={file => uploadToStudio(activeWorkspaceId, accessToken, file, file.name || 'layer.png')}
              imageLibrary={editorLibrary}
              brandColorsText={state.brandProfile?.brandColors || ''}
            />
          )}
        </div>
      </Modal>

      {/* ── Image editor ── */}
      <Modal open={!!editingOverlay} onClose={() => setEditingOverlay(null)} title="Edit image" width="max-w-[96vw]" >
        <div className="p-0">
          {editingOverlay && (
            <PhotoEditor
              // A row edited before has a non-destructive "clean plate" (photo
              // + adjustments/crop, no text/shapes) saved at overlay_state.
              // baseImageUrl — reopen against THAT, not the flattened
              // image_url, or previously-added text becomes baked-in pixels
              // that overlay_state's replayed layers just duplicate on top of.
              // A row with no overlay_state yet (never edited before) has no
              // such field, so image_url — the plain original — is correct.
              imageUrl={editingOverlay.overlay_state?.baseImageUrl || editingOverlay.image_url}
              initialState={editingOverlay.overlay_state}
              saving={savingOverlay}
              onSave={handleOverlaySave}
              onCancel={() => setEditingOverlay(null)}
              // Image layers need somewhere permanent to live: an object URL
              // would die with the tab and a data URL would bloat the JSONB
              // overlay_state row, so an added image is uploaded to the
              // studio bucket first and the layer stores that URL.
              onUploadImage={file => uploadToStudio(activeWorkspaceId, accessToken, file, file.name || 'layer.png')}
              imageLibrary={editorLibrary}
              // Brand Brain's "Brand Colours" field, so the account's own
              // palette is a click away in every colour picker rather than
              // something a marketer has to retype as a hex each time.
              brandColorsText={state.brandProfile?.brandColors || ''}
            />
          )}
        </div>
      </Modal>

      {/* Turns the version on screen into real posts. Everything it needs is
          passed in — it owns no studio state, so closing it leaves the thread
          exactly as it was. */}
      <UseThisSheet
        open={!!useThisFor}
        onClose={() => setUseThisFor(null)}
        version={useThisFor}
        session={session}
        workspaceId={activeWorkspaceId}
        accessToken={accessToken}
        webhooks={webhooks}
        brandProfile={state.brandProfile}
        // Sending marks the asset final, which is what Save does — so the
        // thread's badges stay honest without a refetch.
        onSent={() => { if (useThisFor) refresh(session?.id) }}
      />
    </div>
  )
}
