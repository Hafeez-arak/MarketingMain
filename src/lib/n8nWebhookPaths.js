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
  // Zernio — the only publishing + analytics path. The three Meta slots
  // (metaPublish/metaSync/metaDashboard) were removed on 2026-09-14 with the
  // test account they served; dropping them is what stops this proxy
  // forwarding to the Meta workflows still published on the box. `zernioConnect` is deliberately ABSENT: per-workspace OAuth moved
  // to api/zernio/[action].js on 2026-09-10 and the workflow is retired.
  // Leaving the slot here would keep arak-zernio-connect reachable through
  // this proxy, and that workflow takes workspace_id straight off the request
  // body without checking membership — so any signed-in user could list or
  // disconnect any other workspace's accounts. Removing the slot is what
  // closes that without needing access to the n8n box.
  publishPost:      'arak-publish-post',
  zernioSync:       'arak-zernio-sync',
  zernioDashboard:  'arak-zernio-dashboard',
  insightsReview:   'arak-insights-review',
  // No brandResearch slot. `arak-brand-research` wrote `proposed` rows into
  // brand_memory from a second code path; the research agent's run does the
  // same job with evidence attached, so the UI stopped calling it. Leaving
  // the slot here would keep it reachable through this proxy.
  // Research agent. `researchResolve` finds and verifies competitors'
  // Instagram handles — the step the whole competitor board depends on, since
  // the Brand Brain holds zero handles today.
  researchResolve:  'arak-research-resolve',
  // The weekly review itself. ASYNC: this answers with a run id immediately
  // and keeps working — the browser polls research_runs, it never waits.
  researchRun:      'arak-research-run',
  // The research run the Run button starts. The "Agent — weekly research run"
  // workflow answers it: it starts the run on the agent container next to n8n
  // and drives every lens and the brief itself. Also what runs on Mondays.
  agentRun:         'arak-agent-run',
  // On-demand Website analysis. These two agent handlers run in the private
  // agent container through one n8n gateway so Vercel stays at its 12-function
  // Hobby-plan ceiling. Do not add unrelated agent routes here: this gateway
  // intentionally only allows index health and the written explanation.
  agentWebsite:     'arak-agent-website',
  // The composer's "analyse this post". Its own gateway rather than a third
  // action on agentWebsite: that one is a Website gateway and says so, and a
  // composer critique arriving through it would be the first step in turning a
  // named allowlist back into the generic proxy both of these exist to avoid.
  // Also carries the planner's reword-an-idea call: both are AI acting on the
  // WORDS of a post, so they share a gateway and its allowlist.
  agentComposer:    'arak-agent-composer',
  // "How did our own posts do". Its own gateway because it is the one that
  // forwards a GET with a query string — that is the handler's contract and
  // moving it off Vercel should not change it.
  agentReports:     'arak-agent-reports',
}
