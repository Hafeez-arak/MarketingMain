import { createPlan, insertIdeas, markIdeasDrafting, markIdeasProcessing } from './contentPlans'
import { requestDraftCopy, requestPlanContentGeneration } from './campaignPlanner'
import { dbIdeaToDraft } from '../pages/campaigns/CampaignPlanner'
import { derivePostKind, slideRange } from './postFormats'

// ─── Quick Create ────────────────────────────────────────────────────────
// One post, generated right now, without building a month plan — but
// through the SAME engine the monthly planner uses (Draft Copy for
// caption + media-prompt options, Media Options for real candidate
// images, the same commit-only Finalize). A quick post is really just a
// content_plans row with exactly one idea in it, tagged kind='quick' so
// it's excluded from cross-month repetition history and Approvals'
// plan-grouped view — see 20260808_plan_kind.sql.
//
// Each quick create gets its OWN fresh plan (never a shared long-lived
// one) — simpler, and it means markIdeasProcessing (scoped by plan_id +
// status=approved) never needs special-casing for "don't reprocess past
// quick posts," since a quick plan only ever holds the one idea.

// Step 1: create the plan + the single idea, fire Draft Copy for it.
// Returns the idea in the same draft shape CampaignPlanner/IdeaDraftPanel
// already use, so IdeaDraftPanel can be reused as-is for the review step.
export async function createQuickPost({
  workspaceId, accessToken, platform, topic, tone, postFormat, aspectRatio, mediaType,
  wantsCaption = true, imageIdea = '', webhooks, instructions, captionLanguage,
}) {
  if (!workspaceId) return { error: 'No active workspace. Try signing out and back in.' }
  if (!topic?.trim()) return { error: 'Add a topic for the post.' }

  const planRes = await createPlan(workspaceId, accessToken, {
    name: `Quick ${platform} post`, platforms: [platform], status: 'draft', kind: 'quick',
  })
  if (planRes.error) return { error: planRes.error }

  const slides = slideRange(platform, postFormat)
  const postKind = derivePostKind({ platform, format: postFormat, wantsCaption })
  const ideaRes = await insertIdeas(workspaceId, accessToken, planRes.plan.id, [{
    platform, topic: topic.trim(), tone, postFormat, aspectRatio, mediaType, wantsCaption,
    imageIdea, slideCount: slides?.default || 1, postKind,
  }], 0)
  if (ideaRes.error || !ideaRes.rows?.[0]) return { error: ideaRes.error || 'Could not create the post idea.' }

  let idea = dbIdeaToDraft(ideaRes.rows[0])

  const draftCopyUrl = webhooks?.draftCopy
  if (draftCopyUrl) {
    await markIdeasDrafting(accessToken, [idea.id])
    idea = { ...idea, draftStatus: 'drafting', draftedAt: new Date().toISOString() }
    // Fire-and-forget, same as the plan board — the caller polls for the
    // result rather than waiting on this request.
    requestDraftCopy(draftCopyUrl, {
      plan_idea_id: idea.id, platform, topic: idea.topic, angle: '', tone,
      format: postFormat, aspect_ratio: aspectRatio, media_type: mediaType,
      wants_caption: wantsCaption, image_idea: imageIdea,
      caption_language: captionLanguage, instructions,
    })
  }

  return { ok: true, plan: planRes.plan, idea }
}

// Step 2: once the reviewer has a caption + image (or hand-edited their
// own), commit it — the exact same Finalize path a monthly plan uses,
// just for one idea instead of a batch of approved ones.
export async function finalizeQuickPost({ webhooks, planId, idea, instructions, workspaceId, captionLanguage, accessToken }) {
  await markIdeasProcessing(accessToken, planId)
  return requestPlanContentGeneration({
    webhooks, planId, instructions, ideas: [idea], workspaceId, captionLanguage,
  })
}
