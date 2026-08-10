import ReactDOM from 'react-dom/client'
import { PhotoEditor } from '../components/studio/editor/index'
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

export function EditorHarness() {
  return (
    <div className="p-4">
      <PhotoEditor
        imageUrl={TEST_PHOTO}
        initialState={null}
        saving={false}
        onSave={async () => ({})}
        onCancel={() => {}}
        onUploadImage={async () => ({ error: 'Uploading is not wired up in the harness.' })}
        imageLibrary={[]}
        brandColorsText="Arak gold #d4af37, deep charcoal #1A1410, warm sand #C8A24A and an off-white"
      />
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<EditorHarness />)
