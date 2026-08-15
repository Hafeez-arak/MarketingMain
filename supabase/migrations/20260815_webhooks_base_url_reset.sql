-- ════════════════════════════════════════════════════════════════════════
-- Reset stored webhook URLs to "unset" — ARAK Content Studio
-- ════════════════════════════════════════════════════════════════════════
-- workspace_webhooks used to hold 27 fully-qualified n8n URLs per workspace
-- (host + /webhook/<path>). The host now comes from the app's build instead
-- (VITE_N8N_BASE_URL) and the paths from src/lib/n8nWebhooks.js, so a stored
-- host is no longer configuration — it's a stale copy of one, and the app
-- prefers a non-empty stored value over its own default.
--
-- Concretely: every value in here pointed at http://localhost:5680, which
-- only ever resolved on the one Mac running Docker. For anyone else on the
-- team, every button in the app called a host that doesn't exist for them.
--
-- Blanking a slot does NOT disable it. '' means "no override", and the app
-- falls back to VITE_N8N_BASE_URL + the slot's fixed path — so after this
-- runs, every workspace (including ones created later) is pointed at
-- whatever n8n instance the current build names, with nothing to configure
-- and nothing to redo the next time the tunnel hands out a new hostname.
--
-- Run ONCE in the Supabase SQL editor (project: "Arak Marketing").
-- Safe to re-run: the rules below are idempotent, and a slot already ''
-- stays ''.
--
-- Deliberately NOT a blanket `set webhooks = '{}'`. A workspace is still
-- allowed to point a slot at a genuinely different endpoint (someone
-- testing against their own n8n), and that has to survive. Three rules,
-- applied per slot:
--
--   1. Ours on any host — the path matches that slot's own webhook path.
--      This is the stale-host case. Blank it; the build knows the host.
--   2. Not an n8n webhook at all — no /webhook/ segment anywhere. Only
--      reachable by mis-pasting something into the field (one row had the
--      app's own Netlify URL in `creativeEnhance`), and it cannot do
--      anything but fail at call time. Blank it.
--   3. Anything else — a real endpoint on a path that isn't ours. Left
--      exactly as it is.
-- ════════════════════════════════════════════════════════════════════════

with our_paths(slot, path) as (
  values
    ('instagram',        'arak-instagram'),
    ('instagramReels',   'arak-instagram-reels'),
    ('linkedin',         'arak-linkedin'),
    ('campaignPlanner',  'arak-campaign-planner'),
    ('instagramPlanGen', 'arak-ig-plan-generation'),
    ('linkedinPlanGen',  'arak-li-plan-generation'),
    ('elongateIdea',     'arak-elongate-idea'),
    ('captionStudio',    'arak-caption-studio'),
    ('draftCopy',        'arak-draft-copy'),
    ('mediaOptions',     'arak-media-options'),
    ('videoRender',      'arak-video-render'),
    ('creativeGenerate', 'arak-creative-generate'),
    ('creativeEdit',     'arak-creative-edit'),
    ('creativeVideo',    'arak-creative-video'),
    ('creativeVideoEdit','arak-creative-video-edit'),
    ('creativeCompose',  'arak-creative-compose'),
    ('creativeEnhance',  'arak-creative-enhance'),
    ('creativeStitch',   'arak-creative-stitch'),
    ('creativeCancel',   'arak-creative-cancel'),
    ('falBalance',       'arak-fal-balance'),
    ('publishPost',      'arak-publish-post'),
    ('zernioSync',       'arak-zernio-sync'),
    ('zernioDashboard',  'arak-zernio-dashboard')
)
update public.workspace_webhooks w
set webhooks = coalesce((
      select jsonb_object_agg(e.key, case
        -- Not a string: leave whatever it is alone rather than guess.
        when jsonb_typeof(e.value) <> 'string' then e.value
        -- Rule 1: our path, any host.
        when p.path is not null
             and (e.value #>> '{}') ~ ('/webhook(-test)?/' || p.path || '/?$')
          then '""'::jsonb
        -- Rule 2: not an n8n webhook endpoint at all.
        when (e.value #>> '{}') !~ '/webhook(-test)?/'
          then '""'::jsonb
        -- Rule 3: a deliberate override on some other path.
        else e.value
      end)
      from jsonb_each(w.webhooks) e
      left join our_paths p on p.slot = e.key
    ), '{}'::jsonb),
    updated_at = now();

-- Verification — expect `remaining_overrides` to be 0 for every workspace
-- unless someone is intentionally pointing a slot elsewhere.
select w.workspace_id,
       count(*) filter (where jsonb_typeof(e.value) = 'string'
                          and btrim(e.value #>> '{}') <> '') as remaining_overrides
from public.workspace_webhooks w
left join lateral jsonb_each(w.webhooks) e on true
group by w.workspace_id
order by w.workspace_id;
