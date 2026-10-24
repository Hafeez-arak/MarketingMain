# Deploying the app

The app shows a "This app isn't set up yet" screen when a build has no
Supabase credentials (see `CONFIG_ERROR` in `src/lib/supabaseClient.js`). This
is what fixes it.

Add these to the hosting provider's environment variables, then **redeploy**.
The `VITE_` values are inlined when the app is built, so an existing
deployment will not pick them up on its own.

```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>

# Server-side only (no VITE_ prefix — these must never reach the browser).
# Used by the /api/n8n proxy.
SUPABASE_SERVICE_ROLE_KEY=<service role key>
```

Other server-side keys and what breaks without them (each is logged as
`[config] <NAME> is not set on this deployment` in the function logs; the
screen only says the feature isn't available):

| Variable | Without it |
|---|---|
| `ZERNIO_API_KEY` | Social accounts can't be connected; live platform numbers aren't read |
| `GOOGLE_SA_KEY` | Search Console, GA4 and URL inspection read "not connected" — see WEBSITE-SETUP.md |
| `ANTHROPIC_API_KEY` | The assistant and research don't run |
| `ZERNIO_WORKSPACE_KEYS` | Optional. Every company uses `ZERNIO_API_KEY` |

## A company with its own Zernio account

By default every company shares the one Zernio account behind
`ZERNIO_API_KEY`. To give a company its own Zernio account, for example a free
one opened in that company's name, set `ZERNIO_WORKSPACE_KEYS` to
`<workspace id>=<that account's API key>`. Separate several companies with
commas.

Ghusn's workspace id is `c688dfbe-9d93-4a88-adbb-605e8b81e8f8`, so its entry is

    c688dfbe-9d93-4a88-adbb-605e8b81e8f8=<Ghusn's Zernio key>

Set the same value in **both** places, or posting and analytics disagree:

1. **Vercel** → project `marketing-main` → Settings → Environment Variables →
   add `ZERNIO_WORKSPACE_KEYS` (Production), then redeploy.
2. **The n8n box** → add the line `ZERNIO_WORKSPACE_KEYS=…` to
   `n8n/docker/.env`, then `git pull && ./n8n/redeploy.sh --all`. The
   Publish and Sync workflows read it; the agent container reads it too.

A company's Zernio profile and accounts live inside its own Zernio account.
Set the key **before** anyone connects that company's accounts. If you move
a company that is already connected, clear its `workspaces.zernio_profile_id`
and reconnect its accounts, since the old profile id does not exist in the
new Zernio account.

If n8n can't be reached the proxy logs `[config] n8n base URL is not set`
(start the tunnel with `n8n/docker/start-tunnel.sh`, or set
`app_config.n8n_base_url`) or `[n8n] could not reach the instance`.
