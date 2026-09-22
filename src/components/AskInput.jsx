import { useEffect, useRef } from 'react'

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
}) {
  const own = useRef(null)
  const ref = inputRef || own

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
    if (e.key !== 'Enter' || e.shiftKey) return
    // A composition session is an IME mid-word — Arabic, Chinese, anything
    // with a candidate window. Enter there commits the candidate and must not
    // send the message. `keyCode === 229` is the long-standing cross-browser
    // tell that survives where isComposing is unreliable, and this app is
    // bilingual, so getting it wrong would send half-typed Arabic.
    if (e.nativeEvent?.isComposing || e.keyCode === 229) return
    e.preventDefault()
    if (!disabled && value.trim()) onSubmit?.()
  }

  return (
    <textarea
      ref={ref}
      rows={MIN_ROWS}
      value={value}
      onChange={e => onChange(e.target.value)}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      // `resize-none` because the box sizes itself — a drag handle that fights
      // the auto-grow would make the height jump on the next keystroke.
      // `break-words` so a pasted URL wraps instead of forcing a sideways
      // scrollbar, which is the exact failure this component replaces.
      className={
        'flex-1 text-sm px-3 py-2 border border-border bg-white placeholder-text-tertiary resize-none break-words ' +
        'leading-5 focus:outline-none focus:ring-1 focus:ring-amber-700 focus:border-amber-700 disabled:bg-surface-subtle ' +
        className
      }
    />
  )
}
