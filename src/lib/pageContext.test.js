import { describe, it, expect } from 'vitest'
import { describePage, describeContextLabel, suggestionsFor } from './pageContext'
import { contextPreamble } from './agent/prompt'

describe('the page hands over a pointer, never its content', () => {
  it('yields only a route, an entity type and an id', () => {
    // AGENT.md §5a. A DOM scrape would be unbounded input of unknown
    // provenance going straight into a prompt — it would carry whatever a
    // competitor wrote in a caption we happen to be rendering. There is no
    // point building a tool layer that refuses cross-tenant reads if the page
    // can paste arbitrary text into the model's context for free.
    const ctx = describePage({ pathname: '/campaigns/plan/post/abc-123' })
    expect(Object.keys(ctx).sort()).toEqual(['entity', 'id', 'route'])
    expect(ctx).toEqual({ route: '/campaigns/plan/post/abc-123', entity: 'post', id: 'abc-123' })
  })

  it('an unknown route still gives the agent the route', () => {
    // Most of the value is knowing where the person is standing, so an
    // unmatched page degrades to useful rather than to nothing.
    expect(describePage({ pathname: '/something/new' })).toEqual({ route: '/something/new' })
  })

  it('reads a selected post out of the query string', () => {
    const ctx = describePage({ pathname: '/social/instagram', search: '?post=xyz' })
    expect(ctx).toMatchObject({ entity: 'post', id: 'xyz' })
  })

  it('falls back to the platform when no post is selected', () => {
    const ctx = describePage({ pathname: '/social/instagram' })
    expect(ctx).toMatchObject({ entity: 'platform', id: 'instagram' })
  })

  it('does not mistake /social/approvals for a platform', () => {
    expect(describePage({ pathname: '/social/approvals' })).toEqual({ route: '/social/approvals' })
  })

  it('picks up a plan id from the planner', () => {
    const ctx = describePage({ pathname: '/campaigns/plan', search: '?plan=p1' })
    expect(ctx).toMatchObject({ entity: 'plan', id: 'p1' })
  })
})

describe('the descriptor renders into the volatile tail, not the system prompt', () => {
  it('a route and id become a short preamble', () => {
    const text = contextPreamble(describePage({ pathname: '/campaigns/plan/post/abc' }))
    expect(text).toMatch(/on \/campaigns\/plan\/post\/abc/)
    expect(text).toMatch(/post abc/)
  })

  it('an empty context adds nothing at all', () => {
    // Nothing to say means no tokens spent saying it.
    expect(contextPreamble(null)).toBe('')
    expect(contextPreamble({})).toBe('')
  })

  it('the composer exception passes the draft itself, and only its shape', () => {
    // §5b: an unsaved post has no id to fetch by, so this is the one place the
    // page hands over content. It is still bounded — caption, format, platform
    // and a media COUNT, never the media itself.
    const text = contextPreamble({
      route: '/campaigns/plan/post/new',
      draft: { platform: 'instagram', format: 'carousel', caption: 'Hello', media: [1, 2, 3] },
    })
    expect(text).toMatch(/not saved yet/i)
    expect(text).toContain('"media_count": 3')
    expect(text).not.toContain('[1,2,3]')
  })
})

describe('what it offers to ask depends on where you are', () => {
  it('offers post questions on a post', () => {
    const s = suggestionsFor({ route: '/x', entity: 'post', id: '1' })
    expect(s.join(' ')).toMatch(/this post/i)
  })

  it('offers schedule questions on the schedule', () => {
    expect(suggestionsFor({ route: '/schedule' }).join(' ')).toMatch(/queued|calendar/i)
  })

  it('falls back to brand questions with no context', () => {
    expect(suggestionsFor(null).join(' ')).toMatch(/brand/i)
  })
})

describe('the drawer tells the person what it can see', () => {
  it('names the entity in plain words', () => {
    expect(describeContextLabel({ entity: 'post' })).toMatch(/post/)
    expect(describeContextLabel({ entity: 'plan' })).toMatch(/plan/)
    expect(describeContextLabel({ entity: 'platform', id: 'instagram' })).toMatch(/instagram/)
  })

  it('says nothing when it has nothing', () => {
    // An assistant that silently has context is harder to trust than one that
    // says what it has — and claiming context it lacks is worse than both.
    expect(describeContextLabel({ route: '/' })).toBe('')
    expect(describeContextLabel(null)).toBe('')
  })

  it('the draft case wins over an entity id', () => {
    expect(describeContextLabel({ entity: 'post', id: '1', draft: {} })).toMatch(/draft/)
  })
})
