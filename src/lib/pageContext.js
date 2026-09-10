// ─── The page's context descriptor ─────────────────────────────────────────
// AGENT.md §5a. The panel opens anywhere and knows what you are looking at,
// and it learns that from a small TYPED descriptor — a route, an entity type
// and an id — never a scrape of the DOM and never the rendered page.
//
// Why that restriction is worth keeping: a DOM scrape is unbounded input of
// unknown provenance going straight into a prompt. It would carry whatever a
// competitor wrote in a caption we happen to be rendering, and there is no
// point building a tool layer that refuses cross-tenant reads if the page can
// paste arbitrary text into the model's context for free.
//
// The agent fetches what it needs through tools from the id. The composer is
// the one deliberate exception (§5b) and passes `draft`, because an unsaved
// post has no id to fetch by, and asking someone to save a half-finished post
// before they can ask about it would defeat the purpose.

/**
 * Turn a location into the descriptor the agent receives.
 *
 * Route patterns are matched most-specific first. An unrecognised route still
 * yields a useful descriptor — the route alone tells the agent where the
 * person is, which is most of the value.
 *
 * @param {{pathname:string, search?:string}} location
 * @returns {{route:string, entity?:string, id?:string}}
 */
export function describePage(location) {
  const route = location?.pathname || ''
  const params = new URLSearchParams(location?.search || '')

  // /campaigns/plan/post/:rowId — the post editor
  const postEditor = route.match(/^\/campaigns\/plan\/post\/([^/]+)$/)
  if (postEditor) return { route, entity: 'post', id: postEditor[1] }

  // /social/:platform — a platform page, often with a selected post in the query
  const platform = route.match(/^\/social\/([^/]+)$/)
  if (platform && !['approvals'].includes(platform[1])) {
    const postId = params.get('post') || params.get('id')
    return postId
      ? { route, entity: 'post', id: postId }
      : { route, entity: 'platform', id: platform[1] }
  }

  // /campaigns/plan?plan=<id> — the planner
  if (route.startsWith('/campaigns/plan')) {
    const planId = params.get('plan') || params.get('plan_id')
    return planId ? { route, entity: 'plan', id: planId } : { route }
  }

  return { route }
}

/**
 * A short, human-readable label for what the agent can currently see.
 *
 * Shown in the drawer so the person knows what "this" refers to when they type
 * "why did this flop?". An assistant that silently has context is harder to
 * trust than one that says what it has.
 */
export function describeContextLabel(context) {
  if (!context) return ''
  if (context.draft) return 'the draft you are writing'
  if (context.entity === 'post') return 'the post you are viewing'
  if (context.entity === 'plan') return 'this content plan'
  if (context.entity === 'platform') return `your ${context.id} page`
  return ''
}

/** Starter questions worth offering, given where the person is standing. */
export function suggestionsFor(context) {
  const generic = [
    'What do you know about this brand?',
    'Who are our competitors, and which can you see on Instagram?',
    'What have we learned so far?',
  ]
  if (!context) return generic
  if (context.entity === 'post') {
    return [
      'How did this post do?',
      'Why might this have underperformed?',
      'What would you change about this caption?',
    ]
  }
  if (context.entity === 'plan') {
    return [
      'Is anything missing from this plan?',
      'Does this plan repeat something we already posted?',
      'What is the weakest idea here, and why?',
    ]
  }
  if (context.route === '/schedule') {
    return ['What is queued this week?', 'Are there gaps in the calendar?', ...generic.slice(0, 1)]
  }
  if (context.route?.startsWith('/analytics') || context.route?.startsWith('/insights')) {
    return ['How have our posts performed?', 'What format works best for us?', 'What changed this week?']
  }
  return generic
}
