import { useCallback, useRef, useState } from 'react'
import { prepareAttachment, overLimit } from './chatAttachments'

// ─── The files waiting to go with the next question ────────────────────────
// State for components/ChatAttachments.jsx — see that file's header. Kept
// here rather than beside the components because fast refresh only works on a
// file that exports components alone.

export function useChatAttachments() {
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  const [preparing, setPreparing] = useState(false)
  // The latest list, for the limit check. A state updater runs later than the
  // code after it, so a check inside one cannot report its verdict in time.
  const current = useRef([])

  const commit = useCallback(next => { current.current = next; setItems(next) }, [])

  const add = useCallback(async files => {
    const list = Array.from(files || []).filter(Boolean)
    if (!list.length) return
    setError('')
    setPreparing(true)
    const ready = []
    let problem = ''
    for (const f of list) {
      try { ready.push(await prepareAttachment(f)) } catch (err) { problem = err?.message || String(err) }
    }
    const tooMany = overLimit(current.current, ready)
    if (tooMany) problem = tooMany
    else if (ready.length) commit([...current.current, ...ready])
    setError(problem)
    setPreparing(false)
  }, [commit])

  const remove = useCallback(id => {
    commit(current.current.filter(a => a.id !== id))
    setError('')
  }, [commit])

  const clear = useCallback(() => { commit([]); setError('') }, [commit])

  // Only files are taken from a paste. A paste of plain text falls through to
  // the textarea untouched — preventDefault there would swallow every
  // ordinary paste of a sentence.
  const onPaste = useCallback(e => {
    const files = Array.from(e.clipboardData?.files || [])
      .filter(f => f.type.startsWith('image/') || f.type === 'application/pdf')
    if (!files.length) return
    e.preventDefault()
    add(files)
  }, [add])

  return { items, error, preparing, add, remove, clear, onPaste }
}

