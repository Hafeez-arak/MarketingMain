// ─── Frame one of a clip, as an image ──────────────────────────────────────
// The editor needs something to place text ON. For a clip that was animated
// from a still, that still IS frame one and no capture is needed — which is
// every "Animate" case, and the reason this file is the fallback rather than
// the main path.
//
// Text-to-video has no source still, so the frame has to come out of the clip
// itself. crossOrigin='anonymous' is the load-bearing part: without it the
// canvas is tainted the moment a cross-origin frame is drawn and toDataURL
// throws a SecurityError. Supabase serves public storage objects with
// `Access-Control-Allow-Origin: *`, so the request succeeds — but only if the
// attribute is set BEFORE src, which is why the order below matters.

const CAPTURE_TIMEOUT_MS = 12000

export function captureFirstFrame(videoUrl) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'

    let settled = false
    const done = fn => (...args) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      video.removeAttribute('src')
      video.load()
      fn(...args)
    }
    const ok = done(resolve)
    const fail = done(reject)

    const timer = setTimeout(
      () => fail(new Error("Couldn't read a frame from this clip in time.")),
      CAPTURE_TIMEOUT_MS,
    )

    function grab() {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        if (!canvas.width || !canvas.height) throw new Error('The clip reported no dimensions.')
        canvas.getContext('2d').drawImage(video, 0, 0)
        // Round-trips through a data URL rather than handing the canvas over
        // directly, because the editor's loadBaseCanvas takes a URL and this
        // way a captured frame and a stored still travel the same path.
        ok(canvas.toDataURL('image/png'))
      } catch (err) {
        fail(err)
      }
    }

    // 'seeked' rather than 'loadeddata': seeking to 0 explicitly is what makes
    // the first *decoded* frame available, and some browsers fire loadeddata
    // with nothing yet painted.
    video.addEventListener('seeked', grab, { once: true })
    video.addEventListener('loadedmetadata', () => { video.currentTime = 0 }, { once: true })
    video.addEventListener('error', () => fail(new Error("Couldn't load this clip to read a frame from it.")), { once: true })

    video.src = videoUrl
  })
}

// The still a clip was animated FROM, if there is one. Prefers the clean plate
// for the same reason the image editor does: reopening against a flattened
// composite bakes the previous round's text into the picture while
// overlay_state replays the same layers on top of it.
export function parentStillOf(version, versions) {
  if (!version?.parent_version_id) return ''
  const parent = versions.find(v => v.id === version.parent_version_id)
  if (!parent || parent.media_type === 'video') return ''
  return parent.overlay_state?.baseImageUrl || parent.image_url || ''
}
