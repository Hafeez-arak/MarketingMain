import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  insertPendingVersions, requestCancel, requestVideo, updateVersion, uploadToStudio,
} from '../../lib/creativeStudio'
import {
  chainsFrom, clipImagePlan, clipPromptFor, clipRowsByIndex, clipState, nextClipAttempt,
  setRunStatus,
} from '../../lib/creativeStoryboard'
import { captureLastFrameBlob } from './videoFrame'

// ─── The multi-clip render run ─────────────────────────────────────────────
// Renders a storyboard one clip at a time, from the browser, because that is
// how every other generation in this app works: insert the pending row, fire
// the webhook, let the 4s poller bring the answer back. There is no server-
// side orchestrator to hand a whole storyboard to.
//
// One at a time rather than all at once for two reasons, and only one of them
// is continuity:
//
//  · A chained clip needs the PREVIOUS clip's last frame, which does not
//    exist until that clip has rendered.
//  · A storyboard is the most expensive button in this app — eight 20s clips
//    on Seedance 2.5 @720p is $75.68. Sequential means a failure stops the
//    run instead of paying for seven more shots that continue from a clip
//    that never arrived.
//
// ── What stops a clip being paid for twice ────────────────────────────────
// NOT the `lock` ref below. That ref only stops this tab's own effect from
// re-entering; it cannot see a second tab, and a `refresh()` whose fetch
// started before an insert landed can briefly erase the optimistic row and
// make the effect think the clip is still missing.
//
// The real guarantee is the partial unique index on
// (session_id, clip_index, clip_attempt). Two racers both try to insert clip
// 4 attempt 0; one wins, the other gets 23505 and backs off. No lease, no
// clock skew, no TTL, and nothing a crashed tab can wedge.
//
// ── Why "running" is derived rather than stored ───────────────────────────
// A run ends when there is nothing left to render or when something failed —
// both of which are facts about the rows, not extra state to keep in sync
// with them. Storing a `running` boolean meant an effect that watched the
// rows and flipped it, which is a cascading render and, worse, a second
// source of truth that could disagree with the board. So the only thing
// stored is which session the human ARMED, and everything else is read off
// the rows.

// PostgREST surfaces the Postgres SQLSTATE in the response body it hands back
// through insertPendingVersions' `{ error }`.
const UNIQUE_VIOLATION = '23505'

export function useClipSequencer({
  session, versions, storyboard, webhooks, workspaceId, accessToken,
  onVersions, onError, refresh,
}) {
  // The session the human pressed Render on. Set and cleared only from event
  // handlers — never from an effect.
  const [armedFor, setArmedFor] = useState(null)
  // Bumped whenever a run is armed or disarmed. Every await inside fireClip
  // re-checks it, so a Stop pressed during a slow frame upload cannot land a
  // render afterwards.
  const runId = useRef(0)
  const lock = useRef({ sessionId: null, clipIndex: null })

  const clips = useMemo(() => storyboard?.clips || [], [storyboard])

  const clipRows = useMemo(
    () => clipRowsByIndex(versions, clips.length),
    [versions, clips.length],
  )
  const states = useMemo(() => clipRows.map(clipState), [clipRows])

  const allReady = clips.length > 0 && states.every(st => st === 'ready')
  // Fail fast. Clip N+1 continues from clip N, so carrying on past a failure
  // would pay for a shot chained to something that isn't there.
  const anyFailed = states.some(st => st === 'failed')
  const armed = !!session && armedFor === session.id
  const running = armed && !allReady && !anyFailed

  // Mutable reads for things fireClip needs but must not re-subscribe to.
  // Written in an effect rather than during render — declared FIRST so it is
  // committed before the driver effect below reads it.
  const ctx = useRef({})
  useEffect(() => {
    ctx.current = {
      session, versions, storyboard, webhooks, workspaceId, accessToken,
      clipRows, onVersions, onError, refresh,
    }
  })

  const stop = useCallback((status = '') => {
    runId.current += 1
    lock.current = { sessionId: null, clipIndex: null }
    setArmedFor(null)
    const s = ctx.current.session
    if (s) setRunStatus(ctx.current.accessToken, s.id, status)
  }, [])

  const start = useCallback(() => {
    runId.current += 1
    lock.current = { sessionId: null, clipIndex: null }
    const s = ctx.current.session
    if (!s) return
    setArmedFor(s.id)
    setRunStatus(ctx.current.accessToken, s.id, 'running')
  }, [])

  // Records how the run ended, for the "this run stopped" banner on reopen.
  // A write, not a state change — the run is already over by derivation.
  useEffect(() => {
    if (!armed || !session) return
    if (allReady) setRunStatus(accessToken, session.id, 'done')
    else if (anyFailed) setRunStatus(accessToken, session.id, 'paused')
  }, [armed, allReady, anyFailed, session, accessToken])

  const fireClip = useCallback(async (index, token) => {
    const {
      session: s, storyboard: sb, webhooks: hooks, workspaceId: ws, accessToken: tok,
      versions: vs, clipRows: rows,
    } = ctx.current
    if (!s || !sb) return

    // Re-checked after every await. `token` catches a Stop; the session id is
    // pinned to the one this call started against, so switching sessions
    // mid-upload can't land a render on whatever is open now.
    const startedOn = s.id
    const alive = () => token === runId.current && ctx.current.session?.id === startedOn

    // ── The chained start frame ──
    // Only when this seam is marked to continue. An unchained clip gets its
    // images from clipImagePlan instead — references on Seedance, a start
    // frame on every other model — and clip 0 never chains.
    const plan = clipImagePlan(sb, index)
    let startUrl = plan.startFrom
    if (chainsFrom(sb, index)) {
      const prev = rows[index - 1]
      if (!prev?.video_url) {
        ctx.current.onError(`Clip ${index} hasn't finished rendering, so clip ${index + 1} has no frame to continue from.`)
        stop('paused')
        return
      }
      // The frame is read from the clip as the MODEL rendered it, never from a
      // composite of it. Once text has been stamped on clip N, its video_url is
      // the lettered version — handing that frame forward would ask the model to
      // continue a shot with our own headline burnt into it, and it would try.
      const prevSource = prev.overlay_state?.baseVideoUrl || prev.video_url
      try {
        const blob = await captureLastFrameBlob(prevSource)
        if (!alive()) return
        const up = await uploadToStudio(ws, tok, blob, `clip${index}-tail.png`)
        if (!alive()) return
        if (up.error) throw new Error(up.error)
        startUrl = up.url
      } catch (err) {
        // Deliberately NOT falling back to a hard cut. Continuing without the
        // frame silently produces a different — and paid for — shot than the
        // one that was asked for.
        ctx.current.onError(
          `Couldn't read the last frame of clip ${index} (${err.message}). ` +
          'Switch that seam to a new shot, or try again.',
        )
        stop('paused')
        return
      }
    }

    // ── The row ──
    const clip = sb.clips[index]
    const attempt = nextClipAttempt(vs, index)
    const prevAttempt = (vs || [])
      .filter(v => v.clip_index === index && !v.clip_role)
      .sort((a, b) => (b.clip_attempt ?? 0) - (a.clip_attempt ?? 0))[0]
    const prompt = clipPromptFor(sb, index)

    const ins = await insertPendingVersions(ws, tok, s.id, [{
      round: 0,
      kind: 'video',
      // The DB check constraint only allows a fixed provider list; which model
      // actually rendered it lives in `model`, same as the single-clip path.
      provider: 'seedance',
      mediaType: 'video',
      clipIndex: index,
      clipAttempt: attempt,
      // Supersedes the previous try at THIS clip. Not the previous clip —
      // parent_version_id means "replaces that row" everywhere in this schema,
      // and buildBranches derives whole chat lanes from it.
      parentVersionId: prevAttempt?.id || null,
      imageUrl: startUrl,
      userPrompt: prompt,
      model: sb.model,
      duration: clip.duration,
      resolution: clip.resolution,
      generateAudio: !!sb.audio,
      aspectRatio: s.aspect_ratio || '',
    }])
    if (!alive()) return

    if (ins.error) {
      if (String(ins.error).includes(UNIQUE_VIOLATION)) {
        // Another tab is already rendering this exact clip. Nothing was spent
        // here; pull its row in and let the driver carry on from that.
        ctx.current.refresh(s.id)
        return
      }
      ctx.current.onError(ins.error)
      stop('paused')
      return
    }

    ctx.current.onVersions(ins.rows)

    // ── The render ──
    // clipImagePlan owns the three-way choice (chained start frame / Seedance
    // references / a start image on models that have no reference endpoint),
    // including the rule that reference_image_urls and image_url are MUTUALLY
    // EXCLUSIVE — Seedance's build() early-returns on references and never
    // reads image_url, so sending both silently discards the start frame.
    const fired = await requestVideo(hooks.creativeVideo, {
      session_id: s.id,
      version_id: ins.rows[0].id,
      prompt,
      model: sb.model,
      duration: clip.duration,
      aspect_ratio: s.aspect_ratio || '',
      resolution: clip.resolution,
      generate_audio: !!sb.audio,
      image_url: startUrl,
      end_image_url: '',
      reference_image_urls: plan.refs,
    })

    if (fired.error) {
      ctx.current.onError(fired.error)
      // The row exists but nothing will ever fill it — say so on the card
      // rather than leaving a spinner running forever.
      await updateVersion(tok, ins.rows[0].id, { status: 'failed', error: fired.error })
      ctx.current.refresh(s.id)
      stop('paused')
    }
  }, [stop])

  // Renders exactly ONE clip and stops there — a first take, a re-take, or a
  // retry after a failure. It fires directly rather than arming the board, and
  // that is the whole point: arming means the driver walks on into every
  // following clip, and someone who asked for one shot has not agreed to pay
  // for the rest of the storyboard. Continuing the board is the
  // Render-the-remaining button's job, and that button quotes its own price.
  const renderOne = useCallback(index => {
    const s = ctx.current.session
    if (!s) return
    runId.current += 1
    lock.current = { sessionId: s.id, clipIndex: index }
    setArmedFor(null)
    setRunStatus(ctx.current.accessToken, s.id, '')
    void fireClip(index, runId.current)
  }, [fireClip])

  // ── Cancelling a clip fal is already working on ──
  // Two separate things, and only one of them is guaranteed. Marking the row
  // failed locally is what frees the board. Asking fal to drop the job is what
  // MIGHT save the money — fal can only cancel while the request is still
  // IN_QUEUE, so a job already running is billed whatever we do. The UI says
  // that rather than implying a refund.
  //
  // Disarms first: a cancelled clip reads as "not ready", and an armed driver
  // would take that as its cue to pay for it all over again.
  const cancelClip = useCallback(async index => {
    const { session: s, clipRows: rows, webhooks: hooks, accessToken: tok } = ctx.current
    const row = rows?.[index]
    if (!s || !row || row.status !== 'pending') return
    runId.current += 1
    lock.current = { sessionId: null, clipIndex: null }
    setArmedFor(null)
    setRunStatus(tok, s.id, 'paused')

    await updateVersion(tok, row.id, {
      status: 'failed',
      error: "Cancelled. If fal had already started it, it's still charged.",
    })
    ctx.current.refresh(s.id)
    const res = await requestCancel(hooks.creativeCancel, { session_id: s.id, version_id: row.id })
    if (res.error) ctx.current.onError(res.error)
  }, [])

  // ── The driver ──
  // Fires the next clip and nothing else. It never ends the run: `running`
  // going false is what ending the run IS.
  useEffect(() => {
    if (!running || !session) return

    const i = states.findIndex(st => st !== 'ready')
    // Nothing to do but wait — the poller owns this transition.
    if (i === -1 || states[i] === 'pending') return

    if (lock.current.sessionId === session.id && lock.current.clipIndex === i) return
    lock.current = { sessionId: session.id, clipIndex: i }
    // NOT cleared on success: it stays pointed at `i` until the driver
    // advances to i+1 and overwrites it. Clearing it early reopens the window
    // where a mid-flight refresh makes this clip look un-started again.
    void fireClip(i, runId.current)
  }, [running, session, states, fireClip])

  const anyPending = states.some(st => st === 'pending')

  return {
    running,
    start,
    stop,
    renderOne,
    cancelClip,
    clipRows,
    states,
    allReady,
    // What the storyboard highlights as "working on this one". A solo render
    // isn't a run, so it highlights the pending clip directly rather than
    // "the first one that isn't finished".
    activeIndex: running
      ? states.findIndex(st => st !== 'ready')
      : states.findIndex(st => st === 'pending'),
    anyPending,
    // True while ANY clip is in flight, armed run or not. Gates every other
    // render control so two clips can never be paid for at once.
    busy: running || anyPending,
  }
}
