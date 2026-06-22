import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient'

// ─── Campaign Planner ───────────────────────────────────────────────────────
// Turns a single stated goal into a set of dated, platform-specific post
// ideas, then drops each one into the SAME schedule tables (instagram_schedule
// / linkedin_schedule) that manual scheduling already writes to. Nothing
// downstream needs to change — whatever already turns a "pending" schedule
// row into a finished post keeps working exactly as before. This module only
// decides WHAT to post and WHEN; it never talks to the generation webhooks
// directly.

const INSTAGRAM_TONE_FALLBACK = 'professional'
const LINKEDIN_TONE_FALLBACK  = 'thought_leader'

// Ask n8n to decompose a goal into a list of post ideas. The webhook is
// expected to return JSON shaped like:
//   { campaignName?: string, posts: [{ platform, date, topic, tone, angle,
//     suggested_style, suggested_aspect_ratio, design_tip }] }
// See the accompanying n8n spec doc for the full contract.
export async function requestCampaignPlan(webhookUrl, payload) {
  if (!webhookUrl) return { error: 'No Campaign Planner webhook configured. Go to Settings → Integrations → Workflow Webhooks.' }
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) { const err = await res.text(); return { error: err || `Webhook returned ${res.status}` } }
    const data = await res.json()
    const raw  = Array.isArray(data) ? data[0] : data
    const posts = Array.isArray(raw?.posts) ? raw.posts : []
    if (posts.length === 0) return { error: 'The workflow returned no posts. Check the n8n response shape against the spec.' }
    const normalized = posts.map((p, i) => ({
      _rowId:   `plan_${i}_${Date.now()}`,
      platform: p.platform === 'linkedin' ? 'linkedin' : 'instagram',
      date:     p.date    || '',
      topic:    p.topic   || '',
      angle:    p.angle   || '',
      tone:     p.tone    || (p.platform === 'linkedin' ? LINKEDIN_TONE_FALLBACK : INSTAGRAM_TONE_FALLBACK),
      // Design suggestion from the planning workflow itself — it had the
      // full topic/angle/brand context when it made this call, so it's
      // preferred over the local heuristic fallback used for manually
      // added posts (which never go through n8n).
      suggestedStyle:       p.suggested_style       || '',
      suggestedAspectRatio: p.suggested_aspect_ratio || '',
      designTip:            p.design_tip            || '',
    }))
    return { ok: true, posts: normalized, suggestedName: raw?.campaignName || '' }
  } catch (err) {
    return { error: err.message }
  }
}

// Write the (human-reviewed) plan into Supabase, one row per post, tagged
// with the campaign id. Returns per-row results so a partial failure doesn't
// silently lose posts — the caller can show exactly which ones need retrying.
export async function writeCampaignPosts(workspaceId, accessToken, campaignId, posts, instructions) {
  if (!workspaceId) return { error: 'No active workspace. Try signing out and back in.' }
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
  }
  const results = []

  for (const post of posts) {
    if (post.platform === 'linkedin') {
      const body = {
        workspace_id:   workspaceId,
        scheduled_date: post.date,
        topic:          post.angle ? `${post.topic} — ${post.angle}` : post.topic,
        tone:           post.tone || LINKEDIN_TONE_FALLBACK,
        post_type:      'thought_leadership',
        content_route:  'instructions',
        include_image:  true,
        style:          post.suggestedStyle       || 'photorealistic',
        aspect_ratio:   post.suggestedAspectRatio || '1.91:1',
        notes:          post.designTip ? `Generated from Campaign Automation. Design tip: ${post.designTip}` : 'Generated from Campaign Automation',
        instructions:   instructions || '',
        campaign_id:    campaignId,
        upload_type:    'generate',
        status:         'pending',
      }
      const res = await fetch(`${SUPABASE_URL}/rest/v1/linkedin_schedule`, {
        method: 'POST', headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(body),
      })
      results.push({ post, ok: res.ok, error: res.ok ? null : await res.text() })
    } else {
      const body = {
        workspace_id:   workspaceId,
        scheduled_date: post.date,
        topic:          post.angle ? `${post.topic} — ${post.angle}` : post.topic,
        tone:           post.tone || INSTAGRAM_TONE_FALLBACK,
        visual_mode:    'lighting',
        style:          post.suggestedStyle       || 'photorealistic',
        aspect_ratio:   post.suggestedAspectRatio || '1:1',
        notes:          post.designTip ? `Generated from Campaign Automation. Design tip: ${post.designTip}` : 'Generated from Campaign Automation',
        instructions:   instructions || null,
        campaign_id:    campaignId,
        upload_type:    'generate',
        status:         'pending',
      }
      const res = await fetch(`${SUPABASE_URL}/rest/v1/instagram_schedule`, {
        method: 'POST', headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify(body),
      })
      results.push({ post, ok: res.ok, error: res.ok ? null : await res.text() })
    }
  }

  const failed = results.filter(r => !r.ok)
  return { ok: failed.length === 0, results, failedCount: failed.length }
}
