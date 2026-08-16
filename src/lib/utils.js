export function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,7) }
export function clsx(...args) { return args.filter(Boolean).join(' ') }
export function formatDate(iso) { return new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) }
export function formatTime(iso) { return new Date(iso).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}) }
export function formatDateTime(iso) { return new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) }
export function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff/60000)
  if (m<1) return 'just now'; if (m<60) return `${m}m ago`
  const h = Math.floor(m/60)
  if (h<24) return `${h}h ago`; return `${Math.floor(h/24)}d ago`
}
export const PLATFORM_META = {
  instagram:{ label:'Instagram', abbr:'IG', color:'#E1306C', bg:'bg-pink-50',  text:'text-pink-600',  border:'border-pink-200',  maxChars:2200 },
  tiktok:   { label:'TikTok',    abbr:'TT', color:'#010101', bg:'bg-stone-100',text:'text-stone-700', border:'border-stone-300', maxChars:2200 },
}
export const STATUS_META = {
  draft:           { label:'Draft',     classes:'bg-stone-100 text-stone-600' },
  scheduled:       { label:'Scheduled', classes:'bg-sky-50 text-sky-700 ring-1 ring-sky-200' },
  published:       { label:'Published', classes:'bg-sage-100 text-sage-700 ring-1 ring-sage-200' },
  failed:          { label:'Failed',    classes:'bg-red-50 text-red-600 ring-1 ring-red-200' },
  live:            { label:'Live',      classes:'bg-sage-100 text-sage-700' },
  paused:          { label:'Paused',    classes:'bg-stone-100 text-stone-600' },
  active:          { label:'Active',    classes:'bg-sage-100 text-sage-700' },
  completed:       { label:'Completed', classes:'bg-amber-100 text-amber-800' },
  pending:         { label:'Pending',   classes:'bg-amber-100 text-amber-700 ring-1 ring-amber-300' },
  pending_publish: { label:'Pending',   classes:'bg-amber-100 text-amber-700 ring-1 ring-amber-300' },
  pending_review:  { label:'Pending review', classes:'bg-purple-50 text-purple-700 ring-1 ring-purple-200' },
  approved:        { label:'Approved',  classes:'bg-sage-100 text-sage-700' },
  rejected:        { label:'Rejected',  classes:'bg-red-50 text-red-600' },
}
