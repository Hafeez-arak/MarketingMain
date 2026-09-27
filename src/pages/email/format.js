// ─── Helpers shared by the Email tabs (no components here) ─────────────────

export const GROUP_COLORS = {
  steel: 'bg-amber-700', sage: 'bg-sage-600', clay: 'bg-clay-600', sky: 'bg-sky-600', stone: 'bg-stone-500', red: 'bg-red-500',
}

export function pct(n, d) {
  if (!d) return '—'
  const r = (n / d) * 100
  return `${r < 10 && r > 0 ? r.toFixed(1) : Math.round(r)}%`
}

export function shortDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Riyadh' })
}

export function dateTime(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Riyadh' })
}

export function download(filename, text, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
