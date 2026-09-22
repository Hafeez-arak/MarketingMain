# n8n workflow generator

`gen_workflows.py` programmatically builds the n8n JSON for ARAK's 4 "v2" content-generation workflows (Instagram, LinkedIn, Caption Studio, Elongate Idea). It replaces an earlier script of the same name that lived in a throwaway scratchpad directory and was permanently lost — only its JSON output survived, which is what this script was reverse-built from. Keeping the generator in the repo means this can't happen again.

To regenerate the JSON after editing this script, run:

```
python3 gen_workflows.py
```

This writes the 4 files into `workflows/`. After any change to the Python source, re-run the script and re-import the changed workflow JSON file(s) into n8n — never hand-edit the generated JSON directly, since it will just be overwritten (and drift from the source of truth) the next time someone runs the generator.

All workflows are zero-secret: credentials (`ANTHROPIC_API_KEY`, `REPLICATE_API_TOKEN`, `SUPABASE_URL`, `SUPABASE_KEY`, optional `IMAGE_PROVIDER`/`FAL_KEY`) are read from n8n environment variables at runtime, never hardcoded here.

## `Arak Campaign Planner` went async on 2026-09-20 — REDEPLOY IT

It now answers `202 {status:'accepted'}` immediately and PATCHes the finished plan onto `content_plans.generation_result` when Opus returns, instead of answering with the ideas and letting the browser save them. That old shape is why a big month could be paid for and thrown away: one Opus call with adaptive thinking outlives the serverless proxy in front of n8n, the request 504'd, and n8n finished into a socket nobody was holding.

Two things follow:

- **The app detects a stale deployment and says so.** `startCampaignPlan` refuses a response that still contains `posts` and tells you to redeploy, rather than polling a row nothing will ever write to. So until `n8n/redeploy.sh` has run on the box, every plan fails with that message — it is not a new bug.
- **It needs `SUPABASE_URL` + `SUPABASE_KEY`** now, not just `ANTHROPIC_API_KEY`. Both are already set on the box for `Arak Lighting – Draft Copy`, which has used this same respond-then-write pattern all along.

The matching app change also requires `supabase/migrations/20260920_plan_generation_async.sql` to have been applied by hand, as always.

Every platform publishes and syncs through the `Zernio *` workflows. The three Meta workflows (`Publish Post (Meta)`, `Meta Insights Sync`, `Meta Dashboard`) were removed on 2026-09-14 along with the test Instagram account they served — **deactivate and delete them on the box**, because regenerating never removes a workflow n8n already has, and Meta Insights Sync re-activates that account's `social_accounts` row every day it runs. `META_IG_TOKEN` + `META_IG_USER_ID` remain for competitor `business_discovery` only (see `docker/.env.example` for the token-expiry trap).

**Zernio Connect is gone from here (2026-09-10).** Per-workspace OAuth now lives in `api/zernio/[action].js`, a Vercel function in this repo, unit-tested against captured Zernio responses (`api/zernio/_zernio.test.js`). It was removed rather than left generating: the workflow's tenancy filter stringified Zernio's *populated* `profileId` reference and therefore discarded every account it was ever handed, and it took `workspace_id` off the request body with no membership check. `zernioConnect` is gone from `WEBHOOK_PATHS` so the proxy no longer forwards to it — but **the workflow may still be published on the box**. Deactivate `Arak Lighting – Zernio Connect` there, or rename its webhook path to `retired-arak-zernio-connect`, the way the LinkedIn workflows were retired.

`Publish Post (Zernio)` and `Zernio Sync` carried the same populated-reference trap and both resolved accounts from an *unscoped* `GET /v1/accounts` — every account the API key can see, across every tenant. Both are now scoped by the workspace's `zernio_profile_id`, and both have tests (`zernioPublish.test.js`, `zernioSync.test.js`). **They need a redeploy on the box to take effect.**

## Website Agent gateway — deploy it with the agent container

`Arak Lighting – Website Agent` moves only the two newly added, on-demand Website checks (`indexHealth` and `websiteExplain`) off Vercel and through the existing private `agent` container. The prior deployment already used all 12 Hobby-plan functions; adding these two made Vercel reject it. The workflow accepts only these two actions — it is not a generic proxy.

After pulling this change on the n8n box, rebuild the agent image and import the workflow:

```bash
cd n8n/docker && docker compose up -d --build agent
cd .. && ./redeploy.sh "Arak Lighting – Website Agent"
```

Then redeploy Vercel. The Vercel proxy still checks the signed-in browser and sends the webhook secret; n8n forwards the browser token only over the Docker network, where the agent continues to check the caller's membership in the requested workspace.

## Composer Agent gateway — same reason, same shape

`Arak Lighting – Composer Agent` carries the composer's **"Analyse this post"** critique. It was added as a Vercel function first and that was a mistake: Hobby allows **12** Serverless Functions per deployment, the repo was already at 12, and the thirteenth does not slow the deployment down — it fails the **build**, so production stayed on the previous version and every unrelated fix queued behind it. `api/vercelFunctionBudget.test.js` now fails locally before that can happen again.

The workflow accepts one action, `critique`, and nothing else.

```bash
cd n8n/docker && docker compose up -d --build agent
cd .. && ./redeploy.sh "Arak Lighting – Composer Agent"
```

Both gateways are deliberately separate. `arak-agent-website` is a Website gateway and says so in its own note; routing a composer critique through it would be the first step in turning a named allowlist back into the generic internal proxy both of them exist to prevent.

The workflow Code nodes are covered by tests such as `zernioPublish.test.js` and `zernioSync.test.js`, which run the **generated JSON** — not a copy of the source — through `workflowHarness.js` with Instagram and Supabase stubbed. If you change a Code node, regenerate first (`python3 gen_workflows.py`) or the tests will still be checking the old one.
