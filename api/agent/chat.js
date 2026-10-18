import { callerId, callerMayUseWorkspace, callerIsAdmin, db, isConfigured } from './_supabase.js'
import { loadBrandContext, IDENTITY, prefixRisk } from './_context.js'
import { runAgent } from './_loop.js'
import { contextPreamble } from '../../src/lib/agent/prompt.js'
import { rememberChat } from './_memory.js'
import { ADMIN_EDITS_PROMPT } from '../../src/lib/agent/adminTools.js'
import { COMPANY_PROMPT } from '../../src/lib/agent/companyTools.js'
import { REQUESTS_PROMPT } from '../../src/lib/agent/requestTools.js'
import { writeCeoBrief } from './_ceoBrief.js'
import {
  validateAttachments, userContent, storedAttachments, attachmentNote,
} from '../../src/lib/agent/attachments.js'

// ─── POST /api/agent/chat ──────────────────────────────────────────────────
// The assistant answering now. AGENT.md §5a.
//
// Body:
//   { workspace_id, question, thread_id?, context?, attachments? }
//
// `attachments` (2026-10-17) is up to four images or PDFs as base64, already
// downscaled by the browser. They reach the model on this turn only; see
// src/lib/agent/attachments.js for why they are not stored or replayed.
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

/**
 * The thread's history, as the model will see it.
 *
 * A user turn that carried files replays as a note naming them, never the
 * files. Read with a fallback without `attachments`, because that column
 * arrives in a hand-applied migration (20261020_agent_admin_edits.sql) and a
 * select naming a missing column fails the whole request — the chat must not
 * go down in the window between this deploy and that migration.
 */
async function loadHistory(chatId, workspaceId) {
  const base = `research_messages?chat_id=eq.${encodeURIComponent(chatId)}` +
    `&workspace_id=eq.${encodeURIComponent(workspaceId)}&order=created_at.asc&limit=40`
  let rows
  try {
    rows = await db(`${base}&select=role,content,attachments`)
  } catch {
    rows = await db(`${base}&select=role,content`)
  }
  return (rows || []).map(m => {
    const note = m.role === 'user' ? attachmentNote(m.attachments) : ''
    return { role: m.role, content: note ? `${note}\n\n${m.content}` : m.content }
  })
}

/** Store the user's message; the thumbnails too when there are any and the column exists. */
async function saveUserMessage(chatId, workspaceId, question, attachments) {
  const body = { chat_id: chatId, workspace_id: workspaceId, role: 'user', content: question }
  if (attachments.length) {
    try {
      await db('research_messages', {
        method: 'POST', body: { ...body, attachments: storedAttachments(attachments) }, prefer: 'return=minimal',
      })
      return
    } catch (err) {
      // Most likely the column is not there yet. The question still has to be
      // stored or the next turn's history skips it.
      console.error('[agent/chat] could not store attachments, storing the text only:', err?.message || err)
    }
  }
  await db('research_messages', { method: 'POST', body, prefer: 'return=minimal' })
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

// ─── The CEO's brief rides on this function ────────────────────────────────
// Vercel Hobby allows 12 functions and this project is at 12 (see
// api/_vercelFunctionBudget.test.js), so the brief is two extra doors on the
// chat endpoint rather than a thirteenth file:
//
//   POST { workspace_id, mode: 'ceo_brief' }   an admin pressing "Write a fresh brief"
//   GET  ?cron=ceo-brief  Bearer CRON_SECRET     Vercel Cron, Sunday 07:00 Riyadh
//
// The writer is api/agent/_ceoBrief.js.

const bearerOf = req => String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '')

async function ceoBriefCron(req, res) {
  const secret = process.env.CRON_SECRET || ''
  if (!secret || bearerOf(req) !== secret) {
    res.status(401).json({ ok: false })
    return
  }
  const companies = await db('workspaces?ceo_brief_enabled=eq.true&select=id,name')
  const results = []
  // One at a time: each is a paid call, and the cap check before each one is
  // only meaningful if the previous one has been billed.
  for (const w of companies || []) {
    try {
      const row = await writeCeoBrief(w.id, { trigger: 'schedule' })
      results.push({ company: w.name, ok: !row.error, error: row.error || '' })
    } catch (err) {
      results.push({ company: w.name, ok: false, error: err?.message || String(err) })
    }
  }
  res.status(200).json({ ok: true, results })
}

export default async function handler(req, res) {
  if (req.method === 'GET' && String(req.query?.cron || '') === 'ceo-brief') {
    await ceoBriefCron(req, res)
    return
  }
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
  const threadId = String(body.thread_id || '').trim()
  const context = body.context || null

  // Checked again here whatever the browser did: the browser's limits are a
  // courtesy, this is the boundary.
  const files = validateAttachments(body.attachments)
  if (!files.ok) {
    res.status(400).json({ error: files.error })
    return
  }
  const attachments = files.attachments
  // A file with no words is a real question ("what is this?"), so it is given
  // words rather than refused.
  const question = String(body.question || '').trim() ||
    (attachments.length ? 'Take a look at what I attached.' : '')

  if (!workspaceId || (!question && body.mode !== 'ceo_brief')) {
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
  // ── May they edit directly? ──
  // From the verified user id, never from the body. Only asked once
  // membership is proven, so "admin" always means "admin of a workspace they
  // are actually in". See callerIsAdmin for why this is not
  // workspace_members.role.
  const isAdmin = await callerIsAdmin(userId)

  // ── A fresh CEO brief, on request ──
  // Admins only: it is built from leads and sales, which only admins see.
  if (body.mode === 'ceo_brief') {
    if (!isAdmin) {
      res.status(403).json({ error: 'Only administrators can write the CEO brief.' })
      return
    }
    try {
      const row = await writeCeoBrief(workspaceId, { trigger: 'manual', userId })
      if (row.error) {
        res.status(row.refused ? 402 : 500).json({ error: row.error })
        return
      }
      res.status(200).json({ ok: true, brief: row })
    } catch (err) {
      console.error('[agent/ceo-brief]', err)
      res.status(500).json({ error: err?.message || 'The brief could not be written.' })
    }
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
        `&workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id,user_id`,
      )
      // Scoped by workspace as well as by id: a thread id from another
      // workspace must not attach here, and the id alone would let it.
      // And by owner (2026-10-18): conversations are private, so someone
      // else's thread id starts a new conversation rather than continuing
      // theirs. Ownerless threads from before then are admins' to continue.
      const row = rows?.[0]
      const mine = row && (row.user_id === userId || (!row.user_id && isAdmin))
      chatId = mine ? row.id : ''
    }
    if (!chatId) {
      const created = await db('research_chats', {
        method: 'POST',
        body: { workspace_id: workspaceId, user_id: userId, title: question.slice(0, 80) },
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
    const history = await loadHistory(chatId, workspaceId)

    // `brand` now carries the agent's memory digest — what it has already
    // proposed, what this team has told it, what it established. It sits in
    // the CACHED block because it changes on a slow cadence.
    //
    // `recallTail` is the volatile half: notes newer than the last compaction.
    // It goes on the user turn below, never here.
    const { brand, recallTail } = await loadBrandContext(workspaceId, 'chat')

    // The cache guard. Prompt caching fails silently — a prefix that stops
    // being byte-identical still answers correctly, at roughly ten times the
    // price on the prefix, and nothing in the response says so.
    // Two variants of the identity block, each stable: an admin's carries the
    // direct-edit rules. Stable text only — see ADMIN_EDITS_PROMPT.
    // COMPANY_PROMPT widens the chat to the whole company and to general
    // business advice; the research run keeps the plain IDENTITY.
    const base = `${IDENTITY}\n\n${COMPANY_PROMPT}\n\n${REQUESTS_PROMPT}`
    const identity = isAdmin ? `${base}\n\n${ADMIN_EDITS_PROMPT}` : base
    const risk = prefixRisk({ identity, brand })
    if (risk) console.error(`[agent] volatile fragment in cached prefix: ${risk}`)

    // The page descriptor is the volatile TAIL of the user turn — never the
    // system prompt, which is the whole point of putting it here.
    const preamble = [contextPreamble(context), recallTail].filter(Boolean).join('\n\n')
    const messages = [
      ...history,
      { role: 'user', content: userContent(preamble ? `${preamble}\n\n${question}` : question, attachments) },
    ]

    await saveUserMessage(chatId, workspaceId, question, attachments)

    const result = await runAgent({
      workspaceId, job: 'chat', surface: 'chat', chatId,
      identity, brand, messages,
      // Built here from the token, and the only way a tool learns who is
      // asking. isAdmin decides both which tools are offered and whether
      // runTool will execute a direct edit.
      session: { userId, chatId, isAdmin },
      // Writes on, because "draft me a carousel for Thursday" and "add that as
      // a rule" are the natural asks here and an assistant that can only talk
      // is a search box. For a non-admin everything still lands as a proposal
      // or a draft; an admin's session adds direct edits, each one audited
      // (see adminTools.js). The identity prompt tells it to write only when
      // asked — an assistant
      // that files a proposal every time it has an opinion is one whose review
      // queue nobody opens.
      writes: true,
      // The open web too: "what is that competitor saying on their site?" is a
      // natural chat question, and metered tools are bounded by the same loop
      // budget as everything else.
      web: true,
      // Leads, sales, email and the team (companyTools.js), 2026-10-18. The
      // leads and sales half follows isAdmin, exactly as the app's RLS does.
      company: true,
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

      // ── Learn from the conversation ──
      // Every sixth turn, not every turn: a model call per message would
      // roughly double the cost of chat to record something on maybe one turn
      // in ten. The person already has their answer streamed by now, so this
      // costs them no waiting, and it can never fail the response — a memory
      // that did not get written is a smaller problem than an answer that did
      // not arrive.
      const turnCount = (history.filter(m => m.role === 'assistant').length) + 1
      await rememberChat(workspaceId, chatId, { turnCount }).catch(() => {})
    }

    send(res, 'done', {
      thread_id: chatId,
      ok: result.ok,
      turns: result.turns,
      tools: result.toolCalls.map(t => t.name),
      cost_usd: Number(result.cost.toFixed(6)),
      stopped_by: result.stoppedBy,
      // So the drawer can say "can edit" honestly — read from the same value
      // that gated the tools, not guessed by the browser.
      can_edit: isAdmin,
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
