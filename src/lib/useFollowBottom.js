import { useLayoutEffect, useRef, useState } from 'react'

// ─── Follow a streaming answer, but let go when the reader scrolls up ──────
// The assistant used to run `scrollIntoView` on every streamed chunk, so the
// moment someone scrolled up to re-read the start of an answer the next chunk
// yanked them back down — mid-response the conversation could not be scrolled
// at all. (On /agent it also dragged the whole page, because scrollIntoView
// scrolls every ancestor, not just the chat box.)
//
// Now the box follows only while the reader is at the bottom. Scrolling up
// detaches it; scrolling back to the bottom, pressing "Latest", or asking a
// new question re-attaches it.

// Within this many pixels of the end counts as "at the bottom". Generous
// enough to absorb sub-pixel rounding and a half-rendered line, small enough
// that one wheel notch up (~100px) always detaches.
export const NEAR_BOTTOM_PX = 40

/**
 * Whether to keep following after a scroll event.
 *
 * Moving UP always detaches, even within the threshold — otherwise the first
 * small nudge upward is undone by the next chunk and the reader can never get
 * away from the bottom. Our own programmatic scrolls only ever move down.
 */
export function shouldFollow({ prevTop, top, scrollHeight, clientHeight }) {
  if (top < prevTop - 1) return false
  return scrollHeight - top - clientHeight <= NEAR_BOTTOM_PX
}

/**
 * @param boxRef     ref to the scrolling element (the caller owns it)
 * @param content    changes whenever the conversation grows (the turns array)
 * @param attachKey  a change re-attaches — pass the number of turns, so a new
 *                   question always brings the reader down to its answer
 * @returns { onScroll, following, jumpToLatest }
 */
export function useFollowBottom(boxRef, content, attachKey) {
  const lastTop = useRef(0)
  const [following, setFollowing] = useState(true)

  // A new question re-attaches. Adjusted during render rather than in an
  // effect, so the follow below already sees `true` on the same pass.
  const [seenKey, setSeenKey] = useState(attachKey)
  if (seenKey !== attachKey) {
    setSeenKey(attachKey)
    setFollowing(true)
  }

  const toBottom = () => {
    const el = boxRef.current
    if (!el) return
    // Instant, not smooth: a smooth scroll still animating when the next chunk
    // lands reports positions short of the bottom, which read as "the reader
    // scrolled up".
    el.scrollTop = el.scrollHeight
    lastTop.current = el.scrollTop
  }

  const onScroll = () => {
    const el = boxRef.current
    if (!el) return
    setFollowing(shouldFollow({
      prevTop: lastTop.current, top: el.scrollTop,
      scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
    }))
    lastTop.current = el.scrollTop
  }

  // A layout effect so the jump happens before paint: no frame where the new
  // text is drawn below the fold and then snaps into view.
  useLayoutEffect(() => {
    if (following) toBottom()
  }, [content, attachKey, following]) // eslint-disable-line react-hooks/exhaustive-deps

  const jumpToLatest = () => {
    setFollowing(true)
    toBottom()
  }

  return { onScroll, following, jumpToLatest }
}
