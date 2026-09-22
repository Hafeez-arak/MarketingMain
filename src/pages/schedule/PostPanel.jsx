import { useState } from 'react'
import { Button, PostImage } from '../../components/ui/index'
import { platformColor, stageStyle, isPastSlot, addDays } from './calendarModel'
import { scheduleStage, pendingReason } from '../../lib/postStage'
import { postLock } from '../../lib/postLock'
import {
  utcToBrandInputs, formatBrandDateTime, brandTodayKey, BRAND_TIMEZONE_LABEL,
} from '../../lib/brandTime'

// ─── One post, opened ──────────────────────────────────────────────────────
// The answer to "I can't view the post when I click on it in the calendar".
// Clicking a chip used to open the post's DAY — a list of everything on that
// date — so the one post you clicked was never actually shown.
//
// Three things live here, and nothing else: see it, change when it goes out,
// or take it off the schedule. Changing the WORDS or the PICTURE opens the
// composer, which is where that already belongs — duplicating a caption editor
// here would be a second place for a caption to be edited and a second thing
// to keep in step with the platform's limits.

const textOf = p => (p?.caption || p?.topic || p?.hook || '').replace(/\s+/g, ' ').trim()
const mediaOf = p => (Array.isArray(p?.image_urls) && p.image_urls.length ? p.image_urls[0] : p?.image_url) || ''

// What the date/time boxes should say when they open.
//
// A post's own slot when that slot is still ahead — you are most likely
// nudging it, not replacing it. Otherwise the next usable one: an unbooked
// post, or one whose planned moment has already gone by, must not open onto a
// time in the past with the Schedule button already refusing to work.
function openingSlot(post, now = Date.now()) {
  const slot = utcToBrandInputs(post?.scheduled_publish_at)
  if (slot.date && Date.parse(post.scheduled_publish_at) > now + 60_000) return slot
  return { date: addDays(brandTodayKey(), 1), time: slot.time || '10:00' }
}

export function PostPanel({ post, busy, onClose, onBook, onCancel, onEdit }) {
  const slot = utcToBrandInputs(post.scheduled_publish_at)
  const opening = openingSlot(post)
  const [date, setDate] = useState(opening.date)
  const [time, setTime] = useState(opening.time)
  const [confirmCancel, setConfirmCancel] = useState(false)

  const pc = platformColor(post.platform)
  const stage = scheduleStage(post)
  const sty = stageStyle(stage)
  const lock = postLock(post)
  const media = mediaOf(post)
  const text = textOf(post)

  // Everything a published post offers is read-only, and that is the point:
  // it is on Instagram. The panel says so once, at the top, rather than
  // greying out four controls and leaving you to work out why.
  const settled = lock.locked || stage === 'published' || stage === 'sending'
  const slotIsPast = isPastSlot(date, time)
  const unchanged = date === slot.date && time === slot.time

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(28,35,33,0.45)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ width: '640px', maxHeight: '86vh' }}
        className="bg-white border border-border shadow-dropdown flex flex-col overflow-hidden animate-fade-scale">

        {/* Header — state first, because it decides what the rest can do. */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 flex-shrink-0 border-b border-border"
          style={{ background: sty.fill }}>
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: pc.dot }} />
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: pc.dot }}>{pc.label}</span>
              <span className={`text-[10px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 bg-white/70 ${sty.text}`}>
                {sty.label}
              </span>
            </div>
            <h3 className="font-semibold text-sm text-text">
              {post.scheduled_publish_at
                ? formatBrandDateTime(post.scheduled_publish_at)
                : 'No time chosen yet'}
            </h3>
            {stage === 'published' && post.published_at && (
              <p className="text-xs text-text-secondary mt-0.5">
                Went out {formatBrandDateTime(post.published_at)}
              </p>
            )}
            {/* Said plainly rather than rounded up to "Published": its time
                came and we let it go, and the platform has not confirmed back
                yet. Claiming more than that is how a page ends up reporting a
                post as published that never actually went out. */}
            {stage === 'sent' && (
              <p className="text-xs text-text-secondary mt-0.5">
                Its time has passed, so it has gone out — waiting on {pc.label} to confirm.
              </p>
            )}
            {stage === 'pending' && (
              <p className="text-xs text-red-700 mt-0.5">{pendingReason(post)}</p>
            )}
          </div>
          <button onClick={onClose} aria-label="Close"
            className="w-8 h-8 flex items-center justify-center text-text-tertiary hover:bg-white/60 transition-colors flex-shrink-0">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1">

          {/* The post itself. */}
          <div className="p-5 flex gap-4">
            {media
              ? <PostImage src={media} alt="" className="w-28 h-28 object-cover flex-shrink-0 border border-border" />
              : (
                <div className="w-28 h-28 flex items-center justify-center flex-shrink-0 border border-border text-2xl text-text-disabled"
                  style={{ background: pc.light }}>{post.video_url ? '▶' : '¶'}</div>
              )}
            <div className="min-w-0 flex-1">
              <p className="text-xs text-text leading-relaxed whitespace-pre-wrap">
                {text || <span className="text-text-tertiary">No caption yet.</span>}
              </p>
              {post.hashtags && (
                <p className="text-[11px] text-sky-700 mt-2 leading-relaxed break-words">{post.hashtags}</p>
              )}
              {/* Only when the header is not already carrying it: pendingReason
                  quotes publish_error for a failed post, and printing it twice
                  reads as two different problems. */}
              {post.publish_error && stage !== 'pending' && (
                <p className="text-[11px] text-red-600 mt-2 leading-relaxed">{post.publish_error}</p>
              )}
              {post.platform_post_url && (
                <a href={post.platform_post_url} target="_blank" rel="noreferrer"
                  className="inline-block text-[11px] font-semibold text-amber-800 underline mt-2">
                  View it on {pc.label}
                </a>
              )}
            </div>
          </div>

          {/* When it goes out. Hidden entirely once the post has gone — there
              is no "when" left to choose, and offering the control would be
              offering to change something that already happened. */}
          {!settled && (
            <div className="px-5 py-4 border-t border-border bg-surface-subtle">
              <p className="eyebrow text-text-tertiary mb-2.5">
                {stage === 'booked' ? 'Reschedule' : 'Schedule it'} · {BRAND_TIMEZONE_LABEL}
              </p>
              <div className="flex items-end gap-2 flex-wrap">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-text-tertiary">Date</span>
                  <input type="date" value={date} min={brandTodayKey()}
                    onChange={e => setDate(e.target.value)}
                    className="text-xs border border-border px-2 py-1.5 bg-white" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-text-tertiary">Time</span>
                  <input type="time" value={time}
                    onChange={e => setTime(e.target.value)}
                    className="text-xs border border-border px-2 py-1.5 bg-white" />
                </label>
                <Button
                  onClick={() => onBook(post, date, time)}
                  disabled={busy || slotIsPast || !date || !time || (stage === 'booked' && unchanged)}>
                  {stage === 'booked' ? 'Move it' : 'Schedule'}
                </Button>
              </div>
              {slotIsPast && (
                <p className="text-[11px] text-red-600 mt-2">That moment has already passed — pick a later one.</p>
              )}
              {!slotIsPast && stage === 'booked' && unchanged && (
                <p className="text-[11px] text-text-tertiary mt-2">This is when it is booked for now.</p>
              )}
              {/* Said plainly, because it is the one thing about this button
                  that is not obvious: it is not saving a note, it is talking
                  to the platform. */}
              {!slotIsPast && (
                <p className="text-[11px] text-text-tertiary mt-2">
                  {stage === 'booked'
                    ? 'Moving it cancels the booked slot and books the new one.'
                    : 'This books the post at the platform — it will go out on its own.'}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 px-5 py-3 border-t border-border flex-shrink-0 flex-wrap">
          {settled ? (
            <p className="text-xs text-text-secondary flex-1">
              {stage === 'sent'
                ? 'Its scheduled moment has passed, so it can no longer be changed. The confirmation usually lands within the hour.'
                : lock.reason || 'This post is on its way out.'}
            </p>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onEdit(post)} disabled={busy}>
                Edit post
              </Button>
              {stage === 'booked' && (
                confirmCancel ? (
                  <>
                    <span className="text-[11px] text-text-secondary">Take it off the schedule?</span>
                    <button onClick={() => { setConfirmCancel(false); onCancel(post) }} disabled={busy}
                      className="text-[11px] font-semibold px-2.5 py-1.5 border border-red-300 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-40">
                      Yes, cancel it
                    </button>
                    <button onClick={() => setConfirmCancel(false)}
                      className="text-[11px] px-2.5 py-1.5 border border-border text-text-secondary hover:bg-surface-subtle">
                      Keep it
                    </button>
                  </>
                ) : (
                  <button onClick={() => setConfirmCancel(true)} disabled={busy}
                    className="text-[11px] font-semibold px-2.5 py-1.5 border border-border text-text-secondary hover:bg-surface-subtle disabled:opacity-40">
                    Cancel schedule
                  </button>
                )
              )}
            </>
          )}
          <button onClick={onClose} className="ml-auto text-[11px] px-2.5 py-1.5 border border-border text-text-secondary hover:bg-surface-subtle">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
