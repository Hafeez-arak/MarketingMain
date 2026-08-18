import { useState } from 'react'
import { TASK_LABELS } from '../lib/brandContext'

// ─── Brand context panel ───────────────────────────────────────────────────
// Shows exactly what the Brand Brain is sending into this generation, and
// lets the operator drop a block for this call only.
//
// The problem it solves: someone prompts "make the lighting cool blue" while
// the brand brain quietly asserts a warm bronze palette. Before this, they
// could not see that a palette was being sent at all, and their only lever
// was to edit the Brand Brain permanently, for everyone.
//
// It renders the blocks its parent got back from buildContext() — the SAME
// call that builds the payload — so the preview cannot drift from what is
// actually sent. That property only holds if the parent passes the context it
// is about to send; don't rebuild it here.
export function BrandContextPanel({ context, mutedKeys = [], onToggleBlock, task }) {
  const [open, setOpen] = useState(false)
  if (!context) return null

  const blocks = context.blocks || []
  if (!blocks.length && !context.brandName) return null

  // A block can be withheld two ways, and the panel has to show both or it
  // misreports what is being sent: `mutedKeys` is this component's own
  // per-generation toggle, while `block.muted` is buildContext's verdict —
  // which also covers a section de-selected upstream (the planner's "Pull
  // from Brand Brain" chips). Reading only mutedKeys made a de-selected
  // directory still render as if it were included.
  const isWithheld = b => b.muted || mutedKeys.includes(b.key)
  const activeCount = blocks.filter(b => !isWithheld(b)).length
  const canMute = typeof onToggleBlock === 'function'

  return (
    <div className="rounded-xl border border-border bg-surface-subtle/60">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="text-[11px] text-text-secondary">
          <span className="font-semibold text-text-primary">Brand context</span>
          {': '}{activeCount} block{activeCount === 1 ? '' : 's'}
          {context.brandName ? ` · ${context.brandName}` : ''}
          {task && TASK_LABELS[task] ? ` · ${TASK_LABELS[task]}` : ''}
          {activeCount !== blocks.length && (
            <span className="text-amber-600"> · {blocks.length - activeCount} muted</span>
          )}
        </span>
        <span className="text-[11px] text-text-secondary shrink-0">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2">
          {context.identityLine && (
            <p className="text-[11px] text-text-secondary leading-relaxed border-l-2 border-sage-300 pl-2">
              {context.identityLine}
            </p>
          )}
          {blocks.map(block => {
            const muted = isWithheld(block)
            // Only the per-generation toggle is checkable. A block dropped
            // because its section is de-selected is shown as withheld but not
            // re-enabled from here — that switch lives in the section chips,
            // and offering two controls for one outcome would let them
            // disagree on screen.
            //
            // Keyed on WHY it is withheld, not on whether it is: this used to
            // read `!block.muted`, which is also true of a block the user just
            // unchecked here — so the checkbox disabled itself on the way down
            // and there was no way back up.
            const togglable = canMute && block.mutedBy !== 'section'
            return (
              <div key={block.key} className={`rounded-lg border p-2 ${muted ? 'border-border bg-surface-subtle opacity-60' : 'border-border bg-white'}`}>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={!muted}
                    disabled={!togglable}
                    onChange={() => onToggleBlock?.(block.key)}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[11px] font-semibold text-text-primary">
                      {block.label}
                      {block.mutedBy === 'section' && (
                        <span className="ml-1.5 font-normal text-text-secondary">— not selected above, not being sent</span>
                      )}
                      {block.mutedBy === 'user' && (
                        <span className="ml-1.5 font-normal text-text-secondary">— muted for this generation</span>
                      )}
                    </span>
                    <span className={`block text-[10px] text-text-secondary whitespace-pre-wrap leading-relaxed ${muted ? 'line-through' : ''}`}>
                      {block.text.length > 600 ? `${block.text.slice(0, 600)}…` : block.text}
                    </span>
                  </span>
                </label>
              </div>
            )
          })}
          {canMute && (
            <p className="text-[10px] text-text-secondary leading-relaxed">
              Unchecking a block drops it from <em>this generation only</em>. Your saved Brand Brain is not changed.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Conflict notice ───────────────────────────────────────────────────────
// Rendered from the `conflicts` array the Enhance call now returns. Enhance
// already ran before generation and already had both the brief and the brand
// context in hand, so this costs nothing extra and — importantly — lands
// BEFORE the paid image round rather than after it.
//
// It reports rather than blocks: sometimes the contradiction is deliberate.
// "Use mine" keeps the prompt as written; "Use brand" is offered only when
// the parent supplies a handler, since not every surface can rewrite a prompt.
export function BrandConflictNotice({ conflicts, onUseBrand, onDismiss }) {
  if (!conflicts?.length) return null
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
      {conflicts.map((c, i) => (
        <div key={i} className="text-[11px] leading-relaxed">
          <span className="font-semibold text-amber-900">⚠ {c.field}</span>
          <span className="text-amber-800">
            {' — '}your prompt asks for <strong>{c.promptAsks}</strong>; the brand default is <strong>{c.brandRule}</strong>.
          </span>
        </div>
      ))}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={onDismiss}
          className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-amber-300 text-amber-900 hover:bg-amber-100"
        >
          Use mine
        </button>
        {onUseBrand && (
          <button
            type="button"
            onClick={onUseBrand}
            className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-border text-text-secondary hover:bg-white"
          >
            Use brand default
          </button>
        )}
        <span className="text-[10px] text-amber-700">
          Your prompt wins either way unless it breaks a brand guardrail.
        </span>
      </div>
    </div>
  )
}
