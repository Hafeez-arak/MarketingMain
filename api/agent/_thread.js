import { db } from './_supabase.js'
import { callModel } from './_provider.js'
import { textIn } from '../../src/lib/agent/loop.js'
import { attachmentNote } from '../../src/lib/agent/attachments.js'
import { ROUTE_PROMPT, ROUTE_SCHEMA, routeInput, parseTier } from '../../src/lib/agent/chatRoute.js'
import { planFold, FOLD_PROMPT, foldInput, cleanSummary } from '../../src/lib/agent/threadSummary.js'

// ─── The chat thread: its history, its summary, and how it is sorted ───────
// The I/O half of src/lib/agent/threadSummary.js and chatRoute.js. Those
// files decide; this one reads, calls and writes.
//
// research_chats.summary / summary_through arrive in a hand-applied migration
// (supabase/migrations/20261109_chat_thread_summary.sql). Until it is applied
// every read here falls back to the plain thread, and a fold quietly does
// nothing — the chat must not go down in the window between this deploy and
// that migration.

const enc = encodeURIComponent

/** The thread's summary, or an empty one when there is none or the columns are not there yet. */
async function readSummary(chatId, workspaceId) {
  try {
    const rows = await db(
      `research_chats?id=eq.${enc(chatId)}&workspace_id=eq.${enc(workspaceId)}&select=summary,summary_through`,
    )
    return { summary: rows?.[0]?.summary || '', through: rows?.[0]?.summary_through || null, available: true }
  } catch {
    return { summary: '', through: null, available: false }
  }
}

/**
 * The thread as stored: its summary, and every message after it, oldest
 * first.
 *
 * Read newest-first and reversed. The old read took the OLDEST forty
 * messages, so a thread past forty would have answered from its beginning
 * and never seen the latest turns.
 *
 * A user turn that carried files replays as a note naming them, never the
 * files (see attachments.js). The attachments column is itself
 * hand-migrated, hence the second select.
 */
export async function loadThread(chatId, workspaceId) {
  const { summary, through, available } = await readSummary(chatId, workspaceId)
  const base = `research_messages?chat_id=eq.${enc(chatId)}&workspace_id=eq.${enc(workspaceId)}` +
    (through ? `&created_at=gt.${enc(through)}` : '') +
    '&order=created_at.desc&limit=60'
  let rows
  try {
    rows = await db(`${base}&select=role,content,attachments,created_at`)
  } catch {
    rows = await db(`${base}&select=role,content,created_at`)
  }
  const messages = [...(rows || [])].reverse().map(m => {
    const note = m.role === 'user' ? attachmentNote(m.attachments) : ''
    return { role: m.role, content: note ? `${note}\n\n${m.content}` : m.content, created_at: m.created_at }
  })
  return { summary, through, available, messages }
}

/**
 * How many answers the thread holds in all, summarised ones included. The
 * memory extraction runs on every sixth, and counting only the messages after
 * the summary would shift that cadence every time the thread is folded.
 */
export async function answerCount(chatId, workspaceId) {
  try {
    const rows = await db(
      `research_messages?chat_id=eq.${enc(chatId)}&workspace_id=eq.${enc(workspaceId)}` +
      '&role=eq.assistant&select=id&limit=1000',
    )
    return (rows || []).length
  } catch {
    return 0
  }
}

/**
 * The model that wrote this thread's last answer, and when — from the ledger,
 * because research_messages does not record it. Only the answering calls:
 * `stage` is empty on those, and set on the memory extraction that also runs
 * under the chat surface.
 */
export async function lastAnswerModel(chatId, workspaceId) {
  if (!chatId) return null
  try {
    const rows = await db(
      `agent_usage?chat_id=eq.${enc(chatId)}&workspace_id=eq.${enc(workspaceId)}` +
      '&surface=eq.chat&stage=eq.&order=created_at.desc&limit=1&select=model,created_at',
    )
    return rows?.[0] || null
  } catch {
    return null
  }
}

/**
 * The sorting call: easy or hard. Throws on any failure, which chooseTier
 * turns into "hard".
 */
export async function classifyQuestion(workspaceId, chatId, { question, lastAnswer }) {
  const out = await callModel({
    workspaceId, chatId, job: 'chat_route', surface: 'chat_route',
    identity: ROUTE_PROMPT, brand: '',
    messages: [{ role: 'user', content: routeInput({ question, lastAnswer }) }],
    // Room for a little thinking before a one-word answer; thinking counts
    // against max_tokens and an answer cut off reads as "hard" anyway.
    maxTokens: 1_024, effort: 'low', outputFormat: ROUTE_SCHEMA,
  })
  if (!out.ok) throw new Error(out.error || 'route call failed')
  return parseTier(textIn(out.response))
}

/**
 * Fold the thread's older turns into its summary, when it has grown long
 * enough. Runs after the answer has been sent. Never throws: a summary that
 * did not get written leaves the next question with a longer history, which
 * is a cost, not a failure.
 */
export async function foldThread(workspaceId, chatId) {
  try {
    const { summary, through, available, messages } = await loadThread(chatId, workspaceId)
    if (!available) return { folded: false, reason: 'no_columns' }
    const plan = planFold(messages)
    if (!plan) return { folded: false, reason: 'short' }

    const out = await callModel({
      workspaceId, chatId, job: 'chat_compact', surface: 'chat_compact',
      identity: FOLD_PROMPT, brand: '',
      messages: [{ role: 'user', content: foldInput({ summary, fold: plan.fold }) }],
      maxTokens: 4_000, effort: 'low',
    })
    const next = out.ok ? cleanSummary(textIn(out.response)) : ''
    if (!next) return { folded: false, reason: out.error || 'empty' }

    // Only if nobody folded it in the meantime: the filter on the old
    // summary_through makes a second, concurrent fold a no-op instead of
    // letting an older summary overwrite a newer one.
    const guard = through ? `&summary_through=eq.${enc(through)}` : '&summary_through=is.null'
    await db(`research_chats?id=eq.${enc(chatId)}&workspace_id=eq.${enc(workspaceId)}${guard}`, {
      method: 'PATCH',
      body: { summary: next, summary_through: plan.through },
      prefer: 'return=minimal',
    })
    return { folded: true, messages: plan.fold.length, cost: out.cost || 0 }
  } catch (err) {
    console.error('[agent/thread] fold failed:', err?.message || err)
    return { folded: false, reason: 'error' }
  }
}
