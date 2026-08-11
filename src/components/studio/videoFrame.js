// ─── Reading a frame out of a clip ─────────────────────────────────────────
// Two callers, two reasons:
//
//  · FIRST frame — the editor needs something to place text ON. For a clip
//    that was animated from a still, that still IS frame one and no capture
//    is needed, which is every "Animate" case and the reason this is the
//    fallback rather than the main path. Text-to-video has no source still.
//
//  · LAST frame — multi-clip chaining. Clip N's final frame becomes clip
//    N+1's start frame, which is what makes a seam read as a continuous shot
//    rather than a cut.
//
// crossOrigin='anonymous' is the load-bearing part of both: without it the
// canvas is tainted the moment a cross-origin frame is drawn and toDataURL /
// toBlob throw a SecurityError. Supabase serves public storage objects with
// `Access-Control-Allow-Origin: *`, so the request succeeds — but only if the
// attribute is set BEFORE src. That ordering now lives in exactly one place
// (`withVideo` below) so the two capture paths cannot drift apart on it.

// Seeking to 0 is served out of the bytes the browser already has. Seeking to
// the END of an mp4 usually needs a second range request, so it gets longer.
const FIRST_TIMEOUT_MS = 12000
const LAST_TIMEOUT_MS = 15000

// How far back from the reported end to seek. Asking for exactly `duration`
// commonly lands past the last decodable frame and paints nothing; these are
// tried in order until a frame with actual content comes back.
const TAIL_OFFSETS = [0.04, 0.12, 0.3]

// Sets up a <video>, guarantees single-settlement and cleanup, and hands the
// element to `run`. Every capture goes through here.
function withVideo(videoUrl, timeoutMs, run) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    // Before src. Always.
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
      timeoutMs,
    )

    video.addEventListener(
      'error',
      () => fail(new Error("Couldn't load this clip to read a frame from it.")),
      { once: true },
    )

    run(video, ok, fail)
    video.src = videoUrl
  })
}

function drawToCanvas(video) {
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  if (!canvas.width || !canvas.height) throw new Error('The clip reported no dimensions.')
  canvas.getContext('2d').drawImage(video, 0, 0)
  return canvas
}

// A seek past the last decodable frame paints nothing, and "nothing" is a
// uniform canvas rather than an error. Downscaling to 16×16 and checking both
// the mean and the spread catches the two ways that shows up: an all-black
// frame (mean ≈ 0) and an all-anything frame (variance ≈ 0). Cheap enough to
// run on every tail attempt.
function looksBlank(canvas) {
  try {
    const probe = document.createElement('canvas')
    probe.width = 16
    probe.height = 16
    const ctx = probe.getContext('2d')
    ctx.drawImage(canvas, 0, 0, 16, 16)
    const { data } = ctx.getImageData(0, 0, 16, 16)
    let sum = 0
    let sumSq = 0
    const n = 256
    for (let i = 0; i < data.length; i += 4) {
      const lum = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114)
      sum += lum
      sumSq += lum * lum
    }
    const mean = sum / n
    const variance = sumSq / n - mean * mean
    return mean < 2 || variance < 1
  } catch {
    // getImageData throws on a tainted canvas — which would mean the CORS
    // setup above failed, and the caller is about to find that out anyway.
    return false
  }
}

// Waits for a frame to actually be PRESENTED, not merely for the seek to be
// reported complete. Some browsers fire 'seeked' with nothing yet painted;
// requestVideoFrameCallback is the only reliable signal, so it's used where
// it exists and a plain 'seeked' is the fallback.
function onFramePresented(video, fn) {
  if (typeof video.requestVideoFrameCallback === 'function') {
    video.requestVideoFrameCallback(() => fn())
    return
  }
  video.addEventListener('seeked', () => fn(), { once: true })
}

// ── First frame ────────────────────────────────────────────────────────────

// Returns a data URL. Unchanged contract — the editor's loadBaseCanvas takes a
// URL, and this way a captured frame and a stored still travel the same path.
export function captureFirstFrame(videoUrl) {
  return withVideo(videoUrl, FIRST_TIMEOUT_MS, (video, ok, fail) => {
    video.addEventListener('loadedmetadata', () => { video.currentTime = 0 }, { once: true })
    // 'seeked' rather than 'loadeddata': seeking to 0 explicitly is what makes
    // the first *decoded* frame available.
    video.addEventListener('seeked', () => {
      try { ok(drawToCanvas(video).toDataURL('image/png')) } catch (err) { fail(err) }
    }, { once: true })
  })
}

// ── Last frame ─────────────────────────────────────────────────────────────

function captureTail(videoUrl, toResult) {
  return withVideo(videoUrl, LAST_TIMEOUT_MS, (video, ok, fail) => {
    let attempt = 0

    function trySeek() {
      const d = video.duration
      // A clip that reports Infinity (some fragmented mp4s) or 0 can't be
      // seeked to relative to its end. Say so rather than handing back frame
      // one and silently breaking the chain.
      if (!Number.isFinite(d) || d <= 0) {
        fail(new Error("This clip didn't report a usable length, so its last frame can't be read."))
        return
      }
      video.currentTime = Math.max(0, d - TAIL_OFFSETS[attempt])
    }

    video.addEventListener('loadedmetadata', trySeek, { once: true })

    function grab() {
      let canvas
      try { canvas = drawToCanvas(video) } catch (err) { fail(err); return }

      // Back off further only while there are offsets left. The last one is
      // accepted whatever it looks like — a genuinely dark final frame is a
      // real thing, and failing the whole run over it would strand a
      // storyboard mid-render.
      if (looksBlank(canvas) && attempt < TAIL_OFFSETS.length - 1) {
        attempt += 1
        onFramePresented(video, grab)
        trySeek()
        return
      }
      try { toResult(canvas, ok, fail) } catch (err) { fail(err) }
    }

    onFramePresented(video, grab)
  })
}

// Data URL — for anything that wants to hand the frame straight to an <img>.
export function captureLastFrame(videoUrl) {
  return captureTail(videoUrl, (canvas, ok, fail) => {
    try { ok(canvas.toDataURL('image/png')) } catch (err) { fail(err) }
  })
}

// Blob — what the chaining path wants, because that frame is going straight
// into Supabase storage. toBlob rather than toDataURL + re-fetch: a 720p PNG
// data URL is ~2MB of base64 built only to be parsed straight back.
export function captureLastFrameBlob(videoUrl) {
  return captureTail(videoUrl, (canvas, ok, fail) => {
    canvas.toBlob(
      blob => (blob ? ok(blob) : fail(new Error("Couldn't encode the clip's last frame."))),
      'image/png',
    )
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
