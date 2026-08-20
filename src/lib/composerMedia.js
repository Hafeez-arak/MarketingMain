// ─── Media, as the composer stores it ──────────────────────────────────────
// Pure translation from a media-library row to the shape the composer and the
// publish payload use. It lives in lib/ rather than beside MediaPicker because
// a module that exports both React components and plain functions breaks Fast
// Refresh — and because the publish path needs these without pulling in a
// modal.

// The library does not always record a mime type (older rows predate it), so
// the extension is the fallback. Both are checked because neither alone is
// reliable: a Supabase Storage URL can carry a query string after the
// extension, and a row can carry `video/mp4` with no extension at all.
export function mediaKindOf(item) {
  const url = String(item.url || '')
  const mime = String(item.mime_type || item.mimeType || '')
  if (mime.startsWith('video/') || /\.(mp4|mov|webm)(\?|#|$)/i.test(url)) return 'video'
  return 'image'
}

// Metadata is carried through when the library has it and left null when it
// does not. That distinction matters: pre-flight validation only checks a
// duration or a size it actually knows, because inventing a failure for an
// unknown is worse than letting the platform answer.
export function toComposerMedia(item) {
  return {
    url: item.url,
    type: mediaKindOf(item),
    mimeType: item.mime_type || item.mimeType || '',
    bytes: item.bytes ?? item.size_bytes ?? null,
    seconds: item.duration_seconds ?? item.seconds ?? null,
    width: item.width ?? null,
    height: item.height ?? null,
    name: item.name || '',
  }
}
