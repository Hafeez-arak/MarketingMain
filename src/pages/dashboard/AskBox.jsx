import { useState } from 'react'
import { Button } from '../../components/ui/index'
import AskInput from '../../components/AskInput'
import { useAuth } from '../../store/auth'
import { useTaggable } from '../../lib/useTaggable'
import { askAssistant } from '../../lib/askAssistant'

// ─── Ask Arak ──────────────────────────────────────────────────────────────
// 2026-10-18. The CEO asked for "a comment box" for the company assistant:
// to ask, to say what is not good, to tag someone. The assistant already
// lived in a corner button; this puts its box at the top of the first page,
// where it is the first thing seen rather than something to find. Asking
// here opens the assistant with the answer streaming, so the conversation
// continues there.

const STARTERS = [
  'How is the company doing this week?',
  'What should I worry about right now?',
  'Which enquiries need an owner today?',
  'What happened to my requests?',
]

export function AskBox() {
  const { activeWorkspaceId } = useAuth()
  const people = useTaggable(activeWorkspaceId)
  const [text, setText] = useState('')

  const send = q => {
    const question = (q ?? text).trim()
    if (!question) return
    askAssistant({ question, send: true })
    setText('')
  }

  return (
    <section className="border border-border bg-white px-4 py-3.5" aria-label="Ask Arak">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h2 className="text-sm font-semibold text-text">Ask Arak</h2>
        <p className="text-[11px] text-text-tertiary hidden sm:block">
          Anything about the company. Say what isn't good, or @ to tag someone.
        </p>
      </div>
      <form className="flex gap-2 items-end" onSubmit={e => { e.preventDefault(); send() }}>
        <AskInput value={text} onChange={setText} onSubmit={() => send()} mentions={people}
          placeholder="e.g. Why are we slow to answer enquiries, and how do we fix it?" />
        <Button type="submit" disabled={!text.trim()}>Ask</Button>
      </form>
      <div className="flex flex-wrap gap-1.5 mt-2.5">
        {STARTERS.map(s => (
          <button key={s} type="button" onClick={() => send(s)}
            className="text-[11px] px-2 py-1 border border-border text-text-secondary hover:border-stone-400 hover:text-text transition-colors">
            {s}
          </button>
        ))}
      </div>
    </section>
  )
}
