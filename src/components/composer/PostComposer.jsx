import FitImage from '../FitImage'
import { useMemo, useRef, useState } from 'react'
import { Button, Spinner, Skeleton } from '../ui/index'
import { PLATFORM_META } from '../../lib/utils'
import { formatsFor } from '../../lib/postFormats'
import {
  emptyComposer, setPlatform as setPlatformIn, captionStats,
  capabilities, validateComposer,
} from '../../lib/composerState'
import { mayPublishTo, protectionReason } from '../../lib/platformSafety'
import { MediaPicker } from './MediaPicker'
import { InstagramPanel, InstagramPreview } from './InstagramFields'
import { TikTokPanel, TikTokPreview } from './TikTokFields'
import { LinkedInPanel, LinkedInPreview } from './LinkedInFields'

// ─── Create a post ─────────────────────────────────────────────────────────
// Two columns: what you are writing on the left, what it will look like on the
// right. The split matters more than it sounds — a caption written against a
// blank textarea reads differently once it is under a 4:5 image with the
// username above it, and the whole point of a composer over a form is seeing
// that before it goes out.
//
// Deliberately NOT built here, because the platform APIs do not support them:
//   · Location tagging — Instagram's API does not expose it. Hootsuite offers
//     it because it also publishes some posts by pushing a notification to its
//     mobile app for a human to finish by hand; there is no equivalent here,
//     and a field that silently does nothing is worse than its absence.
//   · Publish via mobile notification — same reason: it needs a mobile app of
//     ours to push to.

const EMOJI = [
  '✨', '💡', '🔥', '👏', '❤️', '😍', '🙌', '🎉',
  '🏠', '🏗️', '🛋️', '🕯️', '🌙', '☀️', '📐', '🎨',
  '👇', '👉', '✅', '⭐', '📸', '🎬', '📍', '🔗',
]

function Section({ children, className = '' }) {
  return <div className={`px-6 py-5 border-b border-border ${className}`}>{children}</div>
}

function FieldLabel({ children, hint }) {
  return (
    <label className="block text-sm font-medium text-text mb-1.5">
      {children}
      {hint && <span className="font-normal text-text-tertiary"> {hint}</span>}
    </label>
  )
}

// ── Accounts ──────────────────────────────────────────────────────────────
// Chips rather than a plain multi-select, because "which account is this going
// out as" is the single most consequential choice on this screen and a
// collapsed select hides it behind a click.
function AccountPicker({ accounts, selected, onChange, platform, loading = false }) {
  const meta = PLATFORM_META[platform] || {}
  const usable = accounts.filter(a => a.is_active !== false)

  // Opened straight after the page loads, the list may not be in yet — and
  // "No account connected, connect one first" is not something to tell
  // someone whose account is connected.
  if (loading && usable.length === 0) {
    return <Skeleton className="h-9 w-40" />
  }

  if (usable.length === 0) {
    return (
      <p className="text-sm text-text-secondary">
        No {meta.label} account connected. Connect one on the {meta.label} page first.
      </p>
    )
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {usable.map(a => {
          const id = a.zernio_account_id
          const on = selected.includes(id)
          return (
            <button key={id} type="button"
              onClick={() => onChange(on ? selected.filter(x => x !== id) : [...selected, id])}
              className={`flex items-center gap-2 pl-1.5 pr-3 py-1.5 border transition-colors ${on ? 'border-amber-600 bg-amber-50' : 'border-border hover:bg-surface-subtle'}`}>
              {a.profile_picture
                ? <img src={a.profile_picture} alt="" className="w-6 h-6 rounded-full object-cover" />
                : <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${meta.bg} ${meta.text}`}>{meta.abbr}</span>}
              <span className={`text-sm ${on ? 'font-semibold text-amber-900' : 'text-text'}`}>
                {a.username ? `@${a.username}` : a.display_name || 'Account'}
              </span>
            </button>
          )
        })}
      </div>
      {selected.length > 0 && (
        <button type="button" onClick={() => onChange([])}
          className="text-xs text-text-tertiary hover:text-text mt-2">
          Clear accounts
        </button>
      )}
    </>
  )
}

// ── Media strip ───────────────────────────────────────────────────────────
function MediaStrip({ media, onRemove, onReorder }) {
  if (!media.length) return null
  return (
    <div className="flex flex-wrap gap-2 mb-3">
      {media.map((m, i) => (
        <div key={m.url + i} className="relative w-20 h-20 border border-border overflow-hidden group">
          {m.type === 'video'
            ? <video src={m.url} className="w-full h-full object-cover" muted playsInline preload="metadata" />
            : <FitImage src={m.url} alt="" className="w-full h-full object-cover" />}

          {media.length > 1 && (
            <span className="absolute top-0.5 left-0.5 w-4 h-4 bg-black/60 text-white text-[10px] font-bold flex items-center justify-center">
              {i + 1}
            </span>
          )}

          <div className="absolute inset-x-0 bottom-0 flex opacity-0 group-hover:opacity-100 transition-opacity">
            {i > 0 && (
              <button type="button" onClick={() => onReorder(i, i - 1)}
                className="flex-1 bg-black/70 text-white text-[11px] py-0.5" title="Move earlier">←</button>
            )}
            <button type="button" onClick={() => onRemove(i)}
              className="flex-1 bg-black/70 text-white text-[11px] py-0.5" title="Remove">✕</button>
            {i < media.length - 1 && (
              <button type="button" onClick={() => onReorder(i, i + 1)}
                className="flex-1 bg-black/70 text-white text-[11px] py-0.5" title="Move later">→</button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── The preview column ────────────────────────────────────────────────────
function PreviewColumn({ state, accounts }) {
  const account = accounts.find(a => a.zernio_account_id === state.accountIds[0]) || accounts[0] || {}
  const meta = PLATFORM_META[state.platform] || {}

  return (
    <div className="w-full lg:w-[420px] shrink-0 bg-surface-subtle border-l border-border overflow-y-auto">
      <div className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold ${meta.bg} ${meta.text}`}>
            {meta.abbr}
          </span>
          <h3 className="font-semibold text-text">{meta.label} Post</h3>
        </div>

        {state.platform === 'instagram' && <InstagramPreview state={state} account={account} />}
        {state.platform === 'tiktok'    && <TikTokPreview    state={state} account={account} />}
        {state.platform === 'linkedin'  && <LinkedInPreview  state={state} account={account} />}
        {!['instagram', 'tiktok', 'linkedin'].includes(state.platform) && (
          <p className="text-sm text-text-secondary">No preview for {meta.label} yet.</p>
        )}
      </div>
    </div>
  )
}

// ── Scheduling ────────────────────────────────────────────────────────────
// Times are in the BRAND's timezone, always. This used to be the browser's,
// which meant scheduling from a laptop outside KSA published at the wrong
// local hour — the times in a content plan have always meant Riyadh time.
function ScheduleRow({ value, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <input type="datetime-local" value={value}
        onChange={e => onChange(e.target.value)}
        className="border border-border px-3 py-2 text-sm bg-white text-text focus:outline-none focus:border-amber-600" />
      <span className="text-xs text-text-tertiary">Riyadh time</span>
    </div>
  )
}

// `variant="idea"` is the Campaign Planner's Pictures step, editing a
// plan_idea rather than a real, publishable post — this is deliberately the
// SAME screen rather than a second composer, so a caption written here and
// one written from the Instagram page never drift into two different UIs.
// What changes is only what an idea genuinely has no room for yet: which
// connected account it goes out as (decided when the plan is finalized, not
// here), a campaign, team-only tags, and any notion of drafting/scheduling/
// publishing right now. `onSaveIdea` replaces the whole draft/schedule/
// publish footer with one Save.
export function PostComposer({
  open, platform = 'instagram', accounts = [], accountsLoading = false, campaigns = [], workspaceId,
  initial, onClose, onSaveDraft, onSchedule, onPublish, busy = false,
  captionAssist, variant = 'post', onSaveIdea, onDesignInStudio, saveError,
}) {
  const isIdea = variant === 'idea'
  const [state, setState] = useState(() => ({ ...emptyComposer(platform), ...(initial || {}) }))
  const [picking, setPicking] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  const [showEmoji, setShowEmoji] = useState(false)
  const captionRef = useRef(null)
  const hashtagRef = useRef(null)

  const caps    = capabilities(state)
  const stats   = captionStats(state)
  const formats = formatsFor(state.platform)
  // Publish validation assumes a real account and an imminent send — neither
  // is true of an idea being shaped ahead of the Captions step, so it simply
  // doesn't run there.
  const check   = useMemo(() => (isIdea ? { errors: [], warnings: [], ok: true } : validateComposer(state)), [state, isIdea])
  const ownCaption = state.copyMode !== 'ai'

  if (!open) return null

  const patch  = updates => setState(s => ({ ...s, ...updates }))
  const platformAccounts = accounts.filter(a => a.platform === state.platform)
  const formatMedia = formats.find(f => f.id === state.format)?.media

  // ── Protected accounts ──
  // ARAK's LinkedIn is the company's real page and this product does not
  // publish to it. The refusal already exists in publishPost.js and again in
  // the n8n workflow; what it did NOT have was a way to be seen BEFORE the
  // button was pressed, so the only feedback was "Saved, but publishing
  // failed" after a row had already been written as pending_publish.
  //
  // Checked against the chosen account row where there is one, so an Instagram
  // account someone marks protected is covered too — not just the platform.
  // Falls back to the platform alone when nothing is chosen yet, which is what
  // makes the notice appear as soon as LinkedIn is selected.
  const chosen = platformAccounts.filter(a => state.accountIds.includes(a.zernio_account_id))
  const blocked = (chosen.length ? chosen : [{ platform: state.platform }])
    .find(a => !mayPublishTo(a))

  const insertEmoji = (emoji) => {
    const el = captionRef.current
    const at = el?.selectionStart ?? state.caption.length
    patch({ caption: state.caption.slice(0, at) + emoji + state.caption.slice(at) })
    setShowEmoji(false)
    queueMicrotask(() => { el?.focus(); el?.setSelectionRange(at + emoji.length, at + emoji.length) })
  }

  const addMedia = (picked) => {
    // A video format holds exactly one video, so a new pick REPLACES rather
    // than appends — appending would build a state validation then rejects and
    // make the user delete the old one to fix it.
    const single = formatMedia === 'video'
    patch({ media: single ? picked.slice(0, 1) : [...state.media, ...picked] })
  }

  const reorder = (from, to) => {
    const next = [...state.media]
    const [m] = next.splice(from, 1)
    next.splice(to, 0, m)
    patch({ media: next })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-stretch justify-center">
      <div className="bg-white w-full max-w-6xl my-0 sm:my-6 flex flex-col shadow-xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h2 className="text-lg font-semibold text-text">Create a post</h2>
          <button onClick={onClose} className="text-text-tertiary hover:text-text p-1" aria-label="Close">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 flex flex-col lg:flex-row min-h-0">
          <div className="flex-1 overflow-y-auto min-w-0">

            {!isIdea && (
              <Section>
                <FieldLabel hint="(optional)">Campaign</FieldLabel>
                <select value={state.campaignId} onChange={e => patch({ campaignId: e.target.value })}
                  className="w-full border border-border px-3 py-2 text-sm bg-white text-text focus:outline-none focus:border-amber-600">
                  <option value="">No campaign</option>
                  {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Section>
            )}

            {!isIdea && (
              <Section>
                <FieldLabel>Publish to</FieldLabel>
                <AccountPicker accounts={platformAccounts} selected={state.accountIds}
                  platform={state.platform} loading={accountsLoading}
                  onChange={ids => patch({ accountIds: ids })} />
              </Section>
            )}

            <Section>
              <div className="flex items-center justify-between mb-3">
                <div className="flex gap-1">
                  {Object.entries(PLATFORM_META).filter(([, m]) => m.status !== 'beta').map(([key, m]) => (
                    <button key={key} type="button"
                      onClick={() => setState(s => setPlatformIn(s, key))}
                      className={`px-3 py-1.5 text-xs font-semibold border transition-colors ${state.platform === key ? 'border-amber-600 bg-amber-50 text-amber-900' : 'border-border text-text-secondary hover:bg-surface-subtle'}`}>
                      {m.label}
                    </button>
                  ))}
                </div>
                <select value={state.format} onChange={e => patch({ format: e.target.value })}
                  className="border border-border px-2 py-1.5 text-sm bg-white text-text focus:outline-none focus:border-amber-600">
                  {formats.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                </select>
              </div>

              {/* Who writes it — an idea's caption may not exist yet, and
                  asking here is what lets "AI suggests 3" mean something: the
                  Captions step drafts those 3 from whichever picture this
                  popup ends up saving, so this choice has to be made before
                  that picture is even final. A real post being composed by
                  hand has no such later step, so the choice doesn't apply. */}
              {isIdea && (
                <div className="mb-3 border border-border p-3 space-y-2.5">
                  <p className="text-xs font-medium text-text-secondary">Who writes the caption?</p>
                  <div className="flex gap-2">
                    {[
                      { id: 'ai',  label: 'AI suggests 3', hint: 'Written from the picture, once it’s ready — you pick one' },
                      { id: 'own', label: "I'll write it",  hint: 'Posted exactly as typed' },
                    ].map(o => (
                      <button key={o.id} type="button" onClick={() => patch({ copyMode: o.id })}
                        className={`flex-1 text-left px-3 py-2 border transition-all ${
                          ownCaption === (o.id === 'own')
                            ? 'bg-amber-600 text-white border-amber-600'
                            : 'bg-white border-border text-text-secondary hover:border-amber-400'}`}>
                        <span className="block text-sm font-medium">{o.label}</span>
                        <span className={`block text-[10px] leading-snug mt-0.5 ${ownCaption === (o.id === 'own') ? 'opacity-80' : 'text-text-tertiary'}`}>{o.hint}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {(!isIdea || ownCaption) && (
                <>
                  <textarea ref={captionRef} rows={isIdea ? 4 : 6} value={state.caption}
                    onChange={e => patch({ caption: e.target.value })}
                    placeholder="Write your caption, then customise it for each platform"
                    className="w-full border border-border px-3 py-2 text-sm bg-white text-text resize-y focus:outline-none focus:border-amber-600" />

                  {/* Arabic gets its own box rather than being detected from
                      the text: brands here post bilingually, and folding both
                      into one field would force a choice publishing doesn't
                      make. Idea-only — a real post's composer has never had a
                      language split, and adding one is a bigger change than
                      this popup is for. */}
                  {isIdea && (
                    <textarea rows={3} dir="rtl" value={state.captionAr || ''}
                      onChange={e => patch({ captionAr: e.target.value })}
                      placeholder="النص العربي (اختياري)"
                      className="w-full mt-2 border border-border px-3 py-2 text-sm bg-white text-text resize-y focus:outline-none focus:border-amber-600" />
                  )}

                  <div className="flex items-center justify-between mt-1.5 relative">
                    <span className={`text-xs ${stats.over ? 'text-red-600 font-semibold' : 'text-text-tertiary'}`}>
                      {stats.used.toLocaleString()} / {stats.limit.toLocaleString()}
                    </span>
                    <div className="flex items-center gap-3">
                      {captionAssist && (
                        <button type="button" onClick={captionAssist}
                          className="text-xs text-text-secondary hover:text-amber-700 flex items-center gap-1">
                          <span aria-hidden>✨</span> Enhance with AI
                        </button>
                      )}
                      <button type="button" onClick={() => setShowEmoji(v => !v)}
                        className="text-text-tertiary hover:text-text" aria-label="Insert emoji">☺</button>
                      <button type="button" onClick={() => hashtagRef.current?.focus()}
                        className="text-text-tertiary hover:text-text font-semibold" aria-label="Hashtags">#</button>
                    </div>

                    {showEmoji && (
                      <div className="absolute right-0 top-6 z-10 bg-white border border-border shadow-lg p-2 grid grid-cols-8 gap-1 w-64">
                        {EMOJI.map(e => (
                          <button key={e} type="button" onClick={() => insertEmoji(e)}
                            className="text-lg hover:bg-surface-subtle rounded">{e}</button>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              {isIdea && !ownCaption && (
                <p className="text-xs text-text-tertiary border border-dashed border-border px-3 py-2.5">
                  AI will draft 3 captions from the picture once it's ready — pick one (or edit it) on the Captions step.
                </p>
              )}

              <div className="mt-3">
                <FieldLabel hint="counted toward the caption limit">Hashtags</FieldLabel>
                <input ref={hashtagRef} value={state.hashtags}
                  onChange={e => patch({ hashtags: e.target.value })}
                  placeholder="#arak #lighting #riyadh"
                  className="w-full border border-border px-3 py-2 text-sm bg-white text-text focus:outline-none focus:border-amber-600" />
              </div>

              {/* Hidden entirely on a format that carries no media — LinkedIn's
                  text post and its poll. An "Add media" button on a poll offers
                  something the platform refuses outright, and the validator
                  would then have to explain why the thing it just offered is an
                  error. */}
              {formatMedia !== 'none' && (
                <div className="mt-4 pt-4 border-t border-border">
                  <MediaStrip media={state.media}
                    onRemove={i => patch({ media: state.media.filter((_, x) => x !== i) })}
                    onReorder={reorder} />
                  <Button variant="outline" size="sm" onClick={() => setPicking(true)}>
                    {state.media.length ? 'Add more media' : 'Add media'}
                  </Button>
                </div>
              )}
            </Section>

            {state.platform === 'instagram' && (
              <InstagramPanel state={state} setState={setState} caps={caps}
                account={platformAccounts.find(a => a.zernio_account_id === state.accountIds[0])}
                workspaceId={workspaceId} />
            )}
            {state.platform === 'tiktok' && (
              <TikTokPanel state={state} setState={setState} caps={caps}
                accountId={state.accountIds[0]} />
            )}
            {state.platform === 'linkedin' && (
              <LinkedInPanel state={state} setState={setState} caps={caps} />
            )}

            {!isIdea && (
              <Section className="border-b-0">
                <FieldLabel hint="(optional) — only your team sees these">Tags</FieldLabel>
                <input
                  value={state.tags.join(', ')}
                  onChange={e => patch({ tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) })}
                  placeholder="ramadan, product-launch"
                  className="w-full border border-border px-3 py-2 text-sm bg-white text-text focus:outline-none focus:border-amber-600" />
              </Section>
            )}
          </div>

          <PreviewColumn state={state} accounts={platformAccounts} />
        </div>

        {/* Footer */}
        <div className="border-t border-border px-6 py-4 shrink-0 bg-white">
          {!isIdea && blocked && (
            <div className="mb-3 border border-amber-300 bg-amber-50 px-3 py-2.5">
              <p className="text-xs font-semibold text-amber-900 mb-0.5">Drafts only</p>
              <p className="text-xs text-amber-800">{protectionReason(blocked)}</p>
            </div>
          )}

          {!isIdea && (check.errors.length > 0 || check.warnings.length > 0) && (
            <div className="mb-3 space-y-1">
              {check.errors.map((e, i) => <p key={i} className="text-xs text-red-600">{e}</p>)}
              {check.warnings.map((w, i) => <p key={i} className="text-xs text-amber-700">{w}</p>)}
            </div>
          )}

          {!isIdea && scheduling && (
            <div className="mb-3">
              <ScheduleRow value={state.scheduledFor} onChange={v => patch({ scheduledFor: v })} />
            </div>
          )}

          {isIdea && saveError && <p className="mb-3 text-xs text-red-600">{saveError}</p>}

          {isIdea ? (
            <div className="flex items-center justify-end gap-2 flex-wrap">
              <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>Cancel</Button>
              <Button variant="primary" size="sm"
                disabled={busy || (ownCaption && !(state.caption || '').trim() && !(state.captionAr || '').trim())}
                onClick={() => onSaveIdea?.(state)}>
                {busy ? <Spinner size="sm" /> : 'Save'}
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-2 flex-wrap">
              <Button variant="ghost" size="sm" disabled={busy}
                onClick={() => onSaveDraft?.(state)}>
                Save as draft
              </Button>

              {/* Scheduling is a publish with a delay, so it is refused on a
                  protected account for the same reason Post now is. Save as
                  draft stays available deliberately: composing and reviewing a
                  LinkedIn post is the whole point of this screen — only reaching
                  the platform is off. */}
              {!scheduling ? (
                <Button variant="secondary" size="sm" disabled={busy || !!blocked}
                  onClick={() => setScheduling(true)}>
                  Schedule for later
                </Button>
              ) : (
                <Button variant="secondary" size="sm"
                  disabled={busy || !!blocked || !check.ok || !state.scheduledFor}
                  onClick={() => onSchedule?.(state)}>
                  {busy ? <Spinner size="sm" /> : 'Confirm schedule'}
                </Button>
              )}

              <Button variant="primary" size="sm" disabled={busy || !!blocked || !check.ok}
                onClick={() => onPublish?.(state)}>
                {busy ? <Spinner size="sm" /> : 'Post now'}
              </Button>
            </div>
          )}
        </div>
      </div>

      <MediaPicker
        open={picking}
        onClose={() => setPicking(false)}
        onSelect={addMedia}
        multiple={caps.carousel}
        kind={formatMedia === 'video' ? 'video' : 'all'}
        onDesignInStudio={onDesignInStudio}
      />
    </div>
  )
}
