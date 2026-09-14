// ─── One post on the captions step ─────────────────────────────────────────
// The last stop before a post exists: its picture, when it goes out, and the
// words under it. Captions are written HERE, after the picture, and from the
// picture — three options the reviewer chooses between, never one picked for
// them.
//
// Presentational: the planner owns every write. Keeping the network out of
// this file is what lets one board-level poll drive every card at once.

import { Spinner, PostImage } from '../../components/ui/index'
import { aspectLabel, formatsFor } from '../../lib/postFormats'
import { targetLabel } from './planConstants'
import { DEFAULT_POST_TIME } from './planModel'

const box = 'w-full text-xs bg-white border border-border rounded-lg px-3 py-2 resize-y focus:outline-none focus:border-amber-400'

export function CaptionCard({
  idea, thumbUrl, language = 'both', dateMin, dateMax, redrafting = false,
  onPick, onEdit, onSaveField, onClearChoice, onRedraft, onDate, onTime,
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

  return (
    <div className={`border bg-white p-4 flex gap-4 ${hasChoice || own || !wantsCaption ? 'border-sage-200' : 'border-border'}`}>
      {/* The picture the words are for. */}
      <div className="w-28 flex-shrink-0">
        {thumbUrl ? (
          <PostImage src={thumbUrl} alt="" className="w-28 h-28 object-cover border border-border" />
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

        {!wantsCaption ? (
          <p className="text-[11px] text-text-tertiary">This post goes out without a caption.</p>
        ) : own ? (
          <div className="space-y-1.5">
            <p className="text-[10px] font-bold text-sage-700 uppercase tracking-wide">✎ Your caption — posted as written</p>
            {(showEn || idea.captionEn) && (
              <textarea value={idea.captionEn || ''} rows={3}
                onChange={e => onEdit({ captionEn: e.target.value })}
                onBlur={e => onSaveField('caption_en', e.target.value)} className={box} />
            )}
            {(showAr || idea.captionAr) && (
              <textarea value={idea.captionAr || ''} rows={3} dir="rtl" placeholder="النص العربي (اختياري)"
                onChange={e => onEdit({ captionAr: e.target.value })}
                onBlur={e => onSaveField('caption_ar', e.target.value)} className={box} />
            )}
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
              <textarea value={idea.captionAr || ''} rows={3} dir="rtl"
                onChange={e => onEdit({ captionAr: e.target.value })}
                onBlur={e => onSaveField('caption_ar', e.target.value)} className={box} />
            )}
            {(showEn || idea.captionEn) && (
              <textarea value={idea.captionEn || ''} rows={3}
                onChange={e => onEdit({ captionEn: e.target.value })}
                onBlur={e => onSaveField('caption_en', e.target.value)} className={box} />
            )}
          </div>
        ) : idea.draftStatus === 'drafting' ? (
          <div className="flex items-center gap-2 text-[11px] text-text-tertiary">
            <Spinner size="sm" /> Writing 3 captions{thumbUrl && !isVideo ? ' from the picture' : ''}…
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
      </div>
    </div>
  )
}
