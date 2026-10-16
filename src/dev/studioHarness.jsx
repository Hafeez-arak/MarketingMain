import { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { BranchChat } from '../components/studio/BranchChat'
import { ClipBoard } from '../components/studio/ClipBoard'
import { canUpscale, estimateUpscaleCost, upscaleSourceTier, UPSCALE_MODEL_ID } from '../components/studio/videoModels'
import '../index.css'

// ─── Dev-only studio harness ───────────────────────────────────────────────
// Shows the "Make 1080p" button without signing in and without a paid call.
// Every row here is fake: a lane holding a still and a 480p clip, and a
// two-clip storyboard whose first clip is 480p and second already 1080p.
// Clicking Make 1080p adds a pending row and "finishes" it after a few
// seconds; nothing leaves the browser. Served by Vite at /dev/studio.html, never built.

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
// show. Stands in for a 480p Seedance render.
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

function videoRow(id, url, over = {}) {
  return {
    id, status: 'ready', kind: 'video', media_type: 'video', provider: 'seedance',
    model: 'seedance-2.5', resolution: '480p', duration: '20', video_url: url,
    user_prompt: 'Slow push in on the pendant, light breathing', created_at: iso(now - 60000),
    ...over,
  }
}

export function StudioHarness() {
  const [clips, setClips] = useState(null)
  const [laneRows, setLaneRows] = useState([])
  const [boardRows, setBoardRows] = useState([])
  const [log, setLog] = useState([])
  const say = m => setLog(l => [`${new Date().toLocaleTimeString()} · ${m}`, ...l])

  useEffect(() => {
    Promise.all([recordClip('Draft · 480p'), recordClip('Clip 2 · 1080p'), recordClip('Made 1080p')])
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
          videoRow('c2', other, { clip_index: 1, clip_attempt: 0, resolution: '1080p', duration: '10' }),
        ])
      })
  }, [])

  // What the real handlers do, minus the money: a pending upscale row, then
  // ready at 1080p. The new row is 1080p, so the button disappears from it.
  function upscale(setRows, base, extra) {
    const id = `up-${Date.now()}`
    say(`Make 1080p clicked — would send this ${upscaleSourceTier(base)} clip to Topaz ($${estimateUpscaleCost(base.duration).toFixed(2)})`)
    setRows(r => [...r, { ...base, ...extra, id, status: 'pending', model: UPSCALE_MODEL_ID, resolution: '1080p',
      parent_version_id: base.id, created_at: iso(Date.now()) }])
    setTimeout(() => {
      setRows(r => r.map(v => (v.id === id ? { ...v, status: 'ready', video_url: clips.finished } : v)))
      say('Done (simulated) — the same clip, now 1080p')
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
        <b>Preview only — fake data, nothing is charged.</b> Look for the Make 1080p button under the
        480p video, and on clip 1 of the storyboard (clip 2 is already 1080p, so it has none).
        Click it to see what happens; the 1080p version arrives after ~3 seconds.
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold">1 · A lane (single video)</h2>
        <div>
          <BranchChat
            branch={branch} composer={{ baseId: laneStage.id }} split={false} focused busy=""
            onChange={noop} onSend={noop} onActivate={noop} onAnimate={noop}
            onReRender={v => say(`Re-render clicked on ${v.id} (would roll new footage)`)}
            onEditClip={noop}
            reRenderCost={() => 4.41}
            editVideoCost={() => 3.36} editVideoAllowed={() => false}
            onUpscale={v => upscale(setLaneRows, v, {})}
            upscaleCost={v => (canUpscale(v) ? estimateUpscaleCost(v.duration) : null)}
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
          onUpscaleClip={i => upscale(setBoardRows, clipRows[i],
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

ReactDOM.createRoot(document.getElementById('root')).render(<StudioHarness />)
