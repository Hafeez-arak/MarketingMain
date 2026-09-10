// ─── Talking to the agent from the browser ─────────────────────────────────
// The client half of POST /api/agent/chat.
//
// fetch + a ReadableStream reader rather than EventSource, for one reason
// EventSource cannot work around: EventSource only issues GET requests and
// cannot set an Authorization header. The endpoint requires a bearer token
// before it will spend anything, so the request has to be a POST we control.

/**
 * Ask the agent something and receive the answer as it is typed.
 *
 * @param {object} args
 * @param {string} args.workspaceId
 * @param {string} args.accessToken   the signed-in user's Supabase session token
 * @param {string} args.question
 * @param {string} [args.threadId]    continue an existing conversation
 * @param {object} [args.context]     the page descriptor — route, entity, id
 * @param {(delta:string)=>void} [args.onText]
 * @param {(step:object)=>void} [args.onStep]
 * @param {AbortSignal} [args.signal]
 * @returns {Promise<{ok:boolean, threadId:string, text:string, error:string, tools:string[], cost:number}>}
 */
export async function askAgent({
  workspaceId, accessToken, question, threadId = '', context = null,
  onText, onStep, signal,
}) {
  const res = await fetch('/api/agent/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      workspace_id: workspaceId,
      question,
      thread_id: threadId || undefined,
      context: context || undefined,
    }),
    signal,
  })

  // A non-streaming failure — 401, 403, 500 — comes back as ordinary JSON,
  // because those are decided before the stream is opened. Reading it as a
  // stream would show the user nothing at all.
  if (!res.ok || !res.headers.get('content-type')?.includes('text/event-stream')) {
    let error = `The assistant returned ${res.status}.`
    try { error = (await res.json())?.error || error } catch { /* keep the status */ }
    return { ok: false, threadId, text: '', error, tools: [], cost: 0 }
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let outThread = threadId
  let error = ''
  let done = null

  // SSE frames are separated by a blank line and can arrive split across
  // chunks, so the buffer is only consumed up to the last complete frame.
  while (true) {
    const { value, done: finished } = await reader.read()
    if (finished) break
    buffer += decoder.decode(value, { stream: true })

    let split
    while ((split = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, split)
      buffer = buffer.slice(split + 2)

      const eventLine = frame.split('\n').find(l => l.startsWith('event: '))
      const dataLine = frame.split('\n').find(l => l.startsWith('data: '))
      if (!eventLine || !dataLine) continue

      const event = eventLine.slice(7).trim()
      let data
      // A frame we cannot parse is skipped rather than defaulted: an empty
      // object here would be dispatched as a real event with every field
      // undefined, which reads downstream as an answer with no text.
      try { data = JSON.parse(dataLine.slice(6)) } catch { continue }

      if (event === 'thread') outThread = data.thread_id || outThread
      else if (event === 'text') { text += data.delta || ''; onText?.(data.delta || '') }
      else if (event === 'step') onStep?.(data)
      else if (event === 'error') error = data.error || 'The assistant failed.'
      else if (event === 'done') done = data
    }
  }

  return {
    // `done` missing means the connection dropped before the server finished.
    // Treated as a failure rather than as success-with-no-answer: the second
    // reads as the agent having nothing to say, which is a different and much
    // more misleading thing.
    ok: Boolean(done?.ok) && !error,
    threadId: outThread,
    text,
    error: error || (done ? '' : 'The connection closed before the assistant finished.'),
    tools: done?.tools || [],
    cost: done?.cost_usd || 0,
    stoppedBy: done?.stopped_by || '',
  }
}
