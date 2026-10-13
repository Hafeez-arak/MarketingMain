import { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { BranchChat } from '../components/studio/BranchChat'
import { ClipBoard } from '../components/studio/ClipBoard'
import { draftOf, estimateFinishCost } from '../components/studio/videoModels'
import '../index.css'

// ─── Dev-only studio harness ───────────────────────────────────────────────
// Shows the "✦ Finish in 1080p" button without signing in and without a paid
// render. Every row here is fake: a lane holding a still and a Seedance 2.5
// draft, and a two-clip storyboard whose first clip is a draft. Clicking
// Finish adds a pending row and "finishes" it after a few seconds; nothing
// leaves the browser. Served by Vite at /dev-studio.html, never built.

function still(label) {
  const c = document.createElement('canvas')
  c.width = 800; c.height = 1000
  const ctx = c.getContext('2d')
  const g = ctx.createLinearGradient(0, 0, 800, 1000)
  g.addColorStop(0, '#3b2f1d'); g.addColorStop(0.5, '#c8a24a'); g.addColorStop(1, '#1a1410')
  ctx.fillStyle = g; ctx.fillRect(0, 0, 800, 1000)
  ctx.fillStyle = '#fff'; ctx.font = 'bold 48px sans-serif'; ctx.fillText(label, 40, 90)
  return c.toDataURL('image/png')
}

// A two-second clip recorded from a canvas, so the lane has a real video to
// show. Stands in for a 480p Seedance draft.
function recordClip(label) {
  return new Promise(resolve => {
    const c = document.createElement('canvas')
    c.width = 480; c.height = 600
    const ctx = c.getContext('2d')
    const rec = new MediaRecorder(c.captureStream(24), { mimeType: 'video/webm' })
    const chunks = []
    rec.ondataavailable = e => chunks.push(e.data)
    rec.onstop = () => resolve(URL.createObjectURL(new Blob(chunks, { type: 'video/webm' })))
    let f = 0
    const tick = setInterval(() => {
      ctx.fillStyle = '#1a1410'; ctx.fillRect(0, 0, 480, 600)
      ctx.fillStyle = '#f5e6b8'
      ctx.beginPath(); ctx.arc(240, 300 + Math.sin(f / 6) * 80, 60, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#fff'; ctx.font = 'bold 28px sans-serif'; ctx.fillText(label, 20, 40)
      f++
    }, 1000 / 24)
    rec.start()
    setTimeout(() => { clearInterval(tick); rec.stop() }, 2000)
  })
}

const now = Date.now()
const iso = ms => new Date(ms).toISOString()
const DRAFT_STATE = { draft: { id: 'fake-draft', expiresAt: iso(now + 6 * 86400000) } }

function videoRow(id, url, over = {}) {
  return {
    id, status: 'ready', kind: 'video', media_type: 'video', provider: 'seedance',
    model: 'seedance-2.5', resolution: '480p', duration: '20', video_url: url,
    user_prompt: 'Slow push in on the pendant, light breathing', created_at: iso(now - 60000),
    overlay_state: DRAFT_STATE, ...over,
  }
}

function Harness() {
  const [clips, setClips] = useState(null)
  const [laneRows, setLaneRows] = useState([])
  const [boardRows, setBoardRows] = useState([])
  const [log, setLog] = useState([])
  const say = m => setLog(l => [`${new Date().toLocaleTimeString()} · ${m}`, ...l])

  useEffect(() => {
    Promise.all([recordClip('Draft · 480p'), recordClip('Clip 2 · 720p'), recordClip('Finished · 1080p')])
      .then(([draft, other, finished]) => {
        setClips({ draft, other, finished })
        const img = still('Gemini still')
        setLaneRows([
          { id: 'img', status: 'ready', kind: 'generate', media_type: 'image', provider: 'gemini',
            image_url: img, round: 0, created_at: iso(now - 120000) },
          videoRow('vid', draft, { parent_version_id: 'img', round: 1 }),
        ])
        setBoardRows([
          videoRow('c1', draft, { clip_index: 0, clip_attempt: 0 }),
          videoRow('c2', other, { clip_index: 1, clip_attempt: 0, resolution: '720p', overlay_state: null, duration: '10' }),
        ])
      })
  }, [])

  // What the real handlers do, minus the money: a pending finish row, then
  // ready at 1080p. The finished row carries finishOf and no draft, so the
  // button correctly disappears from it.
  function finish(rows, setRows, base, extra) {
    const id = `fin-${Date.now()}`
    say(`Finish in 1080p clicked — would send draft_id "${draftOf(base).id}" to fal ($${estimateFinishCost(base.duration).toFixed(2)})`)
    setRows(r => [...r, { ...base, ...extra, id, status: 'pending', resolution: '1080p', parent_version_id: base.id,
      overlay_state: { finishOf: { draftId: draftOf(base).id } }, created_at: iso(Date.now()) }])
    setTimeout(() => {
      setRows(r => r.map(v => (v.id === id ? { ...v, status: 'ready', video_url: clips.finished } : v)))
      say('Finished (simulated) — same take, now 1080p')
    }, 3000)
  }

  if (!clips) return <p className="p-6 text-sm">Recording fake clips…</p>

  const branch = {
    rootId: 'img', root: laneRows[0], provider: 'gemini', variantIndex: 0, versions: laneRows,
    latest: laneRows[0], pending: laneRows.some(v => v.status === 'pending'),
  }
  const laneStage = laneRows[laneRows.length - 1]
  const storyboard = {
    model: 'seedance-2.5', audio: false, sharedRefs: [],
    clips: [
      { key: 'k1', prompt: 'Lobby, slow push in', duration: '20', resolution: '480p', continueFromPrevious: false, refs: [] },
      { key: 'k2', prompt: 'Facade at dusk', duration: '10', resolution: '480p', continueFromPrevious: true, refs: [] },
    ],
  }
  const latestOf = i => boardRows.filter(r => r.clip_index === i).sort((a, b) => b.clip_attempt - a.clip_attempt)[0]
  const clipRows = [latestOf(0), latestOf(1)]
  const states = clipRows.map(r => r?.status || 'idle')
  const noop = () => {}

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
        <b>Preview only — fake data, nothing is charged.</b> Look for <b>✦ Finish in 1080p</b> under the lane's
        draft video, and on clip 1 of the storyboard (clip 2 is not a draft, so it has no button).
        Click it to see what happens; the finished take arrives after ~3 seconds.
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold">1 · A lane (single video)</h2>
        <div className="h-[640px]">
          <BranchChat
            branch={branch} composer={{ baseId: laneStage.id }} split={false} focused busy=""
            onChange={noop} onSend={noop} onActivate={noop} onAnimate={noop}
            onReRender={v => say(`Re-render clicked on ${v.id} (would roll new footage)`)}
            onEditClip={noop}
            reRenderCost={() => 4.41}
            editVideoCost={() => 3.36} editVideoAllowed={() => false}
            onFinishDraft={v => finish(laneRows, setLaneRows, v, {})}
            finishDraftCost={v => (draftOf(v) ? estimateFinishCost(v.duration) : null)}
            onOpenEditor={noop} onFinalize={noop} onUseThis={noop} onDownload={noop}
            onRetry={noop} onDelete={noop} onAttach={noop} onZoom={noop}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">2 · A multi-clip storyboard</h2>
        <ClipBoard
          storyboard={storyboard} clipRows={clipRows} versions={boardRows} states={states}
          activeIndex={-1} running={false} allReady={states.every(s => s === 'ready')}
          busy={states.some(s => s === 'pending')} stitchRow={null} stitching={false}
          preparingClipId="" runStatus=""
          onPatchClip={noop} onPatchBoard={noop} onAddClip={noop} onRemoveClip={noop} onMoveClip={noop}
          onStart={noop} onStop={noop} onRenderClip={i => say(`Render clip ${i + 1}`)}
          onFinishClip={i => finish(boardRows, setBoardRows, clipRows[i],
            { clip_index: i, clip_attempt: (clipRows[i].clip_attempt || 0) + 1 })}
          onCancelClip={noop} onStitch={noop}
          onAddRef={noop} onRemoveRef={noop} onAddClipRef={noop} onRemoveClipRef={noop}
          onOpenClip={noop} onDownloadStitch={noop} onUseThis={noop}
        />
      </section>

      <section>
        <h2 className="mb-1 text-sm font-semibold">What would have been sent</h2>
        <pre className="bg-stone-100 p-2 text-[11px]">{log.join('\n') || '(nothing clicked yet)'}</pre>
      </section>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<Harness />)
