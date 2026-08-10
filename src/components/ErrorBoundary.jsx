import { Component } from 'react'

// ─── The last line of defence against a white screen ───────────────────────
// React unmounts the ENTIRE tree when a render throws and nothing catches it.
// With no boundary anywhere in this app, one bad value — a null where an
// object was expected, a malformed row coming back from Supabase — took out
// the whole page and left a blank white document with the real error visible
// only in the console. Nobody outside engineering ever finds it there.
//
// A class is not a style choice: componentDidCatch/getDerivedStateFromError
// have no hook equivalent, so an error boundary can only be written this way.
//
// Deliberately NOT wrapped around the router itself but INSIDE it (see
// App.jsx), so the sidebar survives the crash and there is somewhere to
// navigate to — a boundary at the very top would replace the whole app and
// leave "reload" as the only way out.
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Kept for the console//devtools — this is the detail that used to be the
    // only trace a crash ever left.
    console.error('Unhandled render error:', error, info?.componentStack)
  }

  // Without this, navigating away from a crashed page leaves the fallback on
  // screen forever: the boundary has no idea the route changed. App.jsx keys
  // it on the pathname, which remounts it and clears the error.
  render() {
    if (!this.state.error) return this.props.children

    const message = this.state.error?.message || String(this.state.error)
    return (
      <div className="p-8 max-w-xl">
        <div className="border border-red-200 bg-red-50 p-5">
          <h2 className="text-sm font-semibold text-red-800">This page hit an error</h2>
          <p className="text-xs text-red-700 mt-1.5 leading-relaxed">
            Nothing has been lost — anything already generated is saved and will still be
            there. You can go back and carry on.
          </p>
          <pre className="mt-3 p-2 bg-white/70 border border-red-200 text-[10px] text-red-900 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
            {message}
          </pre>
          <div className="flex gap-2 mt-4">
            <button type="button" onClick={() => this.setState({ error: null })}
              className="border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50">
              Try again
            </button>
            <button type="button" onClick={() => { window.location.href = '/' }}
              className="border border-border bg-white px-3 py-1.5 text-xs font-semibold text-text hover:bg-surface-subtle">
              Back to dashboard
            </button>
          </div>
        </div>
      </div>
    )
  }
}
