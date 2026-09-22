import { useState } from 'react'
import { Button, Spinner } from '../ui/index'
import { useAuth } from '../../store/auth'
import { optionsFor } from '../../lib/composerState'

// ─── "Would this post do better?" ──────────────────────────────────────────
//
// Sits under the preview, because that is where you are already looking at the
// post rather than editing it — the moment the question actually occurs to
// somebody.
//
// ── WHAT IT DELIBERATELY DOES NOT SHOW ──
//
// No score, no grade, no predicted engagement rate. The obvious version of
// this feature prints a number; the number would be invented. This brand has
// fifteen measured posts and all of them belong to a one-follower test
// account, so there is nothing to predict from — and a made-up figure rendered
// beside genuinely measured analytics is indistinguishable from a real one.
//
// `basis` is therefore shown every time and never collapsed away. It is the
// server's own sentence about what the answer rests on, computed from the data
// BEFORE the model was asked, so the critique is never the only witness to its
// own reliability. See api/agent/critique.js.

export function CritiquePanel({ state }) {
  const { activeWorkspaceId } = useAuth()
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const nothingToRead = !String(state.caption || '').trim() && !(state.media || []).length

  async function run() {
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const res = await fetch('/api/agent/critique', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: activeWorkspaceId,
          draft: {
            platform: state.platform,
            format: state.format,
            caption: state.caption,
            media: (state.media || []).map(m => ({ type: m.type })),
            // `hashtags` is a STRING in composer state and `options` is keyed
            // by platform — reading either the obvious way sends nothing and
            // the critique silently judges a post with no hashtags and no
            // first comment.
            hashtags: state.hashtags || '',
            first_comment: optionsFor(state)?.firstComment || '',
            alt_text: optionsFor(state)?.altText || '',
            scheduled_at: state.scheduledFor || '',
          },
        }),
      })
      const data = await res.json().catch(() => null)
      if (!data) setError(`The server returned ${res.status} with nothing in it.`)
      else if (data.ok === false || !res.ok) setError(data.error || `Request failed (${res.status}).`)
      else setResult(data)
    } catch (err) {
      setError(`Could not reach the server: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mt-6 pt-5 border-t border-border">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h4 className="text-sm font-semibold text-text">Before it goes out</h4>
        <Button size="xs" variant="secondary" onClick={run} disabled={loading || nothingToRead}>
          {loading ? <><Spinner size="sm" /> Reading…</> : result ? 'Read it again' : 'Analyse this post'}
        </Button>
      </div>

      {nothingToRead ? (
        <p className="text-[11px] text-text-tertiary">Write something or add a picture first.</p>
      ) : !result && !loading && !error ? (
        <p className="text-[11px] text-text-tertiary">
          Ask what would make this land better — what works, and what to change first.
        </p>
      ) : null}

      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}

      {result && (
        <div className="mt-3 space-y-3">
          {result.verdict && (
            <p className="text-xs text-text leading-relaxed">{result.verdict}</p>
          )}

          {result.strengths?.length > 0 && (
            <div>
              <p className="eyebrow mb-1.5">Working</p>
              <ul className="space-y-1">
                {result.strengths.map((s, i) => (
                  <li key={i} className="text-[11px] text-text-secondary leading-relaxed flex gap-1.5">
                    <span className="text-sage-700 flex-shrink-0">✓</span>{s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.changes?.length > 0 && (
            <div>
              {/* Numbered, because they arrive ranked by how much difference
                  they make. An unnumbered list reads as a set of equals and
                  invites starting at the bottom. */}
              <p className="eyebrow mb-1.5">Change first</p>
              <ol className="space-y-2.5">
                {result.changes.map((c, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="w-4 h-4 flex-shrink-0 bg-text text-white text-[9px] font-bold
                      flex items-center justify-center mt-0.5">{i + 1}</span>
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold text-text leading-snug">{c.what}</p>
                      {c.why && <p className="text-[11px] text-text-secondary leading-relaxed mt-0.5">{c.why}</p>}
                      {c.suggestion && (
                        // Shown, never applied. Putting an AI rewrite straight
                        // into the caption would be a decision made for you —
                        // the same rule the idea reviser follows.
                        <p className="text-[11px] text-text mt-1 px-2 py-1.5 bg-surface-subtle border border-border leading-relaxed">
                          {c.suggestion}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {result.basis && (
            <p className="text-[10px] text-text-tertiary leading-relaxed pt-2 border-t border-border">
              {result.basis}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
