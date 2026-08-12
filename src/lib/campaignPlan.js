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


// Map a persisted plan_ideas row into the shape the UI/draft uses.
export function dbIdeaToDraft(row) {
  return {
    id: row.id,
    _rowId: row.id,
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
    mediaPrompt: row.media_prompt || '',
    motionPrompt: row.motion_prompt || '',
    draftStatus: row.draft_status || 'not_started',
    draftError: row.draft_error || '',
    draftedAt: row.drafted_at || '',
    previewImageUrl: row.preview_image_url || '',
    status: row.status || 'proposed',
    position: row.position ?? 0,
  }
}
