import { useState } from 'react'
import ReactDOM from 'react-dom/client'
import AskInput from '../components/AskInput'
import '../index.css'

// ─── Dev-only composer harness ─────────────────────────────────────────────
// Mounts the assistant's question box on its own, so the thing the change is
// actually about — does it grow, does it stop growing, does Enter send — can be
// seen in a browser without signing in. The assistant is behind auth and needs
// a workspace, a thread and a streaming endpoint before its composer is even on
// screen, none of which this is testing.
//
// Both real surfaces are reproduced: the 448px drawer, where the box is
// narrowest and the old single-line input failed soonest, and the full-width
// page. Same component in both, which is the point.
//
// Served by Vite at /dev-ask.html. Vite only builds index.html, so this never
// reaches a production bundle.

function Surface({ title, width }) {
  const [question, setQuestion] = useState('')
  const [sent, setSent] = useState([])

  return (
    <div className="mb-10">
      <div className="text-xs font-mono text-slate-400 mb-2">{title}</div>
      <div className="border border-slate-200 rounded-xl bg-white" style={{ width }}>
        <div className="p-3 text-xs text-slate-500 border-b border-slate-100 min-h-[80px]">
          {sent.length === 0
            ? 'Nothing sent yet. Enter sends, Shift+Enter makes a new line.'
            : sent.map((s, i) => (
                <div key={i} className="mb-1 text-slate-700 whitespace-pre-wrap">↳ {s}</div>
              ))}
        </div>
        <form
          onSubmit={e => { e.preventDefault(); if (question.trim()) { setSent(v => [...v, question]); setQuestion('') } }}
          className="p-3 border-t border-slate-100 flex gap-2 items-end"
        >
          <AskInput
            value={question}
            onChange={setQuestion}
            onSubmit={() => { if (question.trim()) { setSent(v => [...v, question]); setQuestion('') } }}
            placeholder="Ask anything…"
          />
          <button
            type="submit"
            disabled={!question.trim()}
            className="text-sm px-3 py-2 rounded-lg bg-slate-900 text-white disabled:bg-slate-200 disabled:text-slate-400"
          >
            Ask
          </button>
        </form>
      </div>
    </div>
  )
}

// Exported, like the other harnesses: Fast Refresh only tracks components in
// a module that exports them, and a harness you have to hard-reload to see a
// change in is a harness nobody uses twice.
export function AskHarness() {
  return (
    <div className="p-8 bg-slate-50 min-h-screen">
      <h1 className="text-lg font-semibold text-slate-900 mb-1">Ask input</h1>
      <p className="text-sm text-slate-500 mb-6">
        Type a long question. The box should wrap and grow to eight lines, then scroll.
      </p>
      <Surface title="drawer — 448px" width={448} />
      <Surface title="/agent page — full width" width="100%" />
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<AskHarness />)
