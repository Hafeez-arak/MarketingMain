import { useState } from 'react'
import ReactDOM from 'react-dom/client'
import { AuthContext } from '../store/auth'
import { ImageFitter } from '../components/media/ImageFitter'
import { PostComposer } from '../components/composer/PostComposer'
import { MemoryRouter } from 'react-router-dom'
import '../index.css'

// ─── Dev-only image-fitter harness ─────────────────────────────────────────
// Drives the manual crop/shape dialog on a wide banner — the shape that first
// showed why a picker like this needed to exist, though what happens to a
// banner Instagram would otherwise refuse is unrelated now: that is handled
// automatically, silently, by lib/imageFit.js at publish time. This dialog is
// the OTHER thing — reframing a picture on purpose, by hand.
//
// The app is behind auth and this dialog lives three screens in (composer →
// media strip → adjust), so a harness is the only way to actually drag the
// thing and look at what comes out. A fake AuthContext and an intercepted
// upload are all it needs — nothing here talks to Supabase.
//
// Served by Vite at /dev-fitter.html. Vite only builds index.html, so this
// never reaches a production bundle.
//
// `?composer=1` mounts the real Create-a-post dialog instead, with the banner
// already attached as slide 3, so the whole path is visible: the strip, its
// per-slide adjust button, and the fitter opening from it.

// The refused slide, drawn rather than fetched: a wide banner with a clear
// subject in the middle and text at both ends, so a crop that loses an edge
// is obvious and a pad that keeps everything is too.
function banner(w = 1239, h = 488) {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d')
  const g = ctx.createLinearGradient(0, 0, w, 0)
  g.addColorStop(0, '#1d3b35'); g.addColorStop(0.5, '#c8a24a'); g.addColorStop(1, '#1a1410')
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.font = 'bold 44px sans-serif'
  ctx.textBaseline = 'middle'
  ctx.fillText('LEFT EDGE', 24, h / 2)
  ctx.textAlign = 'right'
  ctx.fillText('RIGHT EDGE', w - 24, h / 2)
  ctx.textAlign = 'center'
  ctx.beginPath(); ctx.arc(w / 2, h / 2, 90, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fill()
  ctx.fillStyle = '#1a1410'; ctx.font = 'bold 28px sans-serif'
  ctx.fillText('SUBJECT', w / 2, h / 2)
  return c.toDataURL('image/png')
}

const SOURCE = banner()

// Every render lands here instead of the media-library bucket, so the page
// can show what was actually produced — the one thing a screenshot of the
// dialog cannot tell you.
let lastUpload = null
const auth = { activeWorkspaceId: 'dev-workspace', accessToken: 'dev-token', user: { id: 'dev' } }

// Exported so Fast Refresh can swap it: a file with no exports at all is
// reloaded whole, which loses the state you were in the middle of dragging.
export function FitterHarness() {
  const [media, setMedia] = useState({ url: SOURCE, type: 'image', width: 1239, height: 488, name: 'banner.png' })
  const [open, setOpen] = useState(true)
  const [history, setHistory] = useState([])

  return (
    <AuthContext.Provider value={auth}>
      <div className="p-6 max-w-4xl mx-auto space-y-4">
        <h1 className="text-lg font-semibold">Image fitter harness</h1>

        <div className="p-3 border border-sage-300 bg-sage-50 text-sage-800 text-sm">
          {media.width} × {media.height}px ({(media.width / media.height).toFixed(4)}:1).
        </div>

        <div className="flex gap-2">
          <button onClick={() => setOpen(true)} className="px-3 py-1.5 border border-border text-sm">Open the fitter</button>
          <button onClick={() => { setMedia({ url: SOURCE, type: 'image', width: 1239, height: 488, name: 'banner.png' }); setHistory([]) }}
            className="px-3 py-1.5 border border-border text-sm">Back to the banner</button>
        </div>

        <img src={media.url} alt="" className="border border-border max-w-full" style={{ maxHeight: 420 }} />

        <ol className="text-xs text-text-secondary space-y-1">
          {history.map((h, i) => <li key={i}>{h}</li>)}
        </ol>
      </div>

      <ImageFitter
        open={open}
        onClose={() => setOpen(false)}
        media={media}
        platform="instagram"
        format="carousel"
        index={2}
        total={3}
        onApply={(fitted, opts) => {
          setMedia(fitted)
          setHistory(h => [...h, `${opts.ratio} · ${opts.mode} · ${fitted.width}×${fitted.height} · ${Math.round(fitted.bytes / 1024)}KB${opts.applyToAll ? ' · apply to all' : ''}`])
        }}
      />
    </AuthContext.Provider>
  )
}

// Two libraries' worth of rows, in the shape PostgREST actually returns them
// — the real Arak Lighting set, so the picker is exercised against the data
// that exposed the gap rather than against tidy invented rows.
const LIB_ROWS = [
  { id: 'l1', name: 'natioanal day', url: banner(1080, 1080), mime_type: 'image/png' },
  { id: 'l2', name: 'a sparrow looking at the light', url: banner(1080, 1350), mime_type: 'image/webp' },
  { id: 'l3', name: 'lighting_bottle', url: banner(1080, 1080), mime_type: 'image/webp' },
  { id: 'l4', name: 'Cinematic time-lapse of a villa community', url: 'https://x/clip.mp4', mime_type: 'video/mp4' },
]
// brand_assets: public_url and title, no mime_type at all — the case the
// extension fallback in mediaKindOf exists for.
const BRAND_ROWS = [
  { id: 'b1', public_url: banner(1200, 800), title: 'Solitaire Mall, Riyadh', kind: 'project_photo' },
  { id: 'b2', public_url: banner(1200, 800), title: 'Ritz Carlton Hotel, Riyadh', kind: 'project_photo' },
  { id: 'b3', public_url: banner(1200, 800), title: 'King Fahad International Airport, Dammam', kind: 'project_photo' },
  { id: 'b4', public_url: banner(800, 800), title: 'ARAK Logo', kind: 'logo' },
  { id: 'b5', public_url: 'https://x/theme.mp3', title: 'Brand theme', kind: 'music' },
]

// The upload is replaced rather than mocked at the module level: ImageFitter
// imports it directly, so the honest way to intercept it here is fetch, which
// is where it ends up anyway.
const realFetch = window.fetch.bind(window)
window.fetch = async (url, opts) => {
  const href = String(url)
  if (href.includes('/storage/v1/object/media-library/')) {
    lastUpload = opts?.body
    return new Response('{}', { status: 200 })
  }
  if (href.includes('/rest/v1/brand_assets')) {
    return new Response(JSON.stringify(BRAND_ROWS), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }
  if (href.includes('/rest/v1/media_library?select=')) {
    return new Response(JSON.stringify(LIB_ROWS), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }
  if (href.includes('/rest/v1/media_library')) {
    // The row the real API would return, with a blob: URL standing in for the
    // public object URL so the page can display what was rendered.
    const objectUrl = lastUpload ? URL.createObjectURL(lastUpload) : SOURCE
    return new Response(JSON.stringify([{ url: objectUrl }]), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }
  return realFetch(url, opts)
}

// A legal portrait slide to sit beside the refused one, so the carousel is the
// mixture the real post was rather than one bad picture on its own.
function portrait(w = 1080, h = 1350) {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d')
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, '#22333a'); g.addColorStop(1, '#c8a24a')
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.font = 'bold 64px sans-serif'; ctx.textAlign = 'center'
  ctx.fillText('4:5', w / 2, h / 2)
  return c.toDataURL('image/png')
}

export function ComposerHarness() {
  const portraitUrl = portrait()
  const initial = {
    platform: 'instagram',
    format: 'carousel',
    accountIds: ['acc-1'],
    caption: 'Every path deserves light that lasts.',
    media: [
      { url: portraitUrl, type: 'image', width: 1080, height: 1350, name: 'slide-1.png' },
      { url: portraitUrl, type: 'image', width: 1080, height: 1350, name: 'slide-2.png' },
      { url: SOURCE, type: 'image', width: 1239, height: 488, name: 'banner.png' },
    ],
  }
  return (
    <AuthContext.Provider value={auth}>
      <MemoryRouter>
        <PostComposer
          open
          platform="instagram"
          accounts={[{ zernio_account_id: 'acc-1', platform: 'instagram', username: 'lightingaaa', display_name: 'lightingaaa' }]}
          workspaceId="dev-workspace"
          initial={initial}
          onClose={() => {}}
          onSaveDraft={async () => ({ ok: true })}
          onSchedule={async () => ({ ok: true })}
          onPublish={async () => ({ ok: true })}
        />
      </MemoryRouter>
    </AuthContext.Provider>
  )
}

const COMPOSER = new URLSearchParams(window.location.search).get('composer') === '1'
ReactDOM.createRoot(document.getElementById('root')).render(
  COMPOSER ? <ComposerHarness /> : <FitterHarness />,
)
