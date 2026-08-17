import { defaultFormat, defaultAspectRatio } from './postFormats'

// ─── Plan-level helpers, shared by more than the planner page ──────────────
// These used to live in pages/campaigns/CampaignPlanner.jsx and be imported
// out of it by ContentPlans, Approvals and lib/quickCreate. A page module that
// also exports plain functions defeats Fast Refresh (React can't tell whether
// a changed export is a component, so it falls back to a full reload), and
// importing a page from lib/ is a dependency pointing the wrong way.

const KSA_MOMENTS = [
  { name: 'Ramadan',       start: '2026-02-18', end: '2026-03-19' },
  { name: 'Founding Day',  start: '2026-02-22', end: '2026-02-22' },
  { name: 'Eid al-Fitr',   start: '2026-03-20', end: '2026-03-23' },
  { name: 'Eid al-Adha',   start: '2026-05-27', end: '2026-05-30' },
  { name: 'National Day',  start: '2026-09-23', end: '2026-09-23' },
  { name: 'Ramadan',       start: '2027-02-08', end: '2027-03-08' },
  { name: 'Eid al-Fitr',   start: '2027-03-09', end: '2027-03-12' },
  { name: 'National Day',  start: '2027-09-23', end: '2027-09-23' },
]
export function momentsInRange(startDate, endDate) {
  if (!startDate || !endDate) return []
  return KSA_MOMENTS.filter(m => m.start <= endDate && m.end >= startDate)
}


// The planner draft that opens a saved plan on its review board.
//
// The planner does not take a plan id in the URL — it reads whatever draft is
// in the app store and re-hydrates from Supabase when that draft carries a
// planId. So "open this plan" is really "write this draft, then navigate",
// and every place that wants to land someone on a plan has to build the same
// object. This is that object, in one place: the plan list opens plans from
// here, and so does the return trip out of Creative Studio.
//
// Always 'review'. Whoever is being sent to a plan wants to see its ideas —
// dropping them on the setup form would hide the very board they came for.
export function planDraftFromPlan(plan, ideas) {
  return {
    step: 'review',
    month: plan.month || '', goal: plan.goal || '', goalCategory: plan.goal_category || '',
    platforms: plan.platforms || ['instagram'],
    startDate: plan.start_date || '', endDate: plan.end_date || '',
    approxCount: '', includeHolidays: true,
    contentMixTarget: plan.content_mix_target || '',
    name: plan.name || '', ideas: (ideas || []).map(dbIdeaToDraft), planId: plan.id,
  }
}

// Map a persisted plan_ideas row into the shape the UI/draft uses.
export function dbIdeaToDraft(row) {
  return {
    id: row.id,
    _rowId: row.id,
    // Carried so a decision logged against this idea can be attributed to
    // the plan it belonged to — the review board mutates ideas in place, and
    // idea_events is the only record of what changed.
    planId: row.plan_id || null,
    platform: row.platform || 'instagram',
    // Where this idea is meant to go. `platform` above stays the authoritative
    // single value every workflow reads; this is the full target set, and it
    // falls back to [platform] so a row written before the column existed
    // never renders an empty chip row.
    platforms: row.platforms?.length ? row.platforms : [row.platform || 'instagram'],
    date: row.scheduled_date || '',
    time: row.publish_time || '',
    title: row.title || '',
    topic: row.topic || '',
    angle: row.angle || '',
    tone: row.tone || '',
    occasion: row.occasion || '',
    pillar: row.content_pillar || '',
    rationale: row.rationale || '',
    objective: row.objective || '',
    cta: row.cta || '',
    hashtags: row.hashtags || '',
    firstComment: row.first_comment || '',
    series: row.series || '',
    rejectReason: row.reject_reason || '',
    format: row.suggested_format || 'post',
    suggestedStyle: row.suggested_style || '',
    suggestedAspectRatio: row.suggested_aspect_ratio || '',
    imageIdea: row.image_idea || '',
    postKind: row.post_kind || (row.suggested_format === 'carousel' ? 'carousel' : 'caption_image'),
    slideCount: row.slide_count || 1,
    imageText: row.image_text || '',
    imageMode: row.image_mode || 'studio',
    // Whether the picture is done, which is a different question from whether
    // the idea is approved. See 20260813_plan_media_stage.sql.
    mediaStatus: row.media_status || 'none',
    mediaVersionId: row.media_version_id || null,
    references: row.reference_image_urls || [],
    // Format & orientation system — the fields generation actually reads.
    // Fall back to the catalog default when a row predates this migration
    // (empty format/aspect_ratio) so old ideas don't render blank controls.
    postFormat: row.format || defaultFormat(row.platform || 'instagram'),
    aspectRatio: row.aspect_ratio || defaultAspectRatio(row.platform || 'instagram', row.format || defaultFormat(row.platform || 'instagram')),
    mediaType: row.media_type || 'image',
    groupId: row.group_id || '',
    wantsCaption: row.wants_caption !== false,
    // Draft copy — options proposed at plan time, and whichever one (or
    // hand-edit) the reviewer picked. See IdeaDraftPanel.
    captionOptions: row.caption_options || [],
    mediaPromptOptions: row.media_prompt_options || [],
    captionAr: row.caption_ar || '',
    captionEn: row.caption_en || '',
    // Whose words go out — 'ai' (brief the writer) or 'own' (these are final).
    // Defaulted rather than read raw so a row written before the column
    // existed reads as 'ai', which is what it actually was.
    copyMode: row.copy_mode === 'own' ? 'own' : 'ai',
    mediaPrompt: row.media_prompt || '',
    motionPrompt: row.motion_prompt || '',
    draftStatus: row.draft_status || 'not_started',
    draftError: row.draft_error || '',
    draftedAt: row.drafted_at || '',
    previewImageUrl: row.preview_image_url || '',
    previewVideoUrl: row.preview_video_url || '',
    status: row.status || 'proposed',
    position: row.position ?? 0,
  }
}
