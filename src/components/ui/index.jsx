import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { STATUS_META, PLATFORM_META } from '../../lib/utils'

// square is opt-in (default off) — every existing caller keeps the rounded
// corners the rest of the app uses; only Creative Studio passes it, for the
// sharp-cornered look requested there specifically.
export function Button({ variant='primary', size='md', children, onClick, disabled, type='button', className='', square=false }) {
  const base = `inline-flex items-center gap-2 font-medium ${square ? 'rounded-none' : 'rounded-xl'} transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:pointer-events-none focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400`
  const sizes = { xs:'px-2.5 py-1 text-xs', sm:'px-3.5 py-1.5 text-sm', md:'px-5 py-2.5 text-sm', lg:'px-6 py-3 text-base' }
  const variants = {
    primary:   'btn-amber active:scale-[.98]',
    secondary: 'bg-white text-text border border-border hover:bg-surface-subtle hover:border-stone-300 active:scale-[.98] shadow-sm',
    ghost:     'bg-transparent text-text-secondary hover:bg-surface-subtle hover:text-text active:scale-[.98]',
    danger:    'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 active:scale-[.98]',
    clay:      'btn-clay text-white active:scale-[.98]',
    outline:   'bg-white text-text border border-border hover:border-amber-400 hover:bg-amber-50/50 active:scale-[.98]',
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}>
      {children}
    </button>
  )
}

export function Badge({ status, children, className='' }) {
  const cfg = STATUS_META[status]
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${cfg ? cfg.classes : 'bg-stone-100 text-stone-600'} ${className}`}>
      {cfg ? cfg.label : children}
    </span>
  )
}

export function PlatformPill({ platform }) {
  const m = PLATFORM_META[platform]
  if (!m) return null
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${m.bg} ${m.text} ${m.border}`}>
      {m.label}
    </span>
  )
}

export function Card({ children, className='', onClick, hover=false, square=false }) {
  return (
    <div onClick={onClick}
      className={`bg-white ${square ? 'rounded-none' : 'rounded-2xl'} border border-border shadow-card
        ${hover ? 'cursor-pointer hover:shadow-card-hover hover:border-stone-300 transition-all duration-200' : ''}
        ${className}`}>
      {children}
    </div>
  )
}

export function WarmCard({ children, className='' }) {
  return (
    <div className={`rounded-2xl border border-amber-200/60 shadow-sm ${className}`}
      style={{ background: 'linear-gradient(135deg, #fffbf0 0%, #fff4d6 60%, #fffbf0 100%)' }}>
      {children}
    </div>
  )
}

// Keep GoldCard as alias for WarmCard for compatibility
export function GoldCard({ children, className='' }) {
  return <WarmCard className={className}>{children}</WarmCard>
}

export function SectionHead({ title, subtitle, action }) {
  return (
    <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-border">
      <div>
        <h3 className="font-semibold text-text">{title}</h3>
        {subtitle && <p className="text-xs text-text-tertiary mt-0.5">{subtitle}</p>}
      </div>
      {action && <div className="ml-4 flex-shrink-0">{action}</div>}
    </div>
  )
}

const fieldBase = (square=false) => `w-full ${square ? 'rounded-none' : 'rounded-xl'} border border-border bg-white text-text placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all duration-200 text-sm`

export function Input({ label, hint, error, className='', square=false, ...props }) {
  return (
    <div className={className}>
      {label && <label className="block text-xs font-semibold text-text-secondary mb-1.5">{label}</label>}
      <input {...props} className={`${fieldBase(square)} px-3.5 py-2.5 ${error ? 'border-red-300 focus:ring-red-300' : ''}`} />
      {hint && !error && <p className="text-xs text-text-tertiary mt-1">{hint}</p>}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  )
}

// autoGrow is opt-in (default off) so every other form using this component
// keeps its fixed height — only a chat-style prompt box wants the Claude/
// ChatGPT behavior of expanding as you type instead of scrolling internally
// right away. `rows` still sets the minimum height either way. `square` is
// the same opt-in pattern as Button/Card/Modal below.
export function Textarea({ label, hint, error, className='', rows=4, autoGrow=false, maxHeight=260, value, square=false, ...props }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!autoGrow || !ref.current) return
    const el = ref.current
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, maxHeight) + 'px'
  }, [autoGrow, value, maxHeight])

  return (
    <div className={className}>
      {label && <label className="block text-xs font-semibold text-text-secondary mb-1.5">{label}</label>}
      <textarea {...props} ref={ref} value={value} rows={rows}
        className={`${fieldBase(square)} px-3.5 py-2.5 resize-none ${autoGrow ? 'overflow-y-auto' : ''} ${error ? 'border-red-300' : ''}`} />
      {hint && !error && <p className="text-xs text-text-tertiary mt-1">{hint}</p>}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  )
}

export function Select({ label, hint, error, className='', children, square=false, ...props }) {
  return (
    <div className={className}>
      {label && <label className="block text-xs font-semibold text-text-secondary mb-1.5">{label}</label>}
      <select {...props} className={`${fieldBase(square)} px-3.5 py-2.5 cursor-pointer ${error ? 'border-red-300' : ''}`}>
        {children}
      </select>
      {hint && !error && <p className="text-xs text-text-tertiary mt-1">{hint}</p>}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  )
}

export function Modal({ open, onClose, title, children, width='max-w-lg', square=false }) {
  const ref = useRef(null)
  useEffect(() => {
    const fn = e => { if (e.key === 'Escape') onClose() }
    if (open) document.addEventListener('keydown', fn)
    return () => document.removeEventListener('keydown', fn)
  }, [open, onClose])
  if (!open) return null
  // Rendered through a portal to <body> so the fixed overlay is positioned
  // against the viewport — never trapped/offset by an ancestor that has a
  // transform, filter, or backdrop-filter (e.g. the sticky action bar / cards).
  return createPortal(
    <div ref={ref} onClick={e => e.target === ref.current && onClose()}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(26,20,16,0.35)', backdropFilter: 'blur(6px)' }}>
      <div className={`bg-white ${square ? 'rounded-none' : 'rounded-2xl'} shadow-dropdown w-full ${width} max-h-[90vh] flex flex-col animate-fade-scale border border-border`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <h2 className="font-display font-semibold text-text text-lg">{title}</h2>
          <button onClick={onClose} className={`w-7 h-7 ${square ? 'rounded-none' : 'rounded-xl'} flex items-center justify-center text-text-secondary hover:bg-surface-subtle transition-colors`}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="overflow-y-auto flex-1 scrollbar-thin">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

export function Empty({ icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
      <div className="w-14 h-14 rounded-2xl bg-amber-100 flex items-center justify-center mb-4 text-amber-600 animate-float">{icon}</div>
      <h3 className="font-display font-semibold text-text text-lg mb-1">{title}</h3>
      <p className="text-sm text-text-secondary max-w-xs mb-5 leading-relaxed">{description}</p>
      {action}
    </div>
  )
}

const avColors = ['bg-amber-100 text-amber-800','bg-clay-100 text-clay-800','bg-sage-100 text-sage-800','bg-stone-100 text-stone-800','bg-sky-100 text-sky-800','bg-purple-100 text-purple-800']
export function Avatar({ name='?', size='md', color }) {
  const initials = name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()
  const c = color || avColors[name.charCodeAt(0) % avColors.length]
  const sizes = { xs:'w-6 h-6 text-[10px]', sm:'w-7 h-7 text-xs', md:'w-8 h-8 text-xs', lg:'w-10 h-10 text-sm', xl:'w-12 h-12 text-base' }
  return <div className={`${sizes[size]} rounded-full flex items-center justify-center font-bold flex-shrink-0 ${c}`}>{initials}</div>
}

export function Spinner({ size='md' }) {
  const sizes = { sm:'w-3 h-3 border-[1.5px]', md:'w-4 h-4 border-2', lg:'w-6 h-6 border-2' }
  return <div className={`${sizes[size]} border-current border-t-transparent rounded-full animate-spin`} />
}

export function Toggle({ checked, onChange, label }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer group">
      <div className="relative flex-shrink-0">
        <input type="checkbox" checked={checked} onChange={onChange} className="sr-only" />
        <div className={`w-10 h-5 rounded-full transition-all duration-300 ${checked ? 'bg-amber-gradient shadow-amber' : 'bg-stone-200'}`} />
        <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-300 ${checked ? 'translate-x-5' : ''}`} />
      </div>
      {label && <span className="text-sm text-text-secondary group-hover:text-text transition-colors">{label}</span>}
    </label>
  )
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, danger=false, square=false }) {
  return (
    <Modal open={open} onClose={onClose} title={title} width="max-w-sm" square={square}>
      <div className="p-6">
        <p className="text-sm text-text-secondary mb-5 leading-relaxed">{message}</p>
        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={onClose} square={square}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={() => { onConfirm(); onClose() }} square={square}>Confirm</Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Shared "clean dashboard" primitives ──────────────────────────────────
// Introduced for the Analytics rebuild (matched against Zernio's own UI)
// and promoted here so every page can use the same look: a small icon
// badge in front of section titles, a compact pill dropdown instead of a
// full-height form field, and one small stroke-icon set. Pages should
// reach for these instead of re-inventing a badge/select each time.

const BADGE_TONES = {
  steel: 'bg-amber-50 text-amber-600',
  sage:  'bg-sage-50 text-sage-600',
  rose:  'bg-rose-50 text-rose-500',
}
export function IconBadge({ children, tone = 'steel' }) {
  return (
    <span className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${BADGE_TONES[tone] || BADGE_TONES.steel}`}>
      {children}
    </span>
  )
}

export function PillSelect({ value, onChange, className = '', children }) {
  return (
    <div className={`relative inline-flex ${className}`}>
      <select value={value} onChange={onChange}
        className="appearance-none w-full bg-white border border-border rounded-full text-xs font-medium text-text-secondary pl-3 pr-7 py-1.5 cursor-pointer hover:border-stone-300 hover:text-text transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400">
        {children}
      </select>
      <svg className="w-3 h-3 absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
    </div>
  )
}

// Tiny 14px stroke icons, same convention used throughout the app (inline
// SVG, currentColor, strokeWidth 1.75) — grab one by name instead of
// inlining a fresh <svg> block per use.
const p = 'w-3.5 h-3.5'
export const Icon = {
  document:   <svg className={p} fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>,
  heart:      <svg className={p} fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"/></svg>,
  message:    <svg className={p} fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>,
  trending:   <svg className={p} fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
  clock:      <svg className={p} fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  grid:       <svg className={p} fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  trophy:     <svg className={p} fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M17 5h3a2 2 0 0 1-2 4M7 5H4a2 2 0 0 0 2 4"/></svg>,
  activity:   <svg className={p} fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
  eye:        <svg className={p} fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg>,
  users:      <svg className={p} fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  share:      <svg className={p} fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="10.5" x2="15.4" y2="6.5"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/></svg>,
  bookmark:   <svg className={p} fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M19 21 12 16l-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>,
  cursor:     <svg className={p} fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51z"/></svg>,
  checkCircle:<svg className={p} fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>,
  calendar:   <svg className={p} fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  mail:       <svg className={p} fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>,
  approve:    <svg className={p} fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>,
  image:      <svg className={p} fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>,
}

export function StatCard({ label, value, sub, icon, onClick, accent=false }) {
  return (
    <div onClick={onClick}
      className={`relative rounded-2xl border overflow-hidden transition-all duration-200 cursor-pointer group
        ${accent ? 'border-amber-300 shadow-amber' : 'border-border bg-white shadow-card hover:shadow-card-hover hover:border-stone-300'}`}
      style={accent ? { background: 'linear-gradient(135deg,#f4f6f5,#e1e7e6 80%)' } : {}}>
      {accent && <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: 'linear-gradient(90deg,#96acb2,#4c5e61)' }} />}
      <div className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-colors
            ${accent ? 'bg-amber-200 text-amber-700' : 'bg-surface-subtle text-text-secondary group-hover:bg-amber-100 group-hover:text-amber-600'}`}>
            {icon}
          </div>
          <svg className="w-3 h-3 text-text-disabled group-hover:text-amber-400 transition-colors mt-1" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg>
        </div>
        <p className={`text-3xl font-display font-bold leading-none mb-1 ${accent ? 'text-gradient-amber' : 'text-text'}`}>{value}</p>
        <p className="text-xs font-semibold text-text-secondary">{label}</p>
        {sub && <p className="text-xs text-text-tertiary mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

/* ─── PostImage ─────────────────────────────────────────────────────────────
   Drop-in <img> replacement that handles expired Replicate URLs gracefully.
   Shows a warm placeholder with a camera icon whenever src is missing,
   a replicate.delivery URL (likely expired), or the image fails to load.
   All existing className / style props pass through unchanged.
────────────────────────────────────────────────────────────────────────────── */
function isLikelyExpired(url) {
  if (!url) return true
  // Replicate delivery URLs expire after ~1 hour
  if (url.includes('replicate.delivery')) return true
  return false
}

export function PostImage({ src, alt = '', className = '', style = {}, ...rest }) {
  const [failed, setFailed] = useState(() => isLikelyExpired(src))

  // Reset when src changes (e.g. after regen)
  useEffect(() => {
    setFailed(isLikelyExpired(src))
  }, [src])

  if (failed) {
    return (
      <div
        className={`flex items-center justify-center bg-surface-subtle ${className}`}
        style={style}
        {...rest}
      >
        <svg className="w-5 h-5 text-text-disabled" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <polyline points="21 15 16 10 5 21"/>
        </svg>
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      style={style}
      onError={() => setFailed(true)}
      {...rest}
    />
  )
}
