import { useEffect, useRef, useState } from 'react'
import { STATUS_META, PLATFORM_META } from '../../lib/utils'

export function Button({ variant='primary', size='md', children, onClick, disabled, type='button', className='' }) {
  const base = 'inline-flex items-center gap-2 font-medium rounded-xl transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:pointer-events-none focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400'
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

export function Card({ children, className='', onClick, hover=false }) {
  return (
    <div onClick={onClick}
      className={`bg-white rounded-2xl border border-border shadow-card
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

const fieldBase = 'w-full rounded-xl border border-border bg-white text-text placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all duration-200 text-sm'

export function Input({ label, hint, error, className='', ...props }) {
  return (
    <div className={className}>
      {label && <label className="block text-xs font-semibold text-text-secondary mb-1.5">{label}</label>}
      <input {...props} className={`${fieldBase} px-3.5 py-2.5 ${error ? 'border-red-300 focus:ring-red-300' : ''}`} />
      {hint && !error && <p className="text-xs text-text-tertiary mt-1">{hint}</p>}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  )
}

export function Textarea({ label, hint, error, className='', rows=4, ...props }) {
  return (
    <div className={className}>
      {label && <label className="block text-xs font-semibold text-text-secondary mb-1.5">{label}</label>}
      <textarea {...props} rows={rows} className={`${fieldBase} px-3.5 py-2.5 resize-none ${error ? 'border-red-300' : ''}`} />
      {hint && !error && <p className="text-xs text-text-tertiary mt-1">{hint}</p>}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  )
}

export function Select({ label, hint, error, className='', children, ...props }) {
  return (
    <div className={className}>
      {label && <label className="block text-xs font-semibold text-text-secondary mb-1.5">{label}</label>}
      <select {...props} className={`${fieldBase} px-3.5 py-2.5 cursor-pointer ${error ? 'border-red-300' : ''}`}>
        {children}
      </select>
      {hint && !error && <p className="text-xs text-text-tertiary mt-1">{hint}</p>}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  )
}

export function Modal({ open, onClose, title, children, width='max-w-lg' }) {
  const ref = useRef(null)
  useEffect(() => {
    const fn = e => { if (e.key === 'Escape') onClose() }
    if (open) document.addEventListener('keydown', fn)
    return () => document.removeEventListener('keydown', fn)
  }, [open, onClose])
  if (!open) return null
  return (
    <div ref={ref} onClick={e => e.target === ref.current && onClose()}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(26,20,16,0.35)', backdropFilter: 'blur(6px)' }}>
      <div className={`bg-white rounded-2xl shadow-dropdown w-full ${width} max-h-[90vh] flex flex-col animate-fade-scale border border-border`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <h2 className="font-display font-semibold text-text text-lg">{title}</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-xl flex items-center justify-center text-text-secondary hover:bg-surface-subtle transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="overflow-y-auto flex-1 scrollbar-thin">{children}</div>
      </div>
    </div>
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
        <div className={`w-10 h-5 rounded-full transition-all duration-300 ${checked ? 'bg-amber-gradient shadow-amber' : 'bg-stone-200'}`}
          style={checked ? { background: 'linear-gradient(135deg,#ffbc38,#d4850a)' } : {}} />
        <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-300 ${checked ? 'translate-x-5' : ''}`} />
      </div>
      {label && <span className="text-sm text-text-secondary group-hover:text-text transition-colors">{label}</span>}
    </label>
  )
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, danger=false }) {
  return (
    <Modal open={open} onClose={onClose} title={title} width="max-w-sm">
      <div className="p-6">
        <p className="text-sm text-text-secondary mb-5 leading-relaxed">{message}</p>
        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={() => { onConfirm(); onClose() }}>Confirm</Button>
        </div>
      </div>
    </Modal>
  )
}

export function StatCard({ label, value, sub, icon, onClick, accent=false }) {
  return (
    <div onClick={onClick}
      className={`relative rounded-2xl border overflow-hidden transition-all duration-200 cursor-pointer group
        ${accent ? 'border-amber-300 shadow-amber' : 'border-border bg-white shadow-card hover:shadow-card-hover hover:border-stone-300'}`}
      style={accent ? { background: 'linear-gradient(135deg,#fffbf0,#fff4d6 80%)' } : {}}>
      {accent && <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: 'linear-gradient(90deg,#ffbc38,#d4850a)' }} />}
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
