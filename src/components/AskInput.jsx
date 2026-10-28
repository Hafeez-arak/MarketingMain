import { useEffect, useRef, useState } from 'react'
import { mentionQuery, matchMentions, insertMention } from '../lib/mentions'

// ─── The box you type the question into ────────────────────────────────────
//
// It was an `<input>`. One line, fixed height, no wrap — so a question longer
// than about sixty characters scrolled sideways under the cursor and every
// word you had already written went out of view. You could not re-read what
// you were asking, could not see the start of a sentence while finishing it,
// and could not tell a typo from a scroll. For an assistant whose best
// questions are the specific, paragraph-long ones, that box quietly taught
// people to ask short, vague ones instead.
//
// A textarea that grows with its content fixes all of it. Both surfaces — the
// drawer and the /agent page — use this one component, because they are the
// same conversation and a composer that behaves differently depending on which
// one you opened is two bugs waiting to be reported separately.
//
// ── THE THREE THINGS THAT MAKE IT FEEL RIGHT ──
//
//   1. Enter sends, Shift+Enter makes a newline. The convention every chat
//      interface shares, and the reason this is a textarea rather than a
//      contenteditable: the browser's own multi-line editing, undo history and
//      IME behaviour are correct for free.
//
//   2. It grows to MAX_ROWS and then scrolls, rather than growing forever. An
//      unbounded box eventually eats the conversation it is asking about.
//
//   3. It shrinks back. Measuring requires resetting the height to 'auto'
//      first — without that, scrollHeight can only ever report the height the
//      box already has, so it ratchets upward and never comes back down after
//      you delete a paragraph or send.

/** Below this it is a single line, same as the input it replaces. */
const MIN_ROWS = 1
/** Above this it scrolls. Roughly eight lines is a long question, not a post. */
const MAX_ROWS = 8

/**
 * Size one textarea to its content, clamped between MIN_ROWS and MAX_ROWS.
 *
 * At module scope, taking the element, rather than a useCallback closing over
 * the ref. The React Compiler refuses to optimise a memoised callback that
 * reads `ref.current` — the dependency it infers is the current value, not the
 * ref — and a plain function that takes what it needs has no such ambiguity.
 */
function fit(el) {
  if (!el) return

  // Reset first. scrollHeight is bounded below by the element's current
  // height, so measuring without this only ever reports "at least as tall as
  // it already is" — the box would grow and never shrink back after a delete
  // or a send.
  el.style.height = 'auto'

  // Line height read from the computed style rather than hardcoded, so this
  // keeps working if the font or the Tailwind text size changes. The 20px
  // fallback matches text-sm's leading and is only reached where there is no
  // layout at all, such as jsdom.
  const styles = window.getComputedStyle(el)
  const line = parseFloat(styles.lineHeight) || 20
  const padding = (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0)
  const border = (parseFloat(styles.borderTopWidth) || 0) + (parseFloat(styles.borderBottomWidth) || 0)

  const max = line * MAX_ROWS + padding + border
  const min = line * MIN_ROWS + padding + border
  const wanted = el.scrollHeight + border

  el.style.height = `${Math.min(Math.max(wanted, min), max)}px`
  // Only scrollable once it has stopped growing — otherwise a scrollbar
  // flickers in and out during the grow.
  el.style.overflowY = wanted > max ? 'auto' : 'hidden'
}

export default function AskInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled = false,
  autoFocus = false,
  inputRef,
  className = '',
  // Attachments (ChatAttachments.jsx): a pasted screenshot becomes a file, and
  // a message that is only a file may be sent with Enter.
  onPaste,
  canSubmitEmpty = false,
  // People who can be @-tagged (useTaggable). Typing "@" opens a picker; the
  // assistant reads "@Sara" in the message and files the request.
  mentions = [],
}) {
  const own = useRef(null)
  const ref = inputRef || own
  const [picker, setPicker] = useState(null) // { start, query, index }
  const matches = picker ? matchMentions(mentions, picker.query) : []

  function handleChange(e) {
    const text = e.target.value
    onChange(text)
    const q = mentions.length ? mentionQuery(text, e.target.selectionStart ?? text.length) : null
    setPicker(q ? { ...q, index: 0 } : null)
  }

  function choose(person) {
    const el = ref.current
    const caret = el?.selectionStart ?? value.length
    const next = insertMention(value, picker.start, caret, person.name)
    onChange(next.text)
    setPicker(null)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(next.caret, next.caret)
    })
  }

  // On every value change, not just on keystrokes. The value is also set from
  // outside — a suggestion chip filling the box, `send()` clearing it — and a
  // box that only measured its own typing would stay tall after a send.
  useEffect(() => { fit(ref.current) }, [value, ref])

  // The window can change width without the value changing: opening the
  // drawer, or rotating a phone, rewraps the same text onto more lines.
  useEffect(() => {
    const onResize = () => fit(ref.current)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [ref])

  function handleKeyDown(e) {
    // The picker takes the arrow keys, Enter, Tab and Escape while it is open.
    if (picker && matches.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const step = e.key === 'ArrowDown' ? 1 : -1
        setPicker(p => ({ ...p, index: (p.index + step + matches.length) % matches.length }))
        return
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault()
        choose(matches[Math.min(picker.index, matches.length - 1)])
        return
      }
      if (e.key === 'Escape') { e.preventDefault(); setPicker(null); return }
    }
    if (e.key !== 'Enter' || e.shiftKey) return
    // A composition session is an IME mid-word — Arabic, Chinese, anything
    // with a candidate window. Enter there commits the candidate and must not
    // send the message. `keyCode === 229` is the long-standing cross-browser
    // tell that survives where isComposing is unreliable, and this app is
    // bilingual, so getting it wrong would send half-typed Arabic.
    if (e.nativeEvent?.isComposing || e.keyCode === 229) return
    e.preventDefault()
    if (!disabled && (value.trim() || canSubmitEmpty)) onSubmit?.()
  }

  return (
    <div className="relative flex-1 flex min-w-0">
      <textarea
        ref={ref}
        rows={MIN_ROWS}
        value={value}
        onChange={handleChange}
        onBlur={() => setTimeout(() => setPicker(null), 120)}
        onKeyDown={handleKeyDown}
        onPaste={onPaste}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        // `resize-none` because the box sizes itself — a drag handle that fights
        // the auto-grow would make the height jump on the next keystroke.
        // `break-words` so a pasted URL wraps instead of forcing a sideways
        // scrollbar, which is the exact failure this component replaces.
        className={
          'w-full text-sm px-3 py-2 border border-border bg-white placeholder-text-tertiary resize-none break-words ' +
          'leading-5 focus:outline-none focus:ring-1 focus:ring-amber-700 focus:border-amber-700 disabled:bg-surface-subtle ' +
          className
        }
      />
      {picker && matches.length > 0 && (
        <ul role="listbox" className="absolute left-0 bottom-full mb-1 w-60 bg-white border border-border shadow-dropdown z-50 py-1">
          <li className="px-3 pt-1 pb-1.5 text-[10px] uppercase tracking-wide text-text-tertiary">Tag someone</li>
          {matches.map((p, i) => (
            <li key={p.user_id || p.name}>
              <button type="button" role="option" aria-selected={i === picker.index}
                onMouseDown={e => { e.preventDefault(); choose(p) }}
                className={`w-full text-left px-3 py-1.5 text-sm flex items-baseline gap-2 ${i === picker.index ? 'bg-amber-50 text-text' : 'text-text-secondary hover:bg-surface-subtle'}`}>
                <span className="font-medium capitalize">{p.name}</span>
                {p.label && <span className="text-[11px] text-text-tertiary">{p.label}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
