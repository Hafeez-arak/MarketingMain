import { loadImage } from '../../overlayModel'

// ─── Image-layer bitmap cache ──────────────────────────────────────────────
// Image layers store a URL, not pixels (see document.js's newImageLayer), so
// something has to turn a URL into an HTMLImageElement — and it has to be the
// SAME something for the live Stage and the headless export Stage, or a slow
// network could produce an export missing a layer the user could plainly see.
//
// Two maps rather than one: `images` is the resolved element (a synchronous
// lookup, which is what a render pass needs), `pending` is the in-flight
// promise (so ten nodes mounting at once share one fetch instead of racing).

const images = new Map()
const pending = new Map()

export function getCachedImage(url) {
  return url ? images.get(url) || null : null
}

export function loadLayerImage(url) {
  if (!url) return Promise.resolve(null)
  const done = images.get(url)
  if (done) return Promise.resolve(done)
  const inFlight = pending.get(url)
  if (inFlight) return inFlight

  const p = loadImage(url)
    .then(img => { images.set(url, img); pending.delete(url); return img })
    // A failed image must not reject the whole render — a layer pointing at a
    // deleted upload should leave a hole, not block the export. The failure
    // is surfaced by the node simply not drawing.
    .catch(() => { pending.delete(url); return null })
  pending.set(url, p)
  return p
}

// Resolve every image layer in a document before a render pass. Awaited by
// renderDocument, and by the editor on open so the first paint isn't empty.
export function ensureLayerImages(layers) {
  const urls = [...new Set(layers.filter(l => l.type === 'image' && l.url).map(l => l.url))]
  return Promise.all(urls.map(loadLayerImage))
}
