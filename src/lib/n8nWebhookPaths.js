// ─── Webhook slot → n8n path ───────────────────────────────────────────────
// Deliberately free of any import: this module is loaded both by the browser
// bundle (src/lib/n8nWebhooks.js) and by the Vercel serverless proxy
// (api/n8n/[slot].js), which runs in Node with no `import.meta.env`. Touching
// Vite's env here would break the server side.
//
// Paths must match `parameters.path` on the Webhook node of the matching file
// in n8n/workflows/. They are the schema — the host in front of them is
// runtime config held in Supabase (app_config.n8n_base_url), never in code.
//
// The schedule slots are deliberately absent: no workflow in
// n8n/workflows/ answers arak-instagram-schedule[-regen], so there
// is nothing to point them at. Giving them a derived URL anyway would turn
// today's honest "not configured yet" into a 404 at call time.
//
// The three Instagram generation slots (arak-instagram, arak-instagram-reels,
// arak-ig-plan-generation) are gone for the same reason: their workflows were
// retired when Creative Studio became the only generation path. Do not add
// them back without a workflow to answer them.
export const WEBHOOK_PATHS = {
  campaignPlanner:  'arak-campaign-planner',
  elongateIdea:     'arak-elongate-idea',
  captionStudio:    'arak-caption-studio',
  draftCopy:        'arak-draft-copy',
  mediaOptions:     'arak-media-options',
  videoRender:      'arak-video-render',
  creativeGenerate: 'arak-creative-generate',
  creativeEdit:     'arak-creative-edit',
  creativeVideo:    'arak-creative-video',
  creativeVideoEdit:'arak-creative-video-edit',
  creativeCompose:  'arak-creative-compose',
  creativeEnhance:  'arak-creative-enhance',
  creativeStitch:   'arak-creative-stitch',
  creativeCancel:   'arak-creative-cancel',
  falBalance:       'arak-fal-balance',
  // Meta Graph API — the live publishing + analytics path.
  metaPublish:      'arak-meta-publish',
  metaSync:         'arak-meta-sync',
  metaDashboard:    'arak-meta-dashboard',
  // Zernio. `zernioConnect` is live and has no Meta counterpart: it is what
  // gives each workspace its own OAuth'd accounts, and Instagram is only one
  // of the platforms behind it. The other three were dormant while Instagram
  // publishing ran on Meta's Graph API, and are being brought back as Zernio
  // becomes the primary publisher across Instagram and TikTok — meta.js stays
  // wired as the fallback rather than being deleted.
  zernioConnect:    'arak-zernio-connect',
  publishPost:      'arak-publish-post',
  zernioSync:       'arak-zernio-sync',
  zernioDashboard:  'arak-zernio-dashboard',
  insightsReview:   'arak-insights-review',
  brandResearch:    'arak-brand-research',
  // Research agent. `researchResolve` finds and verifies competitors'
  // Instagram handles — the step the whole competitor board depends on, since
  // the Brand Brain holds zero handles today.
  researchResolve:  'arak-research-resolve',
  // The weekly review itself. ASYNC: this answers with a run id immediately
  // and keeps working — the browser polls research_runs, it never waits.
  researchRun:      'arak-research-run',
}
