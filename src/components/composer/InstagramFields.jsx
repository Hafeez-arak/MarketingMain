import { useRef, useState } from 'react'
import { Toggle } from '../ui/index'
import { optionsFor, setOption, composedCaption, captionStats } from '../../lib/composerState'
import { limitsFor } from '../../lib/postFormats'

// ─── Instagram: the fields only Instagram has, and the preview ─────────────
// Every field here maps to something in Zernio's platformSpecificData. The
// ones Hootsuite shows that are NOT here — location, publish-via-mobile — are
// absent because Instagram's API does not expose them; see the note at the top
// of PostComposer.jsx.

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

// ── Collaborators ─────────────────────────────────────────────────────────
// Instagram caps this at 3 and only accepts public accounts. Enforced here as
// well as in validation so the limit is visible while typing rather than as a
// refusal after pressing Post.
function Collaborators({ value, onChange }) {
  const [draft, setDraft] = useState('')
  const max = limitsFor('instagram').collaborators

  const add = () => {
    const handle = draft.trim().replace(/^@/, '')
    if (!handle || value.includes(handle) || value.length >= max) return
    onChange([...value, handle])
    setDraft('')
  }

  return (
    <>
      <FieldLabel hint={`(up to ${max}, public accounts only)`}>Invite collaborators</FieldLabel>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {value.map(h => (
            <span key={h} className="inline-flex items-center gap-1 bg-surface-subtle border border-border px-2 py-0.5 text-xs text-text">
              @{h}
              <button type="button" onClick={() => onChange(value.filter(x => x !== h))}
                className="text-text-tertiary hover:text-text">✕</button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          disabled={value.length >= max}
          placeholder={value.length >= max ? `${max} is the maximum` : 'Instagram username'}
          className="flex-1 border border-border px-3 py-2 text-sm bg-white text-text focus:outline-none focus:border-amber-600 disabled:bg-surface-subtle" />
        <button type="button" onClick={add} disabled={!draft.trim() || value.length >= max}
          className="px-3 py-2 text-sm border border-border hover:bg-surface-subtle disabled:opacity-40">
          Add
        </button>
      </div>
    </>
  )
}

// ── Tagging people in the image ───────────────────────────────────────────
// Instagram wants normalised x/y coordinates, so the honest UI is clicking the
// image itself rather than typing numbers. Tags are per-slide on a carousel,
// which is what mediaIndex carries.
function UserTags({ media, value, onChange, activeIndex, onActiveIndex }) {
  const imgRef = useRef(null)
  const [pending, setPending] = useState(null)
  const [handle, setHandle] = useState('')

  const current = media[activeIndex]
  if (!current || current.type === 'video') {
    return <p className="text-xs text-text-tertiary">People can only be tagged on images.</p>
  }

  const place = (e) => {
    const box = imgRef.current.getBoundingClientRect()
    setPending({
      x: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)),
    })
    setHandle('')
  }

  const commit = () => {
    const username = handle.trim().replace(/^@/, '')
    if (!username || !pending) return
    onChange([...value, { username, x: +pending.x.toFixed(4), y: +pending.y.toFixed(4), mediaIndex: activeIndex }])
    setPending(null)
    setHandle('')
  }

  const onThisSlide = value.filter(t => (t.mediaIndex ?? 0) === activeIndex)

  return (
    <>
      <FieldLabel hint="(click the image)">Tag people</FieldLabel>

      {media.length > 1 && (
        <div className="flex gap-1 mb-2">
          {media.map((_, i) => (
            <button key={i} type="button" onClick={() => onActiveIndex(i)}
              className={`w-7 h-7 text-xs border ${i === activeIndex ? 'border-amber-600 bg-amber-50 font-semibold' : 'border-border'}`}>
              {i + 1}
            </button>
          ))}
        </div>
      )}

      <div className="relative inline-block max-w-[260px]">
        <img ref={imgRef} src={current.url} alt="" onClick={place}
          className="w-full border border-border cursor-crosshair select-none" />
        {onThisSlide.map((t, i) => (
          <span key={i}
            style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%` }}
            className="absolute -translate-x-1/2 -translate-y-1/2 bg-black/75 text-white text-[10px] px-1.5 py-0.5 whitespace-nowrap">
            @{t.username}
            <button type="button"
              onClick={e => { e.stopPropagation(); onChange(value.filter(v => v !== t)) }}
              className="ml-1 text-white/70 hover:text-white">✕</button>
          </span>
        ))}
        {pending && (
          <span style={{ left: `${pending.x * 100}%`, top: `${pending.y * 100}%` }}
            className="absolute -translate-x-1/2 -translate-y-1/2 w-3 h-3 border-2 border-white bg-amber-600 rounded-full" />
        )}
      </div>

      {pending && (
        <div className="flex gap-2 mt-2 max-w-[260px]">
          <input autoFocus value={handle} onChange={e => setHandle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
            placeholder="username"
            className="flex-1 border border-border px-2 py-1 text-sm focus:outline-none focus:border-amber-600" />
          <button type="button" onClick={commit}
            className="px-2 py-1 text-xs border border-border hover:bg-surface-subtle">Tag</button>
          <button type="button" onClick={() => setPending(null)}
            className="px-2 py-1 text-xs text-text-tertiary">Cancel</button>
        </div>
      )}
    </>
  )
}

// ── Reel thumbnail ────────────────────────────────────────────────────────
// Instagram's automatic Reel thumbnail is frequently a motion-blurred frame,
// and the thumbnail is most of why a Reel gets tapped. Scrubbing to a frame is
// one input and gets used on every Reel.
function ThumbnailScrubber({ video, value, onChange }) {
  const ref = useRef(null)
  const [duration, setDuration] = useState(null)

  if (!video) return <p className="text-xs text-text-tertiary">Add a video to choose its cover frame.</p>

  const ms = value ?? 1000

  return (
    <>
      <FieldLabel hint="the frame people see before it plays">Cover frame</FieldLabel>
      <video ref={ref} src={video.url} muted playsInline preload="metadata"
        onLoadedMetadata={e => setDuration(e.currentTarget.duration)}
        className="w-full max-w-[220px] border border-border mb-2" />
      <input type="range" min={0} max={Math.max(1000, Math.floor((duration || 10) * 1000))} step={100}
        value={ms}
        onChange={e => {
          const next = Number(e.target.value)
          onChange(next)
          // Seek the element so the slider previews the actual frame rather
          // than moving a number that means nothing until after publishing.
          if (ref.current) ref.current.currentTime = next / 1000
        }}
        className="w-full max-w-[220px] accent-amber-600" />
      <p className="text-xs text-text-tertiary mt-1">{(ms / 1000).toFixed(1)}s</p>
    </>
  )
}

export function InstagramPanel({ state, setState, caps }) {
  const opts = optionsFor(state)
  const [slide, setSlide] = useState(0)
  const set = (key, value) => setState(s => setOption(s, key, value))
  const video = state.media.find(m => m.type === 'video')

  return (
    <>
      {caps.firstComment && (
        <Section>
          <FieldLabel hint="posted automatically, right after the post">First comment</FieldLabel>
          <textarea rows={3} value={opts.firstComment}
            onChange={e => set('firstComment', e.target.value)}
            placeholder="Put the hashtags here to keep the caption clean"
            className="w-full border border-border px-3 py-2 text-sm bg-white text-text resize-y focus:outline-none focus:border-amber-600" />
        </Section>
      )}

      {caps.collaborators && (
        <Section>
          <Collaborators value={opts.collaborators || []} onChange={v => set('collaborators', v)} />
        </Section>
      )}

      {caps.userTags && state.media.length > 0 && (
        <Section>
          <UserTags media={state.media} value={opts.userTags || []}
            onChange={v => set('userTags', v)}
            activeIndex={Math.min(slide, state.media.length - 1)}
            onActiveIndex={setSlide} />
        </Section>
      )}

      {caps.altText && (
        <Section>
          <FieldLabel hint="(optional) — describes the image to screen readers">Alt text</FieldLabel>
          <input value={opts.altText} onChange={e => set('altText', e.target.value)}
            placeholder="Warm downlights over a walnut dining table"
            className="w-full border border-border px-3 py-2 text-sm bg-white text-text focus:outline-none focus:border-amber-600" />
        </Section>
      )}

      {caps.thumbOffset && (
        <Section>
          <ThumbnailScrubber video={video} value={opts.thumbOffset}
            onChange={v => set('thumbOffset', v)} />
        </Section>
      )}

      <Section>
        {caps.shareToFeed && (
          <div className="mb-3">
            <Toggle checked={opts.shareToFeed !== false}
              onChange={v => set('shareToFeed', v)}
              label="Also show this Reel on the profile grid" />
          </div>
        )}
        <Toggle checked={opts.isAiGenerated === true}
          onChange={v => set('isAiGenerated', v)}
          label="Made with AI" />
        <p className="text-xs text-text-tertiary mt-1">
          Instagram labels AI media whether or not you declare it, and down-ranks
          undisclosed AI content it detects itself. Everything from Creative Studio
          qualifies, so this defaults to on.
        </p>
      </Section>
    </>
  )
}

// ── Live preview ──────────────────────────────────────────────────────────
// Matches the real post chrome closely enough to judge a caption against it:
// where the text truncates, how a 4:5 crop sits, what the first line reads
// like. That is the whole reason for a preview over a form.
export function InstagramPreview({ state, account }) {
  const caption = composedCaption(state)
  const stats   = captionStats(state)
  const first   = state.media[0]
  const isStory = state.format === 'story'
  const isReel  = state.format === 'reel'

  const ratioClass = isStory || isReel ? 'aspect-[9/16]'
    : state.format === 'carousel' ? 'aspect-[4/5]' : 'aspect-[4/5]'

  return (
    <div className="bg-white border border-border">
      <div className="flex items-center gap-2 p-3">
        {account.profile_picture
          ? <img src={account.profile_picture} alt="" className="w-8 h-8 rounded-full object-cover" />
          : <div className="w-8 h-8 rounded-full bg-surface-subtle border border-border" />}
        <span className="text-sm font-semibold text-text">
          {account.username || 'your_account'}
        </span>
      </div>

      <div className={`${ratioClass} bg-surface-subtle relative overflow-hidden`}>
        {first ? (
          first.type === 'video'
            ? <video src={first.url} className="w-full h-full object-cover" muted playsInline preload="metadata" />
            : <img src={first.url} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-text-tertiary">
            Media appears here
          </div>
        )}
        {state.media.length > 1 && (
          <span className="absolute top-2 right-2 bg-black/60 text-white text-[10px] px-1.5 py-0.5">
            1/{state.media.length}
          </span>
        )}
      </div>

      {!isStory && (
        <>
          <div className="flex items-center gap-4 px-3 pt-3 text-text">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8z" /></svg>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.4 8.4 0 0 1-3.8-.9L3 20.5l1.5-4.4A8.4 8.4 0 0 1 3.6 12a8.4 8.4 0 0 1 8.4-8.5h.5A8.4 8.4 0 0 1 21 11.5z" /></svg>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
            <svg className="w-5 h-5 ml-auto" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
          </div>

          <div className="px-3 py-2">
            <p className="text-sm text-text whitespace-pre-wrap break-words">
              <span className="font-semibold">{account.username || 'your_account'}</span>{' '}
              {caption || <span className="text-text-tertiary">Your caption appears here</span>}
            </p>
            {stats.over && (
              <p className="text-xs text-red-600 mt-1">
                Instagram will cut this off at {stats.limit.toLocaleString()} characters.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
