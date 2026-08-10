import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient'
import { saveToMediaLibrary } from './mediaLibrary'

// ─── Creative Studio ───────────────────────────────────────────────────────
// The asset-first surface: a prompt becomes two candidate images (one per
// provider), one gets picked, and it's edited — by talking to the AI or by
// placing real text on it — until it's right, then optionally animated.
//
// Distinct from contentPlans.js on purpose. A plan idea is a planned POST
// (topic, date, caption, hashtags) whose media is a by-product; a creative
// session is the reverse — the asset IS the deliverable, and there may be no
// post, no date and no caption at all.
//
// Every generating call is fire-and-forget: the browser inserts the pending
// row(s) first, fires the webhook, and polls the rows. n8n owns writing the
// result (or the failure) back. That means a closed tab or a refresh never
// loses work — the row is already there and still filling in.

function authHeaders(accessToken) {
  return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}` }
}
function jsonHeaders(accessToken, prefer = 'return=representation') {
  return { ...authHeaders(accessToken), 'Content-Type': 'application/json', Prefer: prefer }
}

// ── Sessions ───────────────────────────────────────────────────────────────

export async function fetchSessions(workspaceId, accessToken, limit = 40) {
  if (!workspaceId) return []
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/creative_sessions?workspace_id=eq.${workspaceId}&select=*&order=updated_at.desc&limit=${limit}`,
      { headers: authHeaders(accessToken) },
    )
    return res.ok ? await res.json() : []
  } catch { return [] }
}

export async function createSession(workspaceId, accessToken, { title, intent, aspectRatio }) {
  if (!workspaceId) return { error: 'No active workspace. Try signing out and back in.' }
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/creative_sessions`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({
        workspace_id: workspaceId,
        // The first prompt names the session — nobody wants to title a thing
        // before they've made it.
        title: (title || 'Untitled').slice(0, 80),
        intent: intent || 'image',
        aspect_ratio: aspectRatio || '1:1',
      }),
    })
    if (!res.ok) return { error: await res.text() }
    const rows = await res.json()
    return { ok: true, session: rows[0] }
  } catch (err) { return { error: err.message } }
}

export async function touchSession(accessToken, sessionId) {
  // Keeps the session list ordered by real activity rather than creation.
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/creative_sessions?id=eq.${sessionId}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken, 'return=minimal'),
      body: JSON.stringify({ updated_at: new Date().toISOString() }),
    })
  } catch { /* ordering is cosmetic — never fail a real action over it */ }
}

// ── Versions ───────────────────────────────────────────────────────────────

export async function fetchVersions(accessToken, sessionId) {
  if (!sessionId) return []
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/creative_versions?session_id=eq.${sessionId}&select=*&order=round.asc,created_at.asc`,
      { headers: authHeaders(accessToken) },
    )
    return res.ok ? await res.json() : []
  } catch { return [] }
}

// Insert the row(s) a generating step will fill in. Done BEFORE the webhook
// fires so there is always somewhere for the result to land and something for
// the UI to show as pending — n8n is handed the ids rather than creating rows
// itself, which also means a webhook that never arrives leaves a visible
// stuck row instead of silence.
export async function insertPendingVersions(workspaceId, accessToken, sessionId, rows) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/creative_versions`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify(rows.map(r => ({
        session_id: sessionId,
        workspace_id: workspaceId,
        round: r.round ?? 0,
        parent_version_id: r.parentVersionId || null,
        kind: r.kind,
        provider: r.provider || '',
        user_prompt: r.userPrompt || '',
        reference_url: r.referenceUrl || '',
        reference_notes: r.referenceNotes || '',
        media_type: r.mediaType || 'image',
        aspect_ratio: r.aspectRatio || '',
        // user_prompt is what actually produced the asset; these two record
        // where it came from, so a card can show "enhanced from: warm lobby
        // shot" rather than losing the human's own words entirely.
        original_prompt: r.originalPrompt || '',
        prompt_source: r.promptSource || 'raw',
        image_url: r.imageUrl || '',
        video_url: r.videoUrl || '',
        // Recorded so a video render can be replayed verbatim later — the
        // 🔄 re-render action needs the exact settings that made it, not just
        // the prompt, and nothing else on this row captured them before.
        duration: r.duration || '',
        resolution: r.resolution || '',
        generate_audio: !!r.generateAudio,
        overlay_state: r.overlayState || null,
        status: r.status || 'pending',
      }))),
    })
    if (!res.ok) return { error: await res.text() }
    return { ok: true, rows: await res.json() }
  } catch (err) { return { error: err.message } }
}

export async function updateVersion(accessToken, versionId, patch) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/creative_versions?id=eq.${versionId}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken, 'return=minimal'),
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    })
    if (!res.ok) return { error: await res.text() }
    return { ok: true }
  } catch (err) { return { error: err.message } }
}

// Exactly one version in a session is the current pick. Cleared across the
// whole session first so the flag can never be true on two rows at once —
// the toolbar and every downstream step read it to decide what they act on.
export async function selectVersion(accessToken, sessionId, versionId) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/creative_versions?session_id=eq.${sessionId}&is_selected=eq.true`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken, 'return=minimal'),
      body: JSON.stringify({ is_selected: false }),
    })
    return await updateVersion(accessToken, versionId, { is_selected: true })
  } catch (err) { return { error: err.message } }
}

// ── Branches ───────────────────────────────────────────────────────────────

// A session is not one conversation, it's two: the ChatGPT candidate and the
// Gemini candidate each get edited, texted and animated on their own, and the
// team compares the two lineages rather than committing to one at round 0.
//
// Nothing in the schema records "which branch" — parent_version_id already
// says it. Walking up to the version that has no parent inside this session
// gives the round-0 candidate the whole lineage descends from, and that root's
// id IS the branch id. Derived rather than stored so it can never disagree
// with the tree, and so no migration is needed to add the idea.
export function buildBranches(versions) {
  const byId = new Map(versions.map(v => [v.id, v]))
  const rootOf = new Map()

  // Iterative, memoised, and depth-capped: a self-referencing parent would
  // otherwise hang the render thread rather than showing a broken card.
  function resolveRoot(start) {
    const chain = []
    let cur = start
    let guard = 0
    while (cur && !rootOf.has(cur.id) && guard++ < 500) {
      chain.push(cur)
      const parent = cur.parent_version_id ? byId.get(cur.parent_version_id) : null
      if (!parent) { rootOf.set(cur.id, cur.id); break }
      cur = parent
    }
    const root = (cur && rootOf.get(cur.id)) || (cur ? cur.id : start.id)
    for (const node of chain) if (!rootOf.has(node.id)) rootOf.set(node.id, root)
    return rootOf.get(start.id) || root
  }

  // Insertion order carries the branch order for free: `versions` arrives
  // sorted by round then created_at, and a child always has a higher round
  // than its parent, so roots are met in the order they were generated
  // (openai, then gemini — the order the labels read left to right).
  const groups = new Map()
  for (const v of versions) {
    const root = resolveRoot(v)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(v)
  }

  return [...groups.entries()].map(([rootId, list]) => {
    const ready = list.filter(v => v.status === 'ready')
    return {
      rootId,
      root: byId.get(rootId) || list[0],
      provider: (byId.get(rootId) || list[0])?.provider || '',
      versions: list,
      // What a new instruction acts on by default: the most recent thing that
      // actually exists. A still is preferred over a render — you edit the
      // image and re-animate, you don't edit the clip (no model can).
      latest: [...ready].reverse().find(v => v.media_type !== 'video') || ready[ready.length - 1] || null,
      pending: list.some(v => v.status === 'pending'),
    }
  })
}

// ── Storage ────────────────────────────────────────────────────────────────

// Used for reference uploads and for the overlay editor's exports. Mirrors
// uploadReferenceImage's shape but targets the studio's own bucket.
export async function uploadToStudio(workspaceId, accessToken, blob, name) {
  if (!workspaceId) return { error: 'No active workspace. Try signing out and back in.' }
  try {
    const safe = String(name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `${workspaceId}/${Date.now()}_${safe}`
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/creative-studio/${path}`, {
      method: 'POST',
      headers: { ...authHeaders(accessToken), 'Content-Type': blob.type || 'application/octet-stream' },
      body: blob,
    })
    if (!res.ok) return { error: await res.text() }
    return { ok: true, url: `${SUPABASE_URL}/storage/v1/object/public/creative-studio/${path}` }
  } catch (err) { return { error: err.message } }
}

// ── Webhook calls (all fire-and-forget; the caller polls the rows) ─────────

async function fire(webhookUrl, payload, label) {
  if (!webhookUrl) return { error: `${label} webhook not configured. Go to Settings → Integrations.` }
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return res.ok ? { ok: true } : { error: `Webhook returned ${res.status}` }
  } catch (err) { return { error: err.message } }
}

export const requestGenerate = (url, payload) => fire(url, payload, 'Creative Generate')
export const requestEdit     = (url, payload) => fire(url, payload, 'Creative Edit')
export const requestVideo    = (url, payload) => fire(url, payload, 'Creative Video')

// ── Enhance ────────────────────────────────────────────────────────────────

// The one call in this file that waits for its answer. Everything above is
// fire-and-forget because it produces an asset worth minutes and money, and a
// closed tab must not lose it. This produces a string in about two seconds and
// puts it straight in the text box — there is nothing to persist, and nothing
// worth recovering if the tab goes away mid-flight.
//
// It never triggers a generation. The enhanced text lands in the composer and
// the human decides what to do with it.
export async function requestEnhance(webhookUrl, payload) {
  if (!webhookUrl) return { error: 'Enhance webhook not configured. Go to Settings → Integrations.' }
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) return { error: `Webhook returned ${res.status}` }
    // n8n's lastNode response mode returns the Code node's items, so a single
    // result arrives as a one-element array rather than a bare object.
    const data = await res.json()
    const row = Array.isArray(data) ? data[0] : data
    if (!row || row.ok !== true || !row.prompt) {
      return { error: (row && row.error) || 'The enhancer returned nothing usable.' }
    }
    return { ok: true, prompt: row.prompt }
  } catch (err) { return { error: err.message } }
}

// ── Download ───────────────────────────────────────────────────────────────

// The old "⬇ Download" was a plain <a target="_blank"> with no `download`
// attribute, so it opened the image in a tab and left you to right-click it.
// This fetches the bytes and saves them properly.
//
// "Highest quality" is the stored file itself, untouched: what's in the bucket
// is the model's own PNG at full resolution, so there is nothing higher to
// fetch and re-encoding it could only lose data. (An actual upscale beyond the
// native size is a separate, paid step — deliberately not built yet.)
function filenameFor(version, sessionTitle) {
  const slug = String(sessionTitle || 'arak-studio')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'arak-studio'
  const ext = version.video_url ? 'mp4' : 'png'
  const who = version.provider && version.provider !== 'manual' ? `-${version.provider}` : ''
  return `${slug}${who}-v${version.round ?? 0}.${ext}`
}

export async function downloadVersion(workspaceId, accessToken, version, sessionTitle) {
  const url = version.video_url || version.image_url
  if (!url) return { error: 'Nothing to download yet.' }

  try {
    const res = await fetch(url)
    if (!res.ok) return { error: `Couldn't fetch the file (${res.status}).` }
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = filenameFor(version, sessionTitle)
    document.body.appendChild(a)
    a.click()
    a.remove()
    // Revoked on a tick rather than immediately: Safari cancels an in-flight
    // download if the object URL dies in the same frame as the click.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000)
  } catch (err) {
    return { error: err.message }
  }

  // Downloading something means you want to keep it, so it should be in the
  // library whether or not you remembered to press Save. is_final is the
  // record of "already filed" — checking it is what stops a second download
  // from creating a duplicate row.
  if (!version.is_final) {
    const saved = await finalizeVersion(workspaceId, accessToken, version, sessionTitle)
    if (saved.error) return { ok: true, savedError: saved.error }
    return { ok: true, alsoSaved: true }
  }
  return { ok: true }
}

// ── Finalize ───────────────────────────────────────────────────────────────

// Marks the version as the session's finished asset and copies it into the
// Media Library, tagged so it can be found later and traced back to the
// session and model that produced it.
export async function finalizeVersion(workspaceId, accessToken, version, sessionTitle) {
  const url = version.video_url || version.image_url
  if (!url) return { error: 'This version has nothing to finalize yet.' }
  const patch = await updateVersion(accessToken, version.id, { is_final: true })
  if (patch.error) return patch
  await saveToMediaLibrary(workspaceId, accessToken, {
    name: sessionTitle || 'Studio asset',
    url,
    topic: version.user_prompt || '',
    mimeType: version.video_url ? 'video/mp4' : 'image/png',
    tags: [
      'studio',
      `session:${version.session_id}`,
      version.provider && `via:${version.provider}`,
      version.video_url ? 'video' : 'image',
    ].filter(Boolean),
  })
  return { ok: true }
}
