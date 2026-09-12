// ─── Reading past conversations back ───────────────────────────────────────
// The agent's threads are already persisted server-side (research_chats /
// research_messages) so that a reload does not lose the conversation. This
// module is the other half of that: reading them back so a person can return
// to one they had two days ago.
//
// Read straight from PostgREST with the signed-in user's token, the same shape
// agentRun.js uses. Note the explicit workspace_id filter on BOTH queries:
// RLS here scopes by membership, not by workspace, and the operators belong to
// every workspace — without the filter one brand's threads would list under
// another's name.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient'

function headers(accessToken) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}`,
  }
}

/** Past conversations for a workspace, most recently used first. */
export async function fetchThreads(workspaceId, accessToken, limit = 30) {
  if (!workspaceId) return []
  const url = `${SUPABASE_URL}/rest/v1/research_chats?workspace_id=eq.${workspaceId}` +
    `&order=updated_at.desc&limit=${limit}` +
    `&select=id,title,created_at,updated_at`
  try {
    const res = await fetch(url, { headers: headers(accessToken) })
    if (!res.ok) return []
    return await res.json()
  } catch {
    return []
  }
}

/**
 * One thread's messages, oldest first, in the shape the chat surfaces render.
 *
 * Capped at the same 40 the server feeds back into the model, so reopening a
 * long thread shows exactly the history the next answer will be built on
 * rather than more than the agent itself can see.
 */
export async function fetchThreadTurns(chatId, workspaceId, accessToken) {
  if (!chatId || !workspaceId) return []
  const url = `${SUPABASE_URL}/rest/v1/research_messages?chat_id=eq.${chatId}` +
    `&workspace_id=eq.${workspaceId}&order=created_at.asc&limit=40` +
    `&select=role,content,tool_calls`
  try {
    const res = await fetch(url, { headers: headers(accessToken) })
    if (!res.ok) return []
    const rows = await res.json()
    return rows.map(m => ({
      role: m.role,
      text: m.content || '',
      // Kept so a reopened answer still shows what it was built from. No cost
      // is replayed: this conversation is being read, not paid for again, and
      // a price tag on a turn you did not just buy reads as a fresh charge.
      steps: m.role === 'assistant'
        ? (Array.isArray(m.tool_calls) ? m.tool_calls : []).map(t => ({ name: t.name, ok: t.ok }))
        : undefined,
    }))
  } catch {
    return []
  }
}

/**
 * Give a thread a name of your own.
 *
 * `updated_at` is deliberately NOT touched. It orders this list by when the
 * conversation last MOVED, and renaming is not a thing the conversation did —
 * bumping it would shuffle a thread to the top for a change of label.
 */
export async function renameThread(chatId, workspaceId, accessToken, title) {
  if (!chatId || !workspaceId) return false
  const url = `${SUPABASE_URL}/rest/v1/research_chats?id=eq.${chatId}` +
    `&workspace_id=eq.${workspaceId}`
  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { ...headers(accessToken), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ title: String(title || '').slice(0, 200) }),
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Delete a thread, and with it every message in it — research_messages
 * cascades from this row. There is no undo, which is why the caller asks
 * first.
 *
 * The workspace_id filter is not belt-and-braces here the way it is on a read.
 * RLS scopes by membership and the operators belong to every workspace, so an
 * id alone would happily delete another brand's conversation.
 */
export async function deleteThread(chatId, workspaceId, accessToken) {
  if (!chatId || !workspaceId) return false
  const url = `${SUPABASE_URL}/rest/v1/research_chats?id=eq.${chatId}` +
    `&workspace_id=eq.${workspaceId}`
  try {
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { ...headers(accessToken), Prefer: 'return=minimal' },
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * "2d", "3h", "5m" — how long ago, in one or two characters.
 *
 * Deliberately coarse. The exact timestamp is not what anyone is scanning a
 * list of old conversations for; "which one was Tuesday's" is.
 */
export function relativeAge(iso) {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  const secs = Math.max(0, (Date.now() - then) / 1000)
  if (secs < 60) return 'now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo`
  return `${Math.floor(days / 365)}y`
}
