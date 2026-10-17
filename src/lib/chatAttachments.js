import { ATTACH_LIMITS, IMAGE_TYPES, DOCUMENT_TYPES, kindOf } from './agent/attachments.js'

// ─── Getting a file ready to send to the assistant ─────────────────────────
// The browser half of src/lib/agent/attachments.js — read that header for how
// a file travels and why it is not stored. This half exists because only a
// browser has a canvas: a phone photo is 4000px and 3-6 MB, and both Vercel's
// 4.5 MB body cap and the model's own 1568px ceiling say it has to shrink
// before it leaves the device.
//
// Every image is re-encoded as JPEG, PNGs and screenshots included. Text in a
// screenshot survives JPEG at this quality and size, and one format means one
// size estimate. Transparency is flattened onto white, which is what a
// screenshot of a light-themed page already is.

let seq = 0

/** Read a File/Blob as a data: URL. */
function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Could not read the file.'))
    reader.readAsDataURL(file)
  })
}

/** Decode an image file into something a canvas can draw. */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That image could not be opened.')) }
    img.src = url
  })
}

/** Draw `img` with its long edge at most `edge` px; return a JPEG data URL. */
function jpegAt(img, edge, quality) {
  const w = img.naturalWidth || img.width
  const h = img.naturalHeight || img.height
  const scale = Math.min(1, edge / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w * scale))
  canvas.height = Math.max(1, Math.round(h * scale))
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', quality)
}

const base64Of = dataUrl => String(dataUrl).replace(/^data:[^,]*,/, '')

/**
 * One file, ready for askAgent: { id, name, media_type, kind, data, thumb }.
 * Throws with a sentence a person can act on.
 */
export async function prepareAttachment(file) {
  const type = String(file?.type || '').toLowerCase()
  const name = file?.name || (type.startsWith('image/') ? 'pasted image' : 'file')

  if (type.startsWith('image/')) {
    // HEIC and friends: a browser that can decode it draws it and it becomes a
    // JPEG like everything else; one that cannot says so below.
    const img = await loadImage(file)
    const full = jpegAt(img, ATTACH_LIMITS.maxImageEdge, 0.85)
    const thumb = jpegAt(img, ATTACH_LIMITS.thumbEdge, 0.7)
    return { id: `a${++seq}`, name, media_type: 'image/jpeg', kind: 'image', data: base64Of(full), thumb }
  }

  if (DOCUMENT_TYPES.includes(type)) {
    if (file.size > ATTACH_LIMITS.maxPdfBytes) {
      throw new Error(`${name} is ${(file.size / 1e6).toFixed(1)} MB. PDFs can be at most ${ATTACH_LIMITS.maxPdfBytes / 1e6} MB.`)
    }
    const data = base64Of(await readAsDataUrl(file))
    return { id: `a${++seq}`, name, media_type: 'application/pdf', kind: kindOf('application/pdf'), data, thumb: '' }
  }

  throw new Error(`${name}: only images and PDFs can be attached.`)
}

/** What the file picker should offer. */
export const ACCEPT = [...IMAGE_TYPES, 'image/*', ...DOCUMENT_TYPES].join(',')

/**
 * Would adding `next` to `current` break a limit? Returns a sentence, or ''.
 * Checked before a file is added, so the person hears about it at the moment
 * they chose the file rather than when they press send.
 */
export function overLimit(current, next) {
  const all = [...(current || []), ...(next || [])]
  if (all.length > ATTACH_LIMITS.maxCount) return `At most ${ATTACH_LIMITS.maxCount} files per message.`
  const total = all.reduce((n, a) => n + String(a.data || '').length, 0)
  if (total > ATTACH_LIMITS.maxTotalBase64) return 'Those files are too large together. Send fewer, or smaller ones.'
  return ''
}
