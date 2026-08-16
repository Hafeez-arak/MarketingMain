import { useState } from 'react'
import { Modal, Button, Select, Spinner } from './ui/index'
import { requestCaptionStudio } from '../lib/campaignPlanner'

// On-demand caption rewriting panel, opened from the post review screen.
// Self-contained: takes the post's context + the reviewer's current draft,
// talks to the Caption Studio webhook, and hands the chosen result back via
// onApply so the parent saves it through its existing caption-save path.
//
// Instagram works on one caption plus hashtags.
// (so "take hook from variant A, body from variant B" is a real action).
// Bilingual — Arabic is rendered RTL. Nothing here writes to the DB; the
// parent owns persistence.

const LENGTHS   = [{ v: 'medium', l: 'Medium' }, { v: 'short', l: 'Short' }, { v: 'long', l: 'Long' }]
const HOOKS     = [{ v: '', l: 'Any hook' }, { v: 'question', l: 'Question' }, { v: 'bold_statement', l: 'Bold statement' }, { v: 'stat', l: 'Stat / number' }, { v: 'story', l: 'Story' }]
const EMOJIS    = [{ v: 'light', l: 'Light emojis' }, { v: 'none', l: 'No emojis' }, { v: 'rich', l: 'Rich emojis' }]
const HASHTAGS  = [{ v: 'default', l: '6-8 hashtags' }, { v: 'none', l: 'No hashtags' }, { v: 'few', l: '3-5 hashtags' }, { v: 'many', l: '8-12 hashtags' }]

// Pick the language a piece of text should show in — a rewrite in a single
// language leaves the other side blank, so fall back gracefully.
function pick(ar, en, lang) {
  if (lang === 'ar') return ar || en || ''
  if (lang === 'en') return en || ar || ''
  return [ar, en].filter(Boolean).join('\n\n—\n\n')
}
function isArabic(s) { return /[؀-ۿ]/.test(s || '') }

function TextBlock({ label, text }) {
  if (!text) return null
  return (
    <div className="space-y-0.5">
      {label && <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">{label}</p>}
      <p className="text-sm text-text leading-relaxed whitespace-pre-line" dir={isArabic(text) ? 'rtl' : 'ltr'}>{text}</p>
    </div>
  )
}

export function CaptionStudio({ open, onClose, webhookUrl, platform, language = 'both', context, current, onApply }) {
  const [controls, setControls] = useState({ length: 'medium', hookStyle: '', emoji: 'light', hashtagCount: 'default' })
  const [variants, setVariants] = useState([])
  const [loading, setLoading]   = useState(false)      // 'variants' | 'hook' | 'body' | 'caption' | 'hashtags' | false
  const [error, setError]       = useState('')
  // The working draft the reviewer is assembling — starts from what they have.
  const [draft, setDraft] = useState(() => ({
    hook: current?.hook || '',
    body: current?.body || current?.caption || '',
    hashtags: current?.hashtags || '',
  }))

  const set = (k, v) => setControls(c => ({ ...c, [k]: v }))

  async function generateVariants() {
    setLoading('variants'); setError('')
    const res = await requestCaptionStudio(webhookUrl, {
      mode: 'variants', platform, language, context,
      controls: cleanControls(controls),
    })
    setLoading(false)
    if (res.error) { setError(res.error); return }
    setVariants(res.variants || [])
  }

  async function regeneratePiece(piece) {
    setLoading(piece); setError('')
    const res = await requestCaptionStudio(webhookUrl, {
      mode: 'piece', platform, language, context, piece,
      controls: cleanControls(controls),
      current: { hook: draft.hook, body: draft.body, caption: draft.body, hashtags: draft.hashtags },
    })
    setLoading(false)
    if (res.error) { setError(res.error); return }
    if (piece === 'hashtags') setDraft(d => ({ ...d, hashtags: res.value || d.hashtags }))
    else {
      const val = pick(res.value_ar, res.value_en, language)
      setDraft(d => ({ ...d, [piece === 'body' || piece === 'caption' ? 'body' : 'hook']: val }))
    }
  }

  // Pull a whole variant, or just one piece of it, into the working draft.
  function applyVariant(v) {
    setDraft(d => ({ ...d, body: pick(v.caption_ar, v.caption_en, language), hashtags: v.hashtags || '' }))
  }

  function apply() {
    // Hand the assembled result back; parent maps it to its own fields.
    onApply({ caption: draft.body, hashtags: draft.hashtags })
    onClose()
  }

  const busy = loading !== false

  return (
    <Modal open={open} onClose={onClose} title="✨ Rewrite caption" width="max-w-3xl">
      <div className="p-6 space-y-5">
        {!webhookUrl && (
          <div className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3 text-xs text-amber-700">
            Caption Studio webhook isn't configured yet — add it in Settings → Integrations → Workflow Webhooks.
          </div>
        )}

        {/* Controls */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Select label="Length" value={controls.length} onChange={e => set('length', e.target.value)}>
            {LENGTHS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </Select>
          <Select label="Hook style" value={controls.hookStyle} onChange={e => set('hookStyle', e.target.value)}>
            {HOOKS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </Select>
          <Select label="Emoji" value={controls.emoji} onChange={e => set('emoji', e.target.value)}>
            {EMOJIS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </Select>
          <Select label="Hashtags" value={controls.hashtagCount} onChange={e => set('hashtagCount', e.target.value)}>
            {HASHTAGS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </Select>
        </div>

        <Button onClick={generateVariants} disabled={busy || !webhookUrl}>
          {loading === 'variants' ? <><Spinner size="sm" /> Writing 3 options…</> : variants.length ? '↻ New 3 options' : '✨ Give me 3 options'}
        </Button>

        {error && <p className="text-xs text-red-600">{error}</p>}

        {/* Variants */}
        {variants.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {variants.map((v, i) => (
              <div key={i} className="rounded-xl border border-border bg-surface-subtle p-3 space-y-2 flex flex-col">
                <span className="text-[10px] font-bold text-text-tertiary">Option {i + 1}</span>
                <div className="flex-1 space-y-2">
                  <TextBlock text={pick(v.caption_ar, v.caption_en, language)} />
                  {v.hashtags && <p className="text-[11px] text-text-tertiary">{v.hashtags}</p>}
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <button onClick={() => applyVariant(v)} className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition-colors">Use this</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Working draft — what "Apply" will save. Per-piece regen lives here. */}
        <div className="rounded-xl border border-violet-200 bg-violet-50/30 p-4 space-y-3">
          <p className="text-[11px] font-bold text-violet-700 uppercase tracking-wide">Your draft</p>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-text-tertiary uppercase">Caption</span>
              <button onClick={() => regeneratePiece('caption')} disabled={busy} className="text-[11px] font-medium text-violet-700 hover:text-violet-900 disabled:opacity-50">{(loading === 'body' || loading === 'caption') ? '…' : '↻ regenerate caption'}</button>
            </div>
            <textarea value={draft.body} onChange={e => setDraft(d => ({ ...d, body: e.target.value }))} rows={8}
              dir={isArabic(draft.body) ? 'rtl' : 'ltr'} className="w-full text-sm bg-white border border-border rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-violet-300" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-text-tertiary uppercase">Hashtags</span>
              <button onClick={() => regeneratePiece('hashtags')} disabled={busy} className="text-[11px] font-medium text-violet-700 hover:text-violet-900 disabled:opacity-50">{loading === 'hashtags' ? '…' : '↻ regenerate hashtags'}</button>
            </div>
            <textarea value={draft.hashtags} onChange={e => setDraft(d => ({ ...d, hashtags: e.target.value }))} rows={2}
              className="w-full text-sm bg-white border border-border rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-violet-300" />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={apply} disabled={busy}>Apply to post</Button>
        </div>
      </div>
    </Modal>
  )
}

// Drop the "default"/"any" sentinel values so the workflow falls back to its
// own defaults instead of receiving a literal "default".
function cleanControls(c) {
  const out = {}
  if (c.length && c.length !== 'medium') out.length = c.length
  if (c.hookStyle) out.hookStyle = c.hookStyle
  if (c.emoji && c.emoji !== 'light') out.emoji = c.emoji
  if (c.hashtagCount && c.hashtagCount !== 'default') out.hashtagCount = c.hashtagCount
  return out
}
