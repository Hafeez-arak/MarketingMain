import { useCallback, useReducer } from 'react'

// ─── Undo/redo with gesture coalescing ─────────────────────────────────────
// The old editor pushed a history entry per committed change, which meant a
// brightness-slider drag left ~40 undo steps behind it and undoing a resize
// took as many presses as the drag had frames. Canva's model is one step per
// GESTURE, so this splits the two things a change can be:
//
//   begin()  — "a gesture is starting". Marks the state dirty; costs nothing
//              if the gesture turns out to be a click that moved nothing.
//   apply(fn)— a frame of that gesture. The FIRST apply after a begin banks
//              the pre-gesture state into the past; every later one just
//              replaces the present. That's the coalescing.
//   commit(fn)— a discrete change with no gesture around it (add a layer,
//              delete, align, paste). Always its own history entry.
//
// The whole editor state travels together — { doc, base } — because crop,
// rotate and flip change the working canvas and the layer coordinates at the
// same moment, and undoing one without the other would produce a document
// whose layers refer to a photo that no longer exists at that size.

const LIMIT = 60

function reducer(state, action) {
  switch (action.type) {
    case 'reset':
      return { past: [], present: action.present, future: [], dirty: false }

    case 'begin':
      return state.dirty ? state : { ...state, dirty: true }

    case 'apply': {
      const present = action.fn(state.present)
      if (!present || present === state.present) return state
      if (!state.dirty) return { ...state, present }
      return { past: [...state.past, state.present].slice(-LIMIT), present, future: [], dirty: false }
    }

    case 'commit': {
      const present = action.fn(state.present)
      if (!present || present === state.present) return state
      return { past: [...state.past, state.present].slice(-LIMIT), present, future: [], dirty: false }
    }

    case 'undo': {
      if (!state.past.length) return state
      return {
        past: state.past.slice(0, -1),
        present: state.past[state.past.length - 1],
        future: [state.present, ...state.future].slice(0, LIMIT),
        dirty: false,
      }
    }

    case 'redo': {
      if (!state.future.length) return state
      return {
        past: [...state.past, state.present].slice(-LIMIT),
        present: state.future[0],
        future: state.future.slice(1),
        dirty: false,
      }
    }

    default:
      return state
  }
}

export function useEditorHistory() {
  const [state, dispatch] = useReducer(reducer, { past: [], present: null, future: [], dirty: false })

  const reset = useCallback(present => dispatch({ type: 'reset', present }), [])
  const begin = useCallback(() => dispatch({ type: 'begin' }), [])
  const apply = useCallback(fn => dispatch({ type: 'apply', fn }), [])
  const commit = useCallback(fn => dispatch({ type: 'commit', fn }), [])
  const undo = useCallback(() => dispatch({ type: 'undo' }), [])
  const redo = useCallback(() => dispatch({ type: 'redo' }), [])

  // Convenience wrappers so callers deal in documents rather than in the
  // {doc, base} envelope, which only crop/rotate/flip ever need to see.
  const applyDoc = useCallback(fn => apply(s => ({ ...s, doc: fn(s.doc) })), [apply])
  const commitDoc = useCallback(fn => commit(s => ({ ...s, doc: fn(s.doc) })), [commit])

  return {
    doc: state.present?.doc || null,
    base: state.present?.base || null,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    reset, begin, apply, commit, applyDoc, commitDoc, undo, redo,
  }
}
