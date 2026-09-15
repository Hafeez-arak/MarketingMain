// ─── One post on the captions step ─────────────────────────────────────────
// The last stop before a post exists: its picture, when it goes out, and the
// words under it. Captions are written HERE, after the picture, and from the
// picture — three options the reviewer chooses between, never one picked for
// them.
//
// Presentational: the planner owns every write. Keeping the network out of
// this file is what lets one board-level poll drive every card at once.

import { useLayoutEffect, useRef } from 'react'
import { Spinner, PostImage } from '../../components/ui/index'
import { aspectLabel, formatsFor, limitsFor } from '../../lib/postFormats'
import { targetLabel } from './planConstants'
import { DEFAULT_POST_TIME, POLL_DURATIONS, pollProblems } from './planModel'

// Where LinkedIn's feed cuts a post off behind "…see more". Approximate — the
// real cut depends on line breaks and screen width — and the same figure the
// composer's preview draws, so the two agree about where the hook has to land.
const LINKEDIN_SEE_MORE = 210
const DURATION_LABEL = { ONE_DAY: '1 day', THREE_DAYS: '3 days', SEVEN_DAYS: '1 week', FOURTEEN_DAYS: '2 weeks' }

const box = 'w-full text-xs leading-relaxed bg-white border border-border rounded-lg px-3 py-2 resize-y focus:outline-none focus:border-amber-400'

// A caption box as tall as its caption. A fixed three rows showed a long
// bilingual caption a few lines at a time behind a scrollbar, so nobody could
// read the post they were approving in one look. Grows (and shrinks) with the
// text on every change and when the card first paints; still resizable by hand.
function AutoTextarea({ value, minRows = 3, className = box, ...props }) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [value])
  return <textarea ref={ref} value={value} rows={minRows} className={`${className} overflow-hidden`} {...props} />
}

export function CaptionCard({
  idea, thumbUrl, mediaUrls = [], language = 'both', dateMin, dateMax, redrafting = false,
  lock = null, onOpenMedia,
  onPick, onEdit, onSaveField, onClearChoice, onRedraft, onDate, onTime, onPollEdit, onPollSave,
}) {
  const own = idea.copyMode === 'own'
  const wantsCaption = idea.wantsCaption !== false
  const hasChoice = !!((idea.captionEn || '').trim() || (idea.captionAr || '').trim())
  const options = idea.captionOptions || []
  const showAr = language !== 'en'
  const showEn = language !== 'ar'
  const isVideo = idea.mediaType === 'video'
  const targets = idea.platforms?.length ? idea.platforms : [idea.platform]
  const formatLabel = formatsFor(idea.platform).find(f => f.id === idea.postFormat)?.label || 'Feed image'
  const textOnly = idea.mediaType === 'none'
  const isLinkedIn = idea.platform === 'linkedin'
  const isPoll = isLinkedIn && idea.postFormat === 'poll'

  return (
    <div className={`border bg-white p-4 flex gap-4 ${hasChoice || own || !wantsCaption ? 'border-sage-200' : 'border-border'}`}>
      {/* The picture the words are for. */}
      <div className="w-28 flex-shrink-0">
        {thumbUrl ? (
          <button type="button" onClick={() => onOpenMedia?.(0)} title="Open the picture"
            className="relative block w-28 h-28 border border-border hover:border-amber-400 overflow-hidden">
            <PostImage src={thumbUrl} alt="" className="w-full h-full object-cover" />
            {mediaUrls.length > 1 && (
              <span className="absolute top-1 right-1 text-[9px] font-bold bg-black/65 text-white px-1.5 leading-[1.6]">1/{mediaUrls.length}</span>
            )}
          </button>
        ) : textOnly ? (
          <div className="w-28 h-28 border border-border bg-surface-subtle flex flex-col items-center justify-center text-text-tertiary text-[10px] text-center px-2 gap-1">
            <span className="text-lg">{isPoll ? '📊' : '¶'}</span>
            {isPoll ? 'Poll' : 'Text only'}
          </div>
        ) : (
          <div className="w-28 h-28 border border-dashed border-border bg-surface-subtle flex flex-col items-center justify-center text-text-disabled text-[10px] text-center px-2 gap-1">
            <span className="text-lg">{isVideo ? '🎬' : '🖼'}</span>
            No picture
          </div>
        )}
        <p className="text-[10px] text-text-tertiary mt-1 leading-snug">
          {formatLabel}{idea.aspectRatio ? ` · ${aspectLabel(idea.aspectRatio)}` : ''}
        </p>
      </div>

      <div className="flex-1 min-w-0 space-y-3">
        <div>
          <p className="text-sm font-semibold text-text leading-snug">{idea.title || idea.topic || 'Untitled idea'}</p>
          <p className="text-[11px] text-text-tertiary mt-0.5">{targets.map(targetLabel).join(' + ')}</p>
        </div>

        {lock?.locked ? <LockedPost idea={idea} lock={lock} showAr={showAr} showEn={showEn} /> : <>
        {/* When it goes out. Set here rather than on setup, next to the actual post. */}
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-[11px] text-text-secondary flex items-center gap-1.5">
            Date
            <input type="date" value={idea.date || ''} min={dateMin || undefined} max={dateMax || undefined}
              onChange={e => onDate(e.target.value)}
              className="rounded-lg border border-border px-2 py-1 text-xs bg-white focus:outline-none focus:border-amber-400" />
          </label>
          <label className="text-[11px] text-text-secondary flex items-center gap-1.5">
            Time
            {/* An older idea may have no time saved; it goes out at the default,
                so that is what the box shows rather than an empty field. */}
            <input type="time" value={idea.time || DEFAULT_POST_TIME}
              onChange={e => onTime(e.target.value)}
              className="rounded-lg border border-border px-2 py-1 text-xs bg-white focus:outline-none focus:border-amber-400" />
          </label>
          <span className="text-[10px] text-text-tertiary">KSA time</span>
        </div>
        {!idea.date && (
          <p className="text-[10px] text-text-tertiary -mt-2">No date yet — it is placed in the month when you save, or pick one.</p>
        )}

        {isPoll && (
          <PollEditor poll={idea.platformOptions?.poll} onEdit={onPollEdit} onSave={onPollSave} />
        )}

        {!wantsCaption ? (
          <p className="text-[11px] text-text-tertiary">This post goes out without a caption.</p>
        ) : own ? (
          <div className="space-y-1.5">
            <p className="text-[10px] font-bold text-sage-700 uppercase tracking-wide">✎ Your caption — posted as written</p>
            {(showEn || idea.captionEn) && (
              <AutoTextarea value={idea.captionEn || ''} rows={3}
                onChange={e => onEdit({ captionEn: e.target.value })}
                onBlur={e => onSaveField('caption_en', e.target.value)} className={box} />
            )}
            {(showAr || idea.captionAr) && (
              <AutoTextarea value={idea.captionAr || ''} rows={3} dir="rtl" placeholder="النص العربي (اختياري)"
                onChange={e => onEdit({ captionAr: e.target.value })}
                onBlur={e => onSaveField('caption_ar', e.target.value)} className={box} />
            )}
            {isLinkedIn && <LengthHint idea={idea} />}
          </div>
        ) : hasChoice ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold text-sage-700 uppercase tracking-wide">✓ Caption chosen — edit if you like</span>
              <span className="flex items-center gap-3">
                {options.length > 0 && (
                  <button onClick={onClearChoice} className="text-[11px] font-medium text-amber-700 hover:text-amber-800">
                    Choose another
                  </button>
                )}
                <button onClick={onRedraft} disabled={redrafting}
                  className="text-[11px] font-medium text-text-tertiary hover:text-text disabled:opacity-50">
                  {redrafting ? '…' : '↻ New options'}
                </button>
              </span>
            </div>
            {(showAr || idea.captionAr) && (
              <AutoTextarea value={idea.captionAr || ''} rows={3} dir="rtl"
                onChange={e => onEdit({ captionAr: e.target.value })}
                onBlur={e => onSaveField('caption_ar', e.target.value)} className={box} />
            )}
            {(showEn || idea.captionEn) && (
              <AutoTextarea value={idea.captionEn || ''} rows={isLinkedIn ? 6 : 3}
                onChange={e => onEdit({ captionEn: e.target.value })}
                onBlur={e => onSaveField('caption_en', e.target.value)} className={box} />
            )}
            {isLinkedIn && <LengthHint idea={idea} />}
          </div>
        ) : idea.draftStatus === 'drafting' ? (
          <div className="flex items-center gap-2 text-[11px] text-text-tertiary">
            <Spinner size="sm" /> Writing 3 {isLinkedIn ? 'LinkedIn posts' : 'captions'}{thumbUrl && !isVideo ? ' from the picture' : ''}…
            <button onClick={onRedraft} disabled={redrafting}
              className="font-semibold text-amber-700 hover:text-amber-800 disabled:opacity-50">
              {redrafting ? '…' : '↻ Try again'}
            </button>
          </div>
        ) : idea.draftStatus === 'failed' ? (
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-red-500">{idea.draftError || 'The captions could not be written.'}</span>
            <button onClick={onRedraft} disabled={redrafting} className="font-semibold text-amber-700 hover:text-amber-800 disabled:opacity-50">
              {redrafting ? <Spinner size="sm" /> : '↻ Retry'}
            </button>
          </div>
        ) : options.length > 0 ? (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wide">Pick one caption</p>
              <button onClick={onRedraft} disabled={redrafting}
                className="text-[11px] font-medium text-text-tertiary hover:text-text disabled:opacity-50">
                {redrafting ? '…' : '↻ New options'}
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {options.map((opt, i) => (
                <button key={i} onClick={() => onPick(opt)}
                  className="text-left border border-border bg-surface-subtle hover:border-amber-400 hover:bg-amber-50/40 p-2.5 transition-colors">
                  <span className="block text-[10px] font-bold text-text-tertiary mb-1">Option {i + 1}</span>
                  {opt.caption_ar && <span className="block text-xs text-text leading-relaxed whitespace-pre-line" dir="rtl">{opt.caption_ar}</span>}
                  {opt.caption_en && <span className="block text-xs text-text leading-relaxed whitespace-pre-line mt-1">{opt.caption_en}</span>}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-[11px] text-text-tertiary">
            <span>No captions yet.</span>
            <button onClick={onRedraft} disabled={redrafting}
              className="font-semibold text-amber-700 hover:text-amber-800 disabled:opacity-50">
              {redrafting ? '…' : 'Write 3 captions'}
            </button>
          </div>
        )}
        </>}
      </div>
    </div>
  )
}

// A post that has gone out, as it went: its words in full and when, with no
// field that can change it. The planner used to keep every box live after a
// post was published, and saving the plan again rewrote the live post's row.
function LockedPost({ idea, lock, showAr, showEn }) {
  const text = 'text-xs text-text leading-relaxed whitespace-pre-wrap break-words'
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 leading-[1.4] bg-sage-100 text-sage-700">
          {lock.state === 'publishing' ? '↗ Publishing' : '✓ Published'}
        </span>
        {lock.url && (
          <a href={lock.url} target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-amber-700 hover:underline">View post ↗</a>
        )}
        <span className="text-[11px] text-text-tertiary">{lock.reason}</span>
      </div>
      {(showAr || idea.captionAr) && idea.captionAr && (
        <p className={`${text} bg-surface-subtle border border-border px-3 py-2`} dir="rtl">{idea.captionAr}</p>
      )}
      {(showEn || idea.captionEn) && idea.captionEn && (
        <p className={`${text} bg-surface-subtle border border-border px-3 py-2`}>{idea.captionEn}</p>
      )}
      {!idea.captionAr && !idea.captionEn && <p className="text-[11px] text-text-tertiary">Went out without a caption.</p>}
    </div>
  )
}

// How long the post is against LinkedIn's limit, and whether the opening
// fits before "…see more". Counted on the longer of the two languages, since
// that is the one that reaches either limit first.
function LengthHint({ idea }) {
  const max = limitsFor('linkedin').caption
  const text = [idea.captionEn || '', idea.captionAr || ''].sort((a, b) => b.length - a.length)[0]
  const n = text.length
  const firstBreak = text.indexOf('\n')
  const opening = firstBreak >= 0 ? firstBreak : n
  return (
    <p className={`text-[10px] ${n > max ? 'text-red-600 font-semibold' : 'text-text-tertiary'}`}>
      {n.toLocaleString()} / {max.toLocaleString()} characters
      {n > max ? ' — too long for LinkedIn' : n > LINKEDIN_SEE_MORE
        ? ` · readers see about the first ${LINKEDIN_SEE_MORE} before “…see more”${opening > LINKEDIN_SEE_MORE ? ', and the first line runs past it' : ''}`
        : ''}
    </p>
  )
}

// A LinkedIn poll's question and answers. Edited locally on every keystroke
// and saved on blur, like the caption boxes beside it. The limits are
// LinkedIn's; the post cannot be saved to Approvals while any is broken,
// because a published poll cannot be edited.
function PollEditor({ poll, onEdit, onSave }) {
  const current = { question: '', options: ['', ''], duration: 'SEVEN_DAYS', ...(poll || {}) }
  const options = current.options?.length ? current.options : ['', '']
  const lim = limitsFor('linkedin').poll
  const problems = pollProblems(current)
  const touched = !!(current.question || options.some(Boolean))
  const set = patch => onEdit?.({ ...current, options, ...patch })
  const save = patch => onSave?.({ ...current, options, ...patch })
  const setOption = (i, v) => set({ options: options.map((o, idx) => idx === i ? v : o) })

  return (
    <div className="border border-sky-100 bg-sky-50/40 p-3 space-y-2">
      <p className="text-[10px] font-bold text-sky-800 uppercase tracking-wide">Poll</p>
      <input value={current.question} maxLength={lim.questionMax + 20}
        placeholder="The question" onChange={e => set({ question: e.target.value })} onBlur={() => save({})}
        className={box} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {options.map((o, i) => (
          <div key={i} className="flex items-center gap-1">
            <input value={o} placeholder={`Answer ${i + 1}`} maxLength={lim.optionMax + 10}
              onChange={e => setOption(i, e.target.value)} onBlur={() => save({})} className={box} />
            {options.length > lim.minOptions && (
              <button onClick={() => save({ options: options.filter((_, idx) => idx !== i) })}
                className="text-[11px] text-text-tertiary hover:text-red-500 px-1" title="Remove this answer">✕</button>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        {options.length < lim.maxOptions && (
          <button onClick={() => set({ options: [...options, ''] })}
            className="text-[11px] font-medium text-amber-700 hover:text-amber-800">+ Add an answer</button>
        )}
        <label className="text-[11px] text-text-secondary flex items-center gap-1.5">
          Runs for
          <select value={current.duration} onChange={e => save({ duration: e.target.value })}
            className="rounded-lg border border-border px-2 py-1 text-xs bg-white focus:outline-none focus:border-amber-400">
            {POLL_DURATIONS.map(d => <option key={d} value={d}>{DURATION_LABEL[d]}</option>)}
          </select>
        </label>
        <span className="text-[10px] text-text-tertiary">Question up to {lim.questionMax} characters, answers up to {lim.optionMax}.</span>
      </div>
      {problems.length > 0 && (
        <p className={`text-[11px] ${touched ? 'text-red-600' : 'text-text-tertiary'}`}>{problems.join(' ')}</p>
      )}
    </div>
  )
}
