import { useState } from 'react'
import ReactDOM from 'react-dom/client'
import { PhotoEditor } from '../components/studio/editor/index'
import { ReelTimeline } from '../components/studio/ReelTimeline'
import '../index.css'

// ─── Dev-only editor harness ───────────────────────────────────────────────
// Mounts the studio image editor on a generated test photo, so the whole thing
// can be driven in a browser without signing in — the app itself is behind
// auth, and the editor is the one part of it with enough geometry and enough
// canvas work to be worth exercising directly.
//
// Served by Vite at /dev-editor.html. Vite only builds index.html, so this
// never reaches a production bundle.

function testPhoto(w = 1600, h = 2000) {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d')
  const g = ctx.createLinearGradient(0, 0, w, h)
  g.addColorStop(0, '#3b2f1d'); g.addColorStop(0.5, '#c8a24a'); g.addColorStop(1, '#1a1410')
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)
  // Horizontal banding, so a rotation or a flip is unmistakable on screen.
  ctx.fillStyle = 'rgba(255,255,255,0.15)'
  for (let i = 0; i < 12; i++) ctx.fillRect(0, i * (h / 12), w, 6)
  return c.toDataURL('image/png')
}

// Built once at module scope rather than in an effect: it depends on nothing,
// and generating it into state on mount is a cascading render for no reason.
const TEST_PHOTO = testPhoto()

// `/dev-editor.html?mode=video&duration=8` drives the video variant, where the
// photo stands in for frame one of a clip. Worth having as a switch rather than
// a second harness: the point of video mode is that it IS the same editor, and
// flipping between the two in one page is how you notice if that stops being
// true. Save reports what the export produced instead of uploading it.
const params = new URLSearchParams(window.location.search)
const MODE = params.get('mode') === 'video' ? 'video' : 'photo'
const DURATION = Number(params.get('duration')) || 8

// Real footage under the layers. The fixture is deliberately 1280×720 against
// a 1600×2000 still, i.e. 16:9 footage under a 4:5 document — which is the
// ordinary case in production (a 4:5 session renders 3:4 on Seedance and 9:16
// on Veo) and the only way to see whether the preview applies the compose
// step's centre-crop or quietly shows a frame the render will never produce.
//
// Not committed; regenerate with the ffmpeg already inside the n8n container:
//   docker exec arak-marketing-n8n sh -c 'ffmpeg -y \
//     -f lavfi -i "testsrc2=size=1280x720:rate=25:duration=8" \
//     -f lavfi -i "sine=frequency=440:duration=8" \
//     -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest /tmp/dev-clip.mp4'
//   docker cp arak-marketing-n8n:/tmp/dev-clip.mp4 public/dev-clip.mp4
//
// `?clip=` overrides it; `?clip=none` goes back to the still-only behaviour
// this mode had before playback existed.
const CLIP_PARAM = params.get('clip')
const CLIP = CLIP_PARAM === 'none' ? '' : (CLIP_PARAM || '/dev-clip.mp4')

// `?arabic=1` seeds a bilingual document instead of an empty one. Reproducible
// on purpose: the Arabic headline is the thing most worth re-checking after any
// change to text rasterising or the video export, and clicking it in by hand
// each time invites a slightly different test every time. RTL + a Latin subline
// on a DIFFERENT timing, so one load exercises shaping, bidi and the
// per-timing-group split at once.
const ARABIC_FIXTURE = {
  crop: { x: 0, y: 0, w: 1, h: 1 },
  adjust: null,
  layers: [
    // x/y are the box's TOP-LEFT, not its centre (see overlayModel.newTextBox) —
    // 0.5 here would start the box mid-frame and run it off the right edge.
    {
      id: 'ar1', type: 'text', text: 'نضيء تفاصيل المكان', dir: 'rtl', dirTouched: true,
      family: 'Cairo', weight: 900, size: 0.075, color: '#ffffff', align: 'center',
      x: 0.07, y: 0.10, w: 0.86, lineHeight: 1.25, tracking: 0, anchor: 'top',
      italic: false, underline: false, strike: false, uppercase: false,
      shadow: true, effect: 'none', effectColor: '#000000', effectIntensity: 50,
      rotation: 0, opacity: 1, visible: true, locked: false,
    },
    {
      id: 'en1', type: 'text', text: 'We light the details', dir: 'ltr',
      family: 'DM Sans', weight: 400, size: 0.038, color: '#f5e6c8', align: 'center',
      x: 0.07, y: 0.22, w: 0.86, lineHeight: 1.25, tracking: 0.02, anchor: 'top',
      italic: false, underline: false, strike: false, uppercase: false,
      shadow: true, effect: 'none', effectColor: '#000000', effectIntensity: 50,
      rotation: 0, opacity: 1, visible: true, locked: false,
      tIn: 2, tOut: 6, fade: 0.5,
    },
  ],
}
const INITIAL = params.get('arabic') === '1' ? ARABIC_FIXTURE : null

// `/dev-editor.html?reel=1` mounts the multi-clip reel timeline instead, on two
// fixture clips of different lengths. Same reason as the video switch above:
// the reel surface has real playback logic in it — two elements alternating
// across a seam, trims that change the cut — and none of it is reachable from
// the app without signing in and paying for three renders first.
const REEL = params.get('reel') === '1'

const REEL_STORYBOARD = {
  clips: [
    { key: 'r1', prompt: 'Lobby, slow push in', duration: 8, transition: 'cut', trim: { start: 0, end: null } },
    { key: 'r2', prompt: 'Facade at dusk', duration: 6, transition: 'crossfade', transitionDuration: 0.6, trim: { start: 0, end: null } },
  ],
}
const REEL_ROWS = [
  { id: 'a', status: 'ready', video_url: '/dev-clip.mp4' },
  { id: 'b', status: 'ready', video_url: '/dev-clip2.mp4' },
]

function ReelHarness() {
  const [sb, setSb] = useState(REEL_STORYBOARD)
  const patch = (i, p) => setSb(s => ({ ...s, clips: s.clips.map((c, n) => (n === i ? { ...c, ...p } : c)) }))
  return (
    <div className="max-w-3xl p-4">
      <p className="mb-2 text-xs text-emerald-800">
        Reel timeline · two fixture clips (8s + 6s). Drag a block’s ends to trim; play to watch the
        cut. Trims are echoed below as they would be sent to the stitcher.
      </p>
      <ReelTimeline storyboard={sb} clipRows={REEL_ROWS} onPatchClip={patch} />
      <pre className="mt-3 overflow-x-auto bg-stone-100 p-2 text-[10px]">
        {JSON.stringify(sb.clips.map(c => ({ prompt: c.prompt, trim: c.trim })), null, 1)}
      </pre>
    </div>
  )
}

export function EditorHarness() {
  if (REEL) return <ReelHarness />
  return (
    <div className="p-4">
      {MODE === 'video' && (
        <p className="mb-2 text-xs text-emerald-800">
          Video mode · {DURATION}s clip{CLIP ? ` · playing ${CLIP}` : ' · still only'} — Adjust and
          Crop are hidden, and Save reports the overlay groups rather than a flattened image.
          Switch with <code>?mode=photo</code>.
        </p>
      )}
      <PhotoEditor
        mode={MODE}
        duration={DURATION}
        imageUrl={TEST_PHOTO}
        videoUrl={MODE === 'video' ? CLIP : ''}
        initialState={INITIAL}
        saving={false}
        onSave={async payload => {
          if (payload.overlays) {
            const summary = payload.overlays.map((o, i) =>
              `#${i} ${o.blob.size}b  in=${o.tIn} out=${o.tOut === null ? 'end' : o.tOut} fade=${o.fade}`)
            console.log(`exportOverlay → ${payload.overlays.length} group(s)\n` + summary.join('\n'))
            window.__lastExport = payload
          }
          return {}
        }}
        onCancel={() => {}}
        onUploadImage={async () => ({ error: 'Uploading is not wired up in the harness.' })}
        imageLibrary={[]}
        brandColorsText="Arak gold #d4af37, deep charcoal #1A1410, warm sand #C8A24A and an off-white"
      />
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<EditorHarness />)
