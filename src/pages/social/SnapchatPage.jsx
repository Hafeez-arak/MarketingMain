import { Card } from '../../components/ui/index'
import { PLATFORM_META } from '../../lib/utils'
import { formatsFor } from '../../lib/postFormats'

// ─── Snapchat — not yet ────────────────────────────────────────────────────
// A real page rather than a hidden route, because "why is Snapchat missing?"
// is a question someone will ask, and a page that answers it costs less than
// answering it repeatedly.
//
// Nothing here calls Zernio. Snapchat is status:'beta' in PLATFORM_META, which
// keeps it out of LIVE_PLATFORMS; the Connect workflow refuses it server-side
// too, so there is no path from this screen to a half-finished connection.
//
// What it deliberately DOES do is state the shape of the eventual thing —
// formats come from the same FORMAT_CATALOG the other platforms use, so if
// Snapchat's formats change before it ships, this page changes with them
// instead of quietly becoming a lie.

const META = PLATFORM_META.snapchat

function GhostIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-7 h-7" fill="currentColor" aria-hidden="true">
      <path d="M12 2c3.1 0 5 2.2 5 5.2 0 .8-.05 1.5-.1 2.1.5.25.9.2 1.3.05.5-.2 1.1.05 1.2.6.1.5-.25.9-.9 1.15-.7.25-1.6.6-1.75 1.1-.1.35.05.7.3 1.15.6 1.05 1.6 2 3 2.4.4.1.55.5.35.85-.35.6-1.5.95-2.75 1.15-.15.35-.2.75-.3 1.05-.1.35-.35.5-.75.4-.45-.1-1-.2-1.75-.2-1.15 0-1.7.3-2.4.8-.75.5-1.4.95-2.45.95s-1.7-.45-2.45-.95c-.7-.5-1.25-.8-2.4-.8-.75 0-1.3.1-1.75.2-.4.1-.65-.05-.75-.4-.1-.3-.15-.7-.3-1.05-1.25-.2-2.4-.55-2.75-1.15-.2-.35-.05-.75.35-.85 1.4-.4 2.4-1.35 3-2.4.25-.45.4-.8.3-1.15-.15-.5-1.05-.85-1.75-1.1-.65-.25-1-.65-.9-1.15.1-.55.7-.8 1.2-.6.4.15.8.2 1.3-.05-.05-.6-.1-1.3-.1-2.1C7 4.2 8.9 2 12 2z" />
    </svg>
  )
}

export function SnapchatPage() {
  const formats = formatsFor('snapchat')

  return (
    <div className="max-w-3xl space-y-5">
      <Card className="overflow-hidden">
        <div className="h-1" style={{ background: META.color }} />
        <div className="p-8 text-center">
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl flex items-center justify-center bg-yellow-50 text-yellow-600">
            <GhostIcon />
          </div>

          <span className="inline-block text-[10px] font-bold uppercase tracking-[0.08em] px-2 py-0.5 leading-[1.4] bg-amber-50 text-amber-700 mb-3">
            Coming soon
          </span>

          <h2 className="text-lg font-semibold text-text mb-2">Snapchat is not connected yet</h2>
          <p className="text-sm text-text-secondary max-w-md mx-auto">
            Snapchat publishing is still in beta at our API provider, so it is not wired up.
            Instagram and TikTok are live and publish through the same pipeline — when
            Snapchat leaves beta it joins them without anything else changing.
          </p>
        </div>

        <div className="border-t border-border px-8 py-6">
          <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-text-tertiary mb-3">
            What it will support
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {formats.map(f => (
              <div key={f.id} className="flex items-center gap-3 p-3 border border-border">
                <span className="w-8 h-8 flex items-center justify-center bg-surface-subtle text-text-secondary text-[10px] font-bold uppercase">
                  {f.media === 'video' ? 'Vid' : 'Img'}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text">{f.label}</p>
                  <p className="text-xs text-text-tertiary">{f.defaultRatio} vertical</p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-text-tertiary mt-4">
            Captions on Snapchat are capped at {META.maxChars} characters — considerably
            shorter than Instagram and TikTok, so plans that fan out to all three will
            need a Snapchat-length variant rather than the same caption three times.
          </p>
        </div>
      </Card>
    </div>
  )
}
