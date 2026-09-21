import { useRef, useState } from 'react'

// ─── A preview video you can actually watch ────────────────────────────────
// Every platform preview (Instagram/TikTok/LinkedIn) showed a video element
// with no `controls` and, on LinkedIn, a play icon that was purely decorative
// (pointer-events-none) — so the "preview" of a reel or video post was a
// frozen first frame nobody could press play on. Native `controls` isn't an
// option here: TikTok's caption strip and LinkedIn's play icon both sit in
// absolutely-positioned overlays on top of the video, which would cover the
// browser's own control bar. So this is a click-to-toggle play/pause instead,
// scoped to the video area only.
export function PreviewVideo({ src, className = '', wrapperClassName = 'relative w-full h-full' }) {
  const ref = useRef(null)
  const [playing, setPlaying] = useState(false)

  function toggle() {
    const el = ref.current
    if (!el) return
    if (el.paused) el.play().catch(() => {})
    else el.pause()
  }

  return (
    <div className={wrapperClassName}>
      <video ref={ref} src={src} className={className} muted playsInline preload="metadata" loop
        onClick={toggle} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
      {!playing && (
        <button type="button" onClick={toggle} aria-label="Play video"
          className="absolute inset-0 flex items-center justify-center">
          <span className="w-11 h-11 rounded-full bg-black/55 text-white flex items-center justify-center text-lg">▶</span>
        </button>
      )}
    </div>
  )
}
