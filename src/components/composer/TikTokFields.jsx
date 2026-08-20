import { useEffect, useState } from 'react'
import { Toggle, Spinner } from '../ui/index'
import { optionsFor, setOption, composedCaption } from '../../lib/composerState'
import { fetchCreatorInfo } from '../../lib/zernioConnect'
import { useAuth } from '../../store/auth'

// ─── TikTok: privacy, consent, and the phone preview ───────────────────────
// TikTok is the platform with genuine hard requirements rather than options.
// Two of them are why this panel exists at all:
//
//   privacy_level — required, and it must be one of the values the CREATOR's
//     own account allows. Zernio's docs are explicit: "You must fetch the
//     creator's allowed levels and only use those, or the post will fail."
//     There is no safe default; guessing PUBLIC_TO_EVERYONE is how a private
//     account's post ends up public.
//
//   content_preview_confirmed + express_consent_given — both must be true, and
//     TikTok requires them as a condition of API access rather than as a
//     preference. Neither is persisted: reusing last week's answer on a post
//     nobody looked at defeats the point of asking.

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

// TikTok's own wording, near enough that someone recognises it from the app.
const PRIVACY_LABELS = {
  PUBLIC_TO_EVERYONE:   'Everyone',
  MUTUAL_FOLLOW_FRIENDS: 'Friends (people you follow back)',
  FOLLOWER_OF_CREATOR:  'Followers',
  SELF_ONLY:            'Only me',
}

export function TikTokPanel({ state, setState, caps, accountId }) {
  const { activeWorkspaceId } = useAuth()
  const opts = optionsFor(state)
  const set  = (key, value) => setState(s => setOption(s, key, value))

  const [levels, setLevels]   = useState(null)   // null = not loaded yet
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  // Re-fetched per account, because the allowed levels are a property of the
  // creator, not of the app: a private account simply cannot offer "Everyone".
  useEffect(() => {
    let cancelled = false
    // Every state write in this effect is deferred a tick, including the
    // no-account reset below: a synchronous setState in an effect body is a
    // cascading render. Same deferral as the other first-load effects here.
    if (!accountId || !activeWorkspaceId) {
      queueMicrotask(() => { if (!cancelled) setLevels(null) })
      return () => { cancelled = true }
    }
    queueMicrotask(() => { if (!cancelled) { setLoading(true); setError('') } })
    fetchCreatorInfo(activeWorkspaceId, accountId, state.format === 'photo_carousel' ? 'photo' : 'video')
      .then(res => {
        if (cancelled) return
        setLoading(false)
        if (res.error) { setError(res.error); return }
        const allowed = res.privacyLevels || []
        setLevels(allowed)
        // Clear a level the newly-chosen account is not allowed to use, rather
        // than carrying it into a post TikTok will reject.
        if (opts.privacy_level && !allowed.includes(opts.privacy_level)) set('privacy_level', '')
      })
      .catch(() => { if (!cancelled) { setLoading(false); setError('Could not read this account\'s posting settings.') } })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, activeWorkspaceId, state.format])

  return (
    <>
      <Section>
        <FieldLabel hint="required by TikTok">Who can see this post</FieldLabel>

        {!accountId && (
          <p className="text-sm text-text-secondary">Choose an account first.</p>
        )}

        {accountId && loading && (
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <Spinner size="sm" /> Reading this account&rsquo;s options…
          </div>
        )}

        {accountId && error && <p className="text-sm text-red-600">{error}</p>}

        {accountId && !loading && !error && levels && levels.length === 0 && (
          <p className="text-sm text-red-600">
            TikTok is not allowing this account to post right now. That usually means
            it needs reconnecting.
          </p>
        )}

        {accountId && !loading && levels && levels.length > 0 && (
          <div className="space-y-1.5">
            {levels.map(level => (
              <label key={level} className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="tiktok-privacy" value={level}
                  checked={opts.privacy_level === level}
                  onChange={() => set('privacy_level', level)}
                  className="accent-amber-600" />
                <span className="text-sm text-text">{PRIVACY_LABELS[level] || level}</span>
              </label>
            ))}
          </div>
        )}
      </Section>

      <Section>
        <div className="space-y-3">
          <Toggle checked={opts.allow_comment !== false}
            onChange={v => set('allow_comment', v)} label="Allow comments" />
          {caps.duetStitch && (
            <>
              <Toggle checked={opts.allow_duet !== false}
                onChange={v => set('allow_duet', v)} label="Allow duet" />
              <Toggle checked={opts.allow_stitch !== false}
                onChange={v => set('allow_stitch', v)} label="Allow stitch" />
            </>
          )}
          <Toggle checked={opts.video_made_with_ai === true}
            onChange={v => set('video_made_with_ai', v)} label="Made with AI" />
          <p className="text-xs text-text-tertiary">
            TikTok requires AI-generated content to be disclosed and labels it
            automatically when it detects it. Everything from Creative Studio
            qualifies, so this defaults to on.
          </p>
        </div>
      </Section>

      <Section>
        <label className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" checked={opts.consent_confirmed === true}
            onChange={e => set('consent_confirmed', e.target.checked)}
            className="mt-0.5 accent-amber-600" />
          <span className="text-sm text-text">
            I have reviewed this post and agree to TikTok&rsquo;s{' '}
            <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en"
              target="_blank" rel="noreferrer" className="text-amber-700 underline">
              Music Usage Confirmation
            </a>.
            <span className="block text-xs text-text-tertiary mt-0.5">
              TikTok requires this per post — it is not remembered between posts.
            </span>
          </span>
        </label>
      </Section>
    </>
  )
}

// ── Live preview ──────────────────────────────────────────────────────────
// A phone frame rather than a card, because TikTok is a full-bleed vertical
// feed and a caption that reads fine in a box can sit underneath the action
// rail or behind the gradient. Seeing that is the point.
export function TikTokPreview({ state, account }) {
  const caption = composedCaption(state)
  const first   = state.media[0]

  return (
    <div className="relative w-full max-w-[260px] mx-auto aspect-[9/16] bg-stone-800 overflow-hidden">
      {first ? (
        first.type === 'video'
          ? <video src={first.url} className="absolute inset-0 w-full h-full object-cover" muted playsInline preload="metadata" />
          : <img src={first.url} alt="" className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-white/50">
          Video appears here
        </div>
      )}

      {/* Top nav */}
      <div className="absolute inset-x-0 top-0 p-3 flex items-center justify-center gap-4 text-white text-xs bg-gradient-to-b from-black/40 to-transparent">
        <span className="opacity-60">Following</span>
        <span className="font-semibold border-b-2 border-white pb-0.5">For You</span>
      </div>

      {/* Action rail */}
      <div className="absolute right-2 bottom-16 flex flex-col items-center gap-3 text-white">
        {account.profile_picture
          ? <img src={account.profile_picture} alt="" className="w-8 h-8 rounded-full object-cover border-2 border-white" />
          : <div className="w-8 h-8 rounded-full bg-white/20 border-2 border-white" />}
        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8z" /></svg>
        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.4 8.4 0 0 1-3.8-.9L3 20.5l1.5-4.4A8.4 8.4 0 0 1 3.6 12a8.4 8.4 0 0 1 8.4-8.5h.5A8.4 8.4 0 0 1 21 11.5z" /></svg>
        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
      </div>

      {/* Caption */}
      <div className="absolute inset-x-0 bottom-0 p-3 pr-12 bg-gradient-to-t from-black/70 to-transparent text-white">
        <p className="text-xs font-semibold mb-0.5">
          {account.username ? `@${account.username}` : '@your_account'}
        </p>
        <p className="text-xs leading-snug line-clamp-3 break-words">
          {caption || <span className="text-white/50">Your caption appears here</span>}
        </p>
      </div>
    </div>
  )
}
