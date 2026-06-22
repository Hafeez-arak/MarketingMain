const PALETTE = {
  carbon:   '#1C2321',
  steel:    '#7D98A1',
  slate:    '#5E6572',
  powder:   '#A9B4C2',
  platinum: '#EEF1EF',
}

export function AuthLayout({ eyebrow, title, subtitle, children }) {
  return (
    <div className="min-h-screen flex" style={{ background: PALETTE.platinum }}>
      {/* Dark brand panel — hidden on small screens, the form is what matters there */}
      <div
        className="hidden lg:flex lg:w-[42%] flex-col justify-between p-12 relative overflow-hidden"
        style={{ background: PALETTE.carbon }}
      >
        <div
          className="absolute inset-0 opacity-40"
          style={{ background: `radial-gradient(circle at 20% 20%, ${PALETTE.slate} 0%, transparent 55%)` }}
        />
        <div
          className="absolute inset-0 opacity-30"
          style={{ background: `radial-gradient(circle at 85% 80%, ${PALETTE.steel} 0%, transparent 50%)` }}
        />

        <div className="relative z-10 flex items-center gap-2">
          <div className="w-2 h-6 rounded-full" style={{ background: `linear-gradient(180deg, ${PALETTE.steel}, ${PALETTE.slate})` }} />
          <span className="text-sm font-semibold tracking-[0.18em] uppercase" style={{ color: PALETTE.powder }}>
            CampAI
          </span>
        </div>

        <div className="relative z-10 max-w-sm">
          <p className="text-xs font-semibold tracking-[0.16em] uppercase mb-3" style={{ color: PALETTE.steel }}>
            Arak Content Studio
          </p>
          <h1 className="text-3xl font-bold leading-tight mb-4" style={{ color: PALETTE.platinum }}>
            One brand voice.<br />Every platform. Every workspace.
          </h1>
          <p className="text-sm leading-relaxed" style={{ color: PALETTE.powder }}>
            Brand Brain, Campaign Automation, and AI-generated content — now isolated
            per workspace so every team gets their own private brand profile and schedule.
          </p>
        </div>

        <p className="relative z-10 text-[11px]" style={{ color: PALETTE.slate }}>
          © {new Date().getFullYear()} Arak Lighting
        </p>
      </div>

      {/* Form panel */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            {eyebrow && (
              <p className="text-xs font-semibold tracking-[0.14em] uppercase mb-2" style={{ color: PALETTE.slate }}>
                {eyebrow}
              </p>
            )}
            <h2 className="text-2xl font-bold" style={{ color: PALETTE.carbon }}>{title}</h2>
            {subtitle && <p className="text-sm mt-1.5" style={{ color: PALETTE.slate }}>{subtitle}</p>}
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}

export function AuthInput({ label, error, ...props }) {
  return (
    <div className="mb-4">
      {label && (
        <label className="block text-xs font-semibold mb-1.5" style={{ color: PALETTE.slate }}>
          {label}
        </label>
      )}
      <input
        {...props}
        className="w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none transition-all duration-150 focus:ring-2"
        style={{
          borderColor: error ? '#fca5a5' : PALETTE.powder,
          color: PALETTE.carbon,
          background: '#fff',
          '--tw-ring-color': PALETTE.steel,
        }}
      />
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  )
}

export function AuthButton({ children, loading, ...props }) {
  return (
    <button
      {...props}
      disabled={loading || props.disabled}
      className="w-full rounded-xl py-2.5 text-sm font-semibold text-white transition-all duration-150 disabled:opacity-60 flex items-center justify-center gap-2"
      style={{ background: `linear-gradient(135deg, ${PALETTE.steel}, ${PALETTE.slate})` }}
    >
      {loading && <span className="w-3.5 h-3.5 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />}
      {children}
    </button>
  )
}

export { PALETTE }
