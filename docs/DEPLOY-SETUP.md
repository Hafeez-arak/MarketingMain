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

If n8n can't be reached the proxy logs `[config] n8n base URL is not set`
(start the tunnel with `n8n/docker/start-tunnel.sh`, or set
`app_config.n8n_base_url`) or `[n8n] could not reach the instance`.
