import { Toggle } from '../ui/index'
import { optionsFor, setOption, composedCaption, capabilities } from '../../lib/composerState'
import { limitsFor } from '../../lib/postFormats'

// ─── LinkedIn: the panel and the feed preview ──────────────────────────────
// LinkedIn is the platform in this composer where a post with NO media is the
// normal case rather than a broken one, and most of what is distinctive about
// it follows from that:
//
//   · The body is the post. 3,000 characters, but the feed cuts to about 210
//     before "…see more", so where that line falls decides whether anyone
//     reads the rest. The preview draws it.
//   · A link in a text post becomes a preview card automatically. Attaching
//     media replaces the card, which is why the toggle only appears on a text
//     post — on any other format it could not do anything.
//   · Polls are their own post type: 2–4 answers, and NOT editable after
//     publishing. A typo in an answer is permanent, so the rules are enforced
//     here rather than discovered later.
//
// Deliberately NOT built here, for the same reason the composer's header gives
// for location tagging — a field that silently does nothing is worse than its
// absence:
//   · @mentions. LinkedIn has no mention field; Zernio resolves a profile URL
//     to a URN that you paste into the body yourself. A box that only
//     rewrote text would imply tagging that is not happening.
//   · Document (PDF) posts and resharing someone else's post. Both are real
//     LinkedIn post types Zernio supports, and neither has anywhere to live in
//     this app's post row — see FORMAT_CATALOG.

const POLL_DURATIONS = [
  ['ONE_DAY', '1 day'],
  ['THREE_DAYS', '3 days'],
  ['SEVEN_DAYS', '1 week'],
  ['FOURTEEN_DAYS', '2 weeks'],
]

// What LinkedIn shows before "…see more" in the desktop feed. Approximate by
// nature — the real cut is three rendered lines, so a post of short lines
// breaks earlier — but the character count is the part a writer can act on.
const SEE_MORE_AT = 210

function Section({ children }) {
  return <div className="px-6 py-5 border-b border-border">{children}</div>
}

function FieldLabel({ children, hint }) {
  return (
    <label className="block text-sm font-medium text-text mb-1.5">
      {children}
      {hint && <span className="font-normal text-text-tertiary"> {hint}</span>}
    </label>
  )
}

// ── Poll editor ───────────────────────────────────────────────────────────
// Answers are held as a fixed-length array rather than pushed and popped, so
// typing in the third box does not depend on the second one existing yet.
function PollEditor({ poll, onChange }) {
  const lim = limitsFor('linkedin').poll
  const options = poll.options || ['', '']

  const setOptionAt = (i, value) => {
    const next = [...options]
    next[i] = value
    onChange({ ...poll, options: next })
  }

  return (
    <>
      <FieldLabel hint={`${(poll.question || '').length}/${lim.questionMax}`}>Question</FieldLabel>
      <input value={poll.question || ''} maxLength={lim.questionMax}
        onChange={e => onChange({ ...poll, question: e.target.value })}
        placeholder="What matters most when you specify lighting?"
        className="w-full border border-border px-3 py-2 text-sm bg-white text-text focus:outline-none focus:border-amber-600" />

      <div className="mt-3 space-y-2">
        {options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2">
            <input value={opt} maxLength={lim.optionMax}
              onChange={e => setOptionAt(i, e.target.value)}
              placeholder={`Answer ${i + 1}${i < lim.minOptions ? '' : ' (optional)'}`}
              className="flex-1 border border-border px-3 py-2 text-sm bg-white text-text focus:outline-none focus:border-amber-600" />
            <span className="text-xs text-text-tertiary w-10 text-right">{opt.length}/{lim.optionMax}</span>
            {options.length > lim.minOptions && (
              <button type="button" title="Remove this answer"
                onClick={() => onChange({ ...poll, options: options.filter((_, x) => x !== i) })}
                className="text-text-tertiary hover:text-text px-1">✕</button>
            )}
          </div>
        ))}
      </div>

      {options.length < lim.maxOptions && (
        <button type="button" onClick={() => onChange({ ...poll, options: [...options, ''] })}
          className="text-xs text-amber-700 hover:underline mt-2">
          Add an answer
        </button>
      )}

      <div className="mt-4">
        <FieldLabel>Poll runs for</FieldLabel>
        <select value={poll.duration || 'SEVEN_DAYS'}
          onChange={e => onChange({ ...poll, duration: e.target.value })}
          className="border border-border px-3 py-2 text-sm bg-white text-text focus:outline-none focus:border-amber-600">
          {POLL_DURATIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>

      <p className="text-xs text-text-tertiary mt-3">
        LinkedIn cannot edit a poll once it is published — not the question, not the
        answers. Polls created through an API are also non-sponsored, so this one
        could not be promoted as an ad later.
      </p>
    </>
  )
}

export function LinkedInPanel({ state, setState, caps }) {
  const opts = optionsFor(state)
  const set  = (key, value) => setState(s => setOption(s, key, value))

  return (
    <>
      {caps.poll && (
        <Section>
          <PollEditor
            poll={opts.poll || { question: '', options: ['', ''], duration: 'SEVEN_DAYS' }}
            onChange={poll => set('poll', poll)} />
        </Section>
      )}

      {caps.linkPreview && (
        <Section>
          <Toggle
            checked={opts.disableLinkPreview !== true}
            onChange={v => set('disableLinkPreview', !v)}
            label="Show a link preview" />
          <p className="text-xs text-text-tertiary mt-2">
            LinkedIn builds a preview card from the first link in the text. Turning it
            off leaves the URL as plain text. Attaching an image or video replaces the
            card either way, which is why this only appears on a text post.
          </p>
        </Section>
      )}

      {caps.altText && (
        <Section>
          <FieldLabel hint="(optional)">Alt text</FieldLabel>
          <input value={opts.altText || ''}
            onChange={e => set('altText', e.target.value)}
            placeholder="A lit villa facade at dusk, warm light along the soffit"
            className="w-full border border-border px-3 py-2 text-sm bg-white text-text focus:outline-none focus:border-amber-600" />
          <p className="text-xs text-text-tertiary mt-1.5">
            Read aloud by screen readers. One description covers the whole post.
          </p>
        </Section>
      )}

      <Section>
        <FieldLabel hint="(optional) — posted right after the post goes live">First comment</FieldLabel>
        <textarea rows={3} value={opts.firstComment || ''}
          onChange={e => set('firstComment', e.target.value)}
          placeholder="Full project details: arak-sa.com/…"
          className="w-full border border-border px-3 py-2 text-sm bg-white text-text resize-y focus:outline-none focus:border-amber-600" />
        <p className="text-xs text-text-tertiary mt-1.5">
          Where a link usually goes. LinkedIn shows posts that keep people on the
          platform to more of them, so the body stays link-free and the URL goes here.
        </p>
      </Section>
    </>
  )
}

// ── Live preview ──────────────────────────────────────────────────────────
// A feed card rather than a phone frame: LinkedIn is read on a desktop
// timeline, and the thing worth seeing is where the text is cut off, not how
// it sits under a status bar.
function PreviewMedia({ media }) {
  if (!media.length) return null

  const first = media[0]
  if (first.type === 'video') {
    return (
      <div className="relative bg-stone-900 aspect-video">
        <video src={`${first.url}#t=0.1`} className="w-full h-full object-cover"
          muted playsInline preload="metadata" />
        <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="w-9 h-9 rounded-full bg-black/55 text-white text-xs flex items-center justify-center">▶</span>
        </span>
      </div>
    )
  }

  // LinkedIn's own multi-image treatment: one fills the width, two split it,
  // three put one beside a stacked pair, and anything more becomes a 2×2 with
  // the remainder counted on the last tile.
  if (media.length === 1) {
    return <img src={first.url} alt="" className="w-full max-h-[320px] object-cover" />
  }
  const shown = media.slice(0, 4)
  const extra = media.length - shown.length
  return (
    <div className={`grid gap-0.5 ${media.length === 3 ? 'grid-cols-2' : 'grid-cols-2'}`}>
      {shown.map((m, i) => (
        <div key={m.url + i}
          className={`relative ${media.length === 3 && i === 0 ? 'row-span-2 aspect-[3/4]' : 'aspect-square'}`}>
          <img src={m.url} alt="" className="w-full h-full object-cover" />
          {extra > 0 && i === shown.length - 1 && (
            <span className="absolute inset-0 bg-black/55 text-white text-lg font-semibold flex items-center justify-center">
              +{extra}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

function PreviewPoll({ poll }) {
  const options = (poll?.options || []).map(o => (o || '').trim()).filter(Boolean)
  const label = POLL_DURATIONS.find(([v]) => v === (poll?.duration || 'SEVEN_DAYS'))?.[1] || '1 week'

  return (
    <div className="mx-3 mb-3 border border-[#e0e0e0] rounded-lg p-3">
      <p className="text-[13px] font-semibold text-[#000000e6] mb-2.5 break-words">
        {(poll?.question || '').trim() || <span className="text-[#00000099] font-normal">Your poll question appears here</span>}
      </p>
      <div className="space-y-2">
        {(options.length ? options : ['Answer 1', 'Answer 2']).map((opt, i) => (
          <div key={i}
            className={`border border-[#0a66c2] rounded-full px-3 py-1.5 text-[13px] font-semibold text-center ${
              options.length ? 'text-[#0a66c2]' : 'text-[#0a66c299]'}`}>
            {opt}
          </div>
        ))}
      </div>
      <p className="text-[11px] text-[#00000099] mt-2.5">0 votes · {label} left</p>
    </div>
  )
}

export function LinkedInPreview({ state, account }) {
  const caps = capabilities(state)
  const text = composedCaption(state)
  const opts = optionsFor(state)
  const cut  = text.length > SEE_MORE_AT
  const shown = cut ? text.slice(0, SEE_MORE_AT) : text

  const name = account?.display_name || account?.username || 'Your LinkedIn page'
  const followers = account?.followers_count

  return (
    <>
      <div className="bg-white border border-[#e0e0e0] rounded-lg overflow-hidden">
        {/* Author */}
        <div className="flex items-start gap-2 p-3 pb-2">
          {account?.profile_picture
            ? <img src={account.profile_picture} alt="" className="w-12 h-12 rounded-full object-cover shrink-0" />
            : <div className="w-12 h-12 rounded-full bg-[#0a66c2]/10 text-[#0a66c2] text-xs font-bold flex items-center justify-center shrink-0">LI</div>}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[#000000e6] truncate">{name}</p>
            <p className="text-xs text-[#00000099] truncate">
              {followers != null ? `${Number(followers).toLocaleString()} followers` : 'Company page'}
            </p>
            <p className="text-xs text-[#00000099]">Now · 🌐</p>
          </div>
        </div>

        {/* Body. `break-words` matters here: a pasted URL with no spaces will
            otherwise push the whole card wider than the preview column. */}
        <div className="px-3 pb-2">
          <p className="text-sm text-[#000000e6] whitespace-pre-wrap break-words leading-snug">
            {shown || <span className="text-[#00000099]">Your post appears here</span>}
            {cut && <>… <span className="text-[#00000099] font-medium">see more</span></>}
          </p>
        </div>

        {caps.poll
          ? <PreviewPoll poll={opts.poll} />
          : <PreviewMedia media={state.media || []} />}

        {/* Reaction bar. Not decoration — it is the part of the card the
            caption is competing with for vertical space. */}
        <div className="flex items-center justify-between px-3 py-1.5 text-[11px] text-[#00000099] border-t border-[#e0e0e0] mt-2">
          <span>👍❤️ 0</span>
          <span>0 comments · 0 reposts</span>
        </div>
        <div className="grid grid-cols-4 border-t border-[#e0e0e0] text-xs font-semibold text-[#00000099]">
          {['Like', 'Comment', 'Repost', 'Send'].map(a => (
            <span key={a} className="py-2 text-center">{a}</span>
          ))}
        </div>
      </div>

      {cut && (
        <p className="text-xs text-text-tertiary mt-3">
          LinkedIn cuts the feed at roughly {SEE_MORE_AT} characters. Everything after
          &ldquo;see more&rdquo; is only read by someone who chose to expand it.
        </p>
      )}

      {opts.firstComment && (
        <div className="mt-3 border border-border bg-white p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-1">First comment</p>
          <p className="text-sm text-text whitespace-pre-wrap break-words">{opts.firstComment}</p>
        </div>
      )}
    </>
  )
}
