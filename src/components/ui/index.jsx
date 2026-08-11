import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { STATUS_META, PLATFORM_META } from '../../lib/utils'

/* ─── Arak UI kit ───────────────────────────────────────────────────────────
   One design language, enforced here so pages don't each invent their own.

   The rules:
   · Square corners. Not "small radius" — zero. The radius scale in
     tailwind.config.js resolves every rounded-* class to 0px, so a component
     can't opt back into a pill by accident. Circles are reserved for things
     that are actually circular: Avatar, Spinner, status dots.
   · Structure comes from 1px rules, never from elevation. Only surfaces that
     genuinely float above the page (Modal, dropdowns) carry a shadow.
   · One accent. Solid steel (amber-700 #4c5e61) marks the primary action on a
     screen; everything else is white, border, and ink.
   · Controls share a border on every variant — including a transparent one on
     the borderless variants — so a row of mixed buttons lines up on the same
     baseline instead of the ghost ones sitting 2px short.

   The `square` prop that several of these used to take is now the only
   behavior, so it does nothing. It's still accepted (and swallowed before the
   DOM spread) because ~50 call sites pass it, and a stray square="true" on an
   <input> is a React warning in the console.
──────────────────────────────────────────────────────────────────────────── */

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 focus-visible:ring-offset-1 focus-visible:ring-offset-white'

export function Button({ variant='primary', size='md', children, onClick, disabled, type='button', className='', square }) {
  void square
  const base = `inline-flex items-center justify-center gap-2 font-semibold border transition-colors duration-150 cursor-pointer disabled:opacity-40 disabled:pointer-events-none ${FOCUS}`
  // Vertical padding is tuned per size so every variant lands on an exact
  // pixel height (28/32/38/44) — square corners make a half-pixel mismatch
  // between two adjacent buttons obvious in a way rounded ones hide.
  const sizes = {
    xs:'px-2.5 py-1 text-[11px] tracking-wide',
    sm:'px-3 py-1.5 text-xs',
    md:'px-4 py-2 text-sm',
    lg:'px-6 py-2.5 text-sm',
  }
  const variants = {
    primary:   'bg-amber-700 text-white border-amber-700 hover:bg-amber-800 hover:border-amber-800 active:bg-amber-900',
    secondary: 'bg-white text-text border-border hover:border-stone-400 hover:bg-surface-subtle active:bg-surface-muted',
    ghost:     'bg-transparent text-text-secondary border-transparent hover:bg-surface-subtle hover:text-text',
    danger:    'bg-white text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300',
    clay:      'bg-clay-700 text-white border-clay-700 hover:bg-clay-800 hover:border-clay-800',
    outline:   'bg-white text-text border-stone-400 hover:bg-amber-50 hover:border-amber-700 hover:text-amber-800',
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}>
      {children}
    </button>
  )
}

// Status is a typed label, not a lozenge. Uppercase at 10px with tracking is
// what keeps a square chip from reading as a tiny disabled button.
export function Badge({ status, children, className='' }) {
  const cfg = STATUS_META[status]
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] leading-[1.4] whitespace-nowrap
      ${cfg ? cfg.classes : 'bg-stone-100 text-stone-600'} ${className}`}>
      {cfg ? cfg.label : children}
    </span>
  )
}

// Squared off, and the platform's own color now shows as a 2px left marker
// rather than tinting the whole chip — five of these in a row used to make a
// list look like a bag of candy.
export function PlatformPill({ platform }) {
  const m = PLATFORM_META[platform]
  if (!m) return null
  return (
    <span className={`inline-flex items-center gap-1.5 pl-1.5 pr-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] leading-[1.4]
      bg-surface-subtle text-text-secondary border-l-2 whitespace-nowrap`}
      style={{ borderLeftColor: m.color }}>
      {m.label}
    </span>
  )
}

export function Card({ children, className='', onClick, hover=false, square }) {
  void square
  return (
    <div onClick={onClick}
      className={`bg-white border border-border
        ${hover ? 'cursor-pointer hover:border-stone-400 transition-colors duration-150' : ''}
        ${className}`}>
      {children}
    </div>
  )
}

// The "highlighted" card: a flat tinted panel with a solid accent rule down
// the left edge. Replaces the old three-stop cream gradient, which was the
// only warm surface left in a cool-grey app.
export function WarmCard({ children, className='' }) {
  return (
    <div className={`bg-amber-50 border border-amber-200 border-l-2 border-l-amber-700 ${className}`}>
      {children}
    </div>
  )
}

// Keep GoldCard as alias for WarmCard for compatibility
export function GoldCard({ children, className='' }) {
  return <WarmCard className={className}>{children}</WarmCard>
}

// The page title block. Every page used to hand-roll this, which is how the
// app ended up with three different H1 sizes and two different fonts for the
// same job. Sits above the page's content and closes with a full-width rule,
// so the header reads as a band rather than as floating text.
export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="flex items-end justify-between gap-4 flex-wrap pb-4 border-b border-border">
      <div className="min-w-0">
        <h1 className="text-lg font-bold text-text tracking-tight leading-none">{title}</h1>
        {subtitle && <p className="text-xs text-text-secondary mt-2 leading-relaxed">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2 flex-shrink-0">{children}</div>}
    </div>
  )
}

export function SectionHead({ title, subtitle, action }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-border">
      <div className="min-w-0">
        <h3 className="font-semibold text-text text-sm leading-tight">{title}</h3>
        {subtitle && <p className="text-xs text-text-tertiary mt-1">{subtitle}</p>}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  )
}

/* Fields. A 1px ring drawn tight to a square edge reads as the border
   thickening; the old 2px blurred halo with a transparent border made the
   field look like it had grown, and left a rounded glow around a sharp box. */
const fieldBase = `w-full border border-border bg-white text-text placeholder-text-tertiary text-sm
  transition-colors duration-150 focus:outline-none focus:border-amber-700 focus:ring-1 focus:ring-amber-700`

export function Input({ label, hint, error, className='', square, ...props }) {
  void square
  return (
    <div className={className}>
      {label && <label className="block eyebrow mb-1.5">{label}</label>}
      <input {...props} className={`${fieldBase} px-3 py-2 ${error ? 'border-red-400 focus:border-red-500 focus:ring-red-500' : ''}`} />
      {hint && !error && <p className="text-xs text-text-tertiary mt-1.5">{hint}</p>}
      {error && <p className="text-xs text-red-600 mt-1.5">{error}</p>}
    </div>
  )
}

// autoGrow is opt-in (default off) so every other form using this component
// keeps its fixed height — only a chat-style prompt box wants the Claude/
// ChatGPT behavior of expanding as you type instead of scrolling internally
// right away. `rows` still sets the minimum height either way.
export function Textarea({ label, hint, error, className='', rows=4, autoGrow=false, maxHeight=260, value, square, ...props }) {
  void square
  const ref = useRef(null)
  useEffect(() => {
    if (!autoGrow || !ref.current) return
    const el = ref.current
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, maxHeight) + 'px'
  }, [autoGrow, value, maxHeight])

  return (
    <div className={className}>
      {label && <label className="block eyebrow mb-1.5">{label}</label>}
      <textarea {...props} ref={ref} value={value} rows={rows}
        className={`${fieldBase} px-3 py-2 resize-none ${autoGrow ? 'overflow-y-auto' : ''} ${error ? 'border-red-400 focus:border-red-500 focus:ring-red-500' : ''}`} />
      {hint && !error && <p className="text-xs text-text-tertiary mt-1.5">{hint}</p>}
      {error && <p className="text-xs text-red-600 mt-1.5">{error}</p>}
    </div>
  )
}

// The native select arrow is drawn with the platform's own radius and sits in
// its own inset box; suppressing it and drawing a flat chevron keeps the
// control square on Safari and Chrome alike.
export function Select({ label, hint, error, className='', children, square, ...props }) {
  void square
  return (
    <div className={className}>
      {label && <label className="block eyebrow mb-1.5">{label}</label>}
      <div className="relative">
        <select {...props} className={`${fieldBase} appearance-none pl-3 pr-9 py-2 cursor-pointer ${error ? 'border-red-400' : ''}`}>
          {children}
        </select>
        <svg className="w-3.5 h-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none"
          fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
      </div>
      {hint && !error && <p className="text-xs text-text-tertiary mt-1.5">{hint}</p>}
      {error && <p className="text-xs text-red-600 mt-1.5">{error}</p>}
    </div>
  )
}

export function Modal({ open, onClose, title, children, width='max-w-lg', square }) {
  void square
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
      style={{ background: 'rgba(28,35,33,0.45)' }}>
      {/* The one place elevation survives: a modal must read as detached from
          the page behind it, and there is no rule to do that job here. */}
      <div className={`bg-white shadow-dropdown w-full ${width} max-h-[90vh] flex flex-col animate-fade-scale border border-border`}>
        <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-border flex-shrink-0">
          <h2 className="font-semibold text-text text-sm">{title}</h2>
          <button onClick={onClose} aria-label="Close"
            className={`w-7 h-7 flex items-center justify-center text-text-tertiary border border-transparent hover:border-border hover:text-text transition-colors ${FOCUS}`}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="overflow-y-auto flex-1 scrollbar-thin">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

// The icon no longer floats — a drifting element in an empty state draws the
// eye away from the action that's meant to resolve it.
export function Empty({ icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 px-8 text-center">
      <div className="w-11 h-11 border border-border bg-surface-subtle flex items-center justify-center mb-4 text-text-tertiary">{icon}</div>
      <h3 className="font-semibold text-text text-sm mb-1.5">{title}</h3>
      <p className="text-xs text-text-secondary max-w-xs mb-5 leading-relaxed">{description}</p>
      {action}
    </div>
  )
}

// Round on purpose — an avatar is a portrait slot, and squaring it turns a
// list of people into a list of files.
const avColors = ['bg-amber-100 text-amber-800','bg-clay-100 text-clay-800','bg-sage-100 text-sage-800','bg-stone-100 text-stone-800','bg-sky-100 text-sky-800','bg-purple-100 text-purple-800']
export function Avatar({ name='?', size='md', color }) {
  const initials = name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()
  const c = color || avColors[name.charCodeAt(0) % avColors.length]
  const sizes = { xs:'w-6 h-6 text-[10px]', sm:'w-7 h-7 text-xs', md:'w-8 h-8 text-xs', lg:'w-10 h-10 text-sm', xl:'w-12 h-12 text-base' }
  return <div className={`${sizes[size]} rounded-full flex items-center justify-center font-bold flex-shrink-0 ${c}`}>{initials}</div>
}

// Also round on purpose — it spins.
export function Spinner({ size='md' }) {
  const sizes = { sm:'w-3 h-3 border-[1.5px]', md:'w-4 h-4 border-2', lg:'w-6 h-6 border-2' }
  return <div className={`${sizes[size]} border-current border-t-transparent rounded-full animate-spin`} />
}

// A square switch: the knob is a filled block that slides between two ends of
// a bordered track. Reads as a physical two-position selector rather than the
// soft iOS pill, which is the only shape in the app that couldn't be squared
// without becoming ambiguous — solved by keeping the travel visible.
export function Toggle({ checked, onChange, label }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer group">
      <div className="relative flex-shrink-0">
        <input type="checkbox" checked={checked} onChange={onChange} className="sr-only peer" />
        <div className={`w-9 h-5 border transition-colors duration-150 peer-focus-visible:ring-2 peer-focus-visible:ring-amber-700 peer-focus-visible:ring-offset-1
          ${checked ? 'bg-amber-700 border-amber-700' : 'bg-white border-stone-400 group-hover:border-stone-500'}`} />
        <div className={`absolute top-1 w-3 h-3 transition-all duration-150
          ${checked ? 'left-[21px] bg-white' : 'left-1 bg-stone-400 group-hover:bg-stone-500'}`} />
      </div>
      {label && <span className="text-sm text-text-secondary group-hover:text-text transition-colors">{label}</span>}
    </label>
  )
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, danger=false, square }) {
  void square
  return (
    <Modal open={open} onClose={onClose} title={title} width="max-w-sm">
      <div className="p-5">
        <p className="text-sm text-text-secondary mb-5 leading-relaxed">{message}</p>
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={() => { onConfirm(); onClose() }}>Confirm</Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Shared structural primitives ─────────────────────────────────────────
// A small icon block in front of section titles, a compact select that sits
// inline with a heading, and the KPI tile. Pages should reach for these
// instead of re-inventing a badge/select each time — that re-invention is how
// the app ended up with four different card treatments before this pass.

const BADGE_TONES = {
  steel: 'bg-amber-50 text-amber-700 border-amber-200',
  sage:  'bg-sage-50 text-sage-700 border-sage-200',
  rose:  'bg-rose-50 text-rose-600 border-rose-200',
}
export function IconBadge({ children, tone = 'steel' }) {
  return (
    <span className={`w-7 h-7 border flex items-center justify-center flex-shrink-0 ${BADGE_TONES[tone] || BADGE_TONES.steel}`}>
      {children}
    </span>
  )
}

// Named PillSelect for its call sites; it is not a pill any more. Sized to sit
// on the same line as a card title without pushing the header taller.
export function PillSelect({ value, onChange, className = '', children }) {
  return (
    <div className={`relative inline-flex ${className}`}>
      <select value={value} onChange={onChange}
        className={`appearance-none w-full bg-white border border-border text-xs font-medium text-text-secondary pl-2.5 pr-7 py-1.5
          cursor-pointer hover:border-stone-400 hover:text-text transition-colors ${FOCUS}`}>
        {children}
      </select>
      <svg className="w-3 h-3 absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
    </div>
  )
}

// The metric tile. Label above number, left-aligned, no icon chrome and no
// hover lift — these appear five-across in a divided strip, where anything
// decorative repeats five times and turns the strip into noise. `accent`
// marks the one tile that matters with a solid rule across its top edge.
export function StatCard({ label, value, sub, icon, onClick, accent=false }) {
  return (
    <div onClick={onClick}
      className={`relative border bg-white p-4 transition-colors duration-150
        ${onClick ? 'cursor-pointer hover:bg-surface-subtle' : ''}
        ${accent ? 'border-amber-300' : 'border-border'}`}>
      {accent && <div className="absolute top-0 left-0 right-0 h-0.5 bg-amber-700" />}
      <div className="flex items-center gap-1.5 mb-2">
        {icon && <span className="text-text-tertiary flex-shrink-0">{icon}</span>}
        <p className="eyebrow truncate">{label}</p>
      </div>
      <p className={`text-2xl font-bold leading-none tabular-nums ${accent ? 'text-amber-800' : 'text-text'}`}>{value}</p>
      {sub && <p className="text-xs text-text-tertiary mt-1.5">{sub}</p>}
    </div>
  )
}

/* ─── PostImage ─────────────────────────────────────────────────────────────
   Drop-in <img> replacement that handles expired Replicate URLs gracefully.
   Shows a placeholder with a camera icon whenever src is missing, is a
   replicate.delivery URL (likely expired), or the image fails to load.
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

  // Reset when src changes (e.g. after regen). Adjusted DURING RENDER rather
  // than in an effect: React discards the in-progress output and re-renders
  // immediately, so the new image never gets a frame showing the old one's
  // failure state. An effect would paint the stale value first and then
  // correct it — which is the flash of a broken-image placeholder on an image
  // that is perfectly fine.
  const [renderedSrc, setRenderedSrc] = useState(src)
  if (src !== renderedSrc) {
    setRenderedSrc(src)
    setFailed(isLikelyExpired(src))
  }

  if (failed) {
    return (
      <div
        className={`flex items-center justify-center bg-surface-subtle border border-border ${className}`}
        style={style}
        {...rest}
      >
        <svg className="w-5 h-5 text-text-disabled" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <rect x="3" y="3" width="18" height="18"/>
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
