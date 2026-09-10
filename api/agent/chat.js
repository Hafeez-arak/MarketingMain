import { callerId, callerMayUseWorkspace, db, isConfigured } from './_supabase.js'
import { loadBrandContext, IDENTITY, prefixRisk } from './_context.js'
import { runAgent } from './_loop.js'
import { contextPreamble } from '../../src/lib/agent/prompt.js'

// ─── POST /api/agent/chat ──────────────────────────────────────────────────
// The assistant answering now. AGENT.md §5a.
//
// Body:
//   { workspace_id, question, thread_id?, context? }
//
// `context` is the page's typed descriptor — a route, an entity type and an
// id — never a scrape of the DOM and never the rendered page. The agent
// fetches what it needs through tools from there. The composer is the one
// exception and passes `draft`, because an unsaved post has no id to fetch by.
//
// Streams Server-Sent Events. Node's default runtime streams with no config;
// this deliberately does not opt into the edge runtime.

/** One SSE frame. Named so every write goes through the same shape. */
function send(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only.' })
    return
  }
  if (!isConfigured) {
    // Named rather than swallowed. A missing key looking exactly like "the
    // feature silently does nothing" has cost this project a day once already.
    res.status(500).json({ error: 'Supabase is not configured on this deployment.' })
    return
  }

  let body
  try {
    body = await readBody(req)
  } catch {
    res.status(400).json({ error: 'Body must be JSON.' })
    return
  }

  const workspaceId = String(body.workspace_id || '').trim()
  const question = String(body.question || '').trim()
  const threadId = String(body.thread_id || '').trim()
  const context = body.context || null

  if (!workspaceId || !question) {
    res.status(400).json({ error: 'workspace_id and question are both required.' })
    return
  }

  // ── Who is asking, and may they? ──
  // Both questions answered BEFORE anything that costs money, and answered
  // with the caller's own token so RLS resolves them. A workspace_id in a
  // request body is not evidence of anything.
  const userId = await callerId(req)
  if (!userId) {
    res.status(401).json({ error: 'Sign in to use the assistant.' })
    return
  }
  const allowed = await callerMayUseWorkspace(req, workspaceId)
  if (!allowed) {
    res.status(403).json({ error: 'You do not have access to this workspace.' })
    return
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Proxies that buffer will hold the whole answer and deliver it at once,
    // which looks exactly like the agent hanging.
    'X-Accel-Buffering': 'no',
  })

  let chatId = ''
  try {
    // ── The thread ──
    // One conversation per workspace, persisted, so walking from Analytics to
    // the Planner continues it rather than restarting. That continuity is the
    // difference between an assistant and a search box.
    if (threadId) {
      const rows = await db(
        `research_chats?id=eq.${encodeURIComponent(threadId)}` +
        `&workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id`,
      )
      // Scoped by workspace as well as by id: a thread id from another
      // workspace must not attach here, and the id alone would let it.
      chatId = rows?.[0]?.id || ''
    }
    if (!chatId) {
      const created = await db('research_chats', {
        method: 'POST',
        body: { workspace_id: workspaceId, title: question.slice(0, 80) },
        prefer: 'return=representation',
      })
      chatId = created?.[0]?.id || ''
    }
    send(res, 'thread', { thread_id: chatId })

    // ── History ──
    // Loaded from the store rather than trusted from the client. A browser
    // that posts its own history is a browser that can post anything into the
    // model's context, and that is a trust boundary which gets harder to close
    // the longer it stands.
    const history = await db(
      `research_messages?chat_id=eq.${encodeURIComponent(chatId)}` +
      `&workspace_id=eq.${encodeURIComponent(workspaceId)}` +
      `&order=created_at.asc&limit=40&select=role,content`,
    )

    const { brand } = await loadBrandContext(workspaceId, 'chat')

    // The cache guard. Prompt caching fails silently — a prefix that stops
    // being byte-identical still answers correctly, at roughly ten times the
    // price on the prefix, and nothing in the response says so.
    const risk = prefixRisk({ identity: IDENTITY, brand })
    if (risk) console.error(`[agent] volatile fragment in cached prefix: ${risk}`)

    // The page descriptor is the volatile TAIL of the user turn — never the
    // system prompt, which is the whole point of putting it here.
    const preamble = contextPreamble(context)
    const messages = [
      ...(history || []).map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: preamble ? `${preamble}\n\n${question}` : question },
    ]

    await db('research_messages', {
      method: 'POST',
      body: { chat_id: chatId, workspace_id: workspaceId, role: 'user', content: question },
      prefer: 'return=minimal',
    })

    const result = await runAgent({
      workspaceId, job: 'chat', surface: 'chat', chatId,
      identity: IDENTITY, brand, messages,
      // Writes on, because "draft me a carousel for Thursday" and "add that as
      // a rule" are the natural asks here and an assistant that can only talk
      // is a search box. Everything still lands as a proposal or a draft, and
      // the identity prompt tells it to write only when asked — an assistant
      // that files a proposal every time it has an opinion is one whose review
      // queue nobody opens.
      writes: true,
      onText: delta => send(res, 'text', { delta }),
      onEvent: event => send(res, 'step', event),
    })

    if (!result.ok) {
      // A cap refusal reaches the person verbatim: "the agent did nothing" and
      // "this workspace is out of budget until the 1st" are different problems
      // and only one of them is fixable by the person reading it.
      send(res, 'error', { error: result.error, refused: result.refused })
    } else {
      await db('research_messages', {
        method: 'POST',
        body: {
          chat_id: chatId, workspace_id: workspaceId, role: 'assistant',
          content: result.text,
          // Kept so an answer can be audited after the fact — the same reason
          // the report keeps its sources. An answer you cannot audit is an
          // answer you cannot trust.
          tool_calls: result.toolCalls,
          sources: [...result.allowedUrls],
        },
        prefer: 'return=minimal',
      })
      await db(`research_chats?id=eq.${encodeURIComponent(chatId)}`, {
        method: 'PATCH',
        body: { updated_at: new Date().toISOString() },
        prefer: 'return=minimal',
      })
    }

    send(res, 'done', {
      thread_id: chatId,
      ok: result.ok,
      turns: result.turns,
      tools: result.toolCalls.map(t => t.name),
      cost_usd: Number(result.cost.toFixed(6)),
      stopped_by: result.stoppedBy,
    })
  } catch (err) {
    // The browser opened a spinner and only the server can close it. Every
    // terminal path writes a terminal event — a crash that writes nothing
    // leaves a spinner nobody can close, which draft_status taught this
    // project expensively.
    console.error('[agent/chat]', err)
    send(res, 'error', { error: err?.message || 'The assistant failed unexpectedly.' })
    send(res, 'done', { thread_id: chatId, ok: false, stopped_by: 'exception' })
  } finally {
    res.end()
  }
}
