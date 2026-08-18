# Moving this n8n instance to the 24/7 machine

Runbook for standing up the ARAK Content Studio n8n instance on a Windows box
running Linux in WSL2, while the current Mac keeps serving production
untouched until the new one is proven.

Written 2026-08-18 against n8n 2.33.3, 21 workflows.

**Read [Step 0](#step-0--the-three-things-that-will-bite-you) before running
anything.** Two of the three are silent failures — they look like success.

---

## What is actually being moved

Less than it looks. The container holds almost no unique state:

| Thing | Where it lives | Moves how |
|---|---|---|
| 21 workflow definitions | `n8n/workflows/*.json`, in git | already on the new box — you cloned it |
| 8 secrets | `n8n/docker/.env`, gitignored | copied by hand, once |
| ffmpeg | built by `Dockerfile` | rebuilt on the new box |
| Execution history | container volume | **not moved** — see below |
| n8n credential objects | — | **none exist** |

That last row is why this is a short runbook rather than a long one. Every
secret reaches a workflow through `$env.X`; **zero nodes carry a `credentials`
block** (verified by scanning all 21 files). n8n encrypts credential objects
with a key in its volume, and moving those means exporting `N8N_ENCRYPTION_KEY`
and keeping it in sync forever. None of that applies here.

Execution history is deliberately left behind. It is a log, nothing reads it,
and copying a live SQLite file between machines is a good way to move a
corrupt database. The new instance starts with an empty history and a complete
set of workflows.

---

## Step 0 — the three things that will bite you

### 0.1 The webhook guard fails silently, as HTTP 200

Every workflow starts with a **Webhook Secret Guard** node comparing
`x-webhook-secret` against `$env.N8N_WEBHOOK_SECRET`. On mismatch it throws
before any node runs — and because n8n never reaches the Respond node, **the
caller gets HTTP 200 with an empty body, not a 401.**

So a wrong secret does not look broken. It looks like every AI feature quietly
returning nothing. Three values must match exactly:

- `N8N_WEBHOOK_SECRET` in `n8n/docker/.env` on the new box
- the same variable in Vercel's project env
- (for local dev only) the same line in the repo-root `.env`

An unset secret disables the guard entirely — it is a no-op when blank. **Blank
on one side and set on the other is the broken case.**

### 0.2 Two schedule-triggered workflows must NOT run on both machines

These two do not wait to be called — they fire on a timer:

- `Arak Lighting – Zernio Sync`
- `Arak Lighting – Creative Video Reconcile`

Both write to the same Supabase project. While the Mac and the new box are both
up, **both would fire against the same rows** — double-syncing metrics, and two
instances racing to reconcile the same pending video render.

Webhook workflows are safe in parallel (nothing calls the new box until you
publish its URL). These two are not. **Leave them inactive on the new box until
cutover.** Step 5 does this.

### 0.3 The tunnel URL changes on every restart

Production reaches n8n through `app_config.n8n_base_url` in Supabase, currently
a `*.trycloudflare.com` quick tunnel. Quick tunnels get a **new random
hostname** every time `cloudflared` restarts.

`start-tunnel.sh` handles this by PATCHing the new URL into `app_config` the
moment Cloudflare assigns it — no Vercel redeploy needed. But that also means
**any machine running the script takes over production**. During migration the
new box must run it with `--no-publish` (added for exactly this) until you
deliberately cut over.

---

## Step 1 — WSL2 and Docker

Run everything from inside the WSL2 Linux shell, not PowerShell.

```bash
wsl --status
```

If WSL is not installed, from an **admin PowerShell**: `wsl --install -d Ubuntu`,
then reboot.

Install Docker Engine **inside WSL** (not Docker Desktop — Docker Desktop needs
a logged-in Windows desktop session, which is exactly what a 24/7 box should not
depend on):

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

Close and reopen the WSL shell, then confirm it works without sudo:

```bash
docker run --rm hello-world
```

---

## Step 2 — The repo and the secrets

You already cloned it. Make sure it is current — the Instagram retirement
landed on `main` on 2026-08-18 and removed three workflows:

```bash
cd /path/to/Marketing && git checkout main && git pull
```

Confirm 21 files, not 24:

```bash
ls n8n/workflows/*.json | wc -l
```

Now the secrets. `n8n/docker/.env` is gitignored and is the **only** thing that
does not come from git.

> **Do not paste these into chat, a ticket, or a file in the repo.** Move the
> file directly — a USB stick, or `scp` from the Mac. On the Mac the file is at
> `n8n/docker/.env`.

```bash
cp n8n/docker/.env.example n8n/docker/.env
```

Then fill in all eight values from the Mac's copy. `.env.example` lists exactly
the eight the workflows read, with notes on each:

`ANTHROPIC_API_KEY`, `FAL_KEY`, `REPLICATE_API_TOKEN`, `SUPABASE_URL`,
`SUPABASE_KEY`, `ZERNIO_API_KEY`, `TAVILY_API_KEY`, `N8N_WEBHOOK_SECRET`.

`SUPABASE_KEY` is the **service role** key, not the anon key — n8n writes on
behalf of the system and needs to bypass RLS.

---

## Step 3 — Build and start

```bash
cd n8n/docker
docker compose up -d --build
```

The build copies a static ffmpeg binary in (Creative Compose runs ffmpeg
locally). First build takes a few minutes.

```bash
docker ps --filter name=arak-marketing-n8n
docker exec arak-marketing-n8n ffmpeg -version | head -1
```

`restart: unless-stopped` is already set in `docker-compose.yml`, so the
container comes back after a reboot **provided the Docker daemon starts**.
In WSL2, make that true:

```bash
sudo systemctl enable docker
```

If `systemctl` is unavailable, enable systemd in WSL by adding to
`/etc/wsl.conf`, then `wsl --shutdown` from PowerShell:

```ini
[boot]
systemd=true
```

Finally, WSL itself must come up at boot without anyone logging in. In Windows
Task Scheduler create a task: trigger **At startup**, run whether the user is
logged on or not, action `wsl.exe -d Ubuntu -- /bin/true`. That starts the WSL
VM, which starts Docker, which starts the container.

---

## Step 4 — Import the 21 workflows

The container starts empty. Import everything from the repo:

```bash
docker exec arak-marketing-n8n mkdir -p /import
for f in ../workflows/*.json; do
  docker exec -i arak-marketing-n8n sh -c "cat > '/import/$(basename "$f")'" < "$f"
done
docker exec arak-marketing-n8n n8n import:workflow --separate --input=/import
```

> Piped through `cat` rather than `docker cp` on purpose: `docker cp` writes as
> root while n8n runs as `node`, and the import then fails with EACCES on a
> file that is plainly sitting there.

Publish each one (import alone does not activate):

```bash
docker exec arak-marketing-n8n n8n list:workflow | while IFS='|' read -r id name; do
  docker exec arak-marketing-n8n n8n publish:workflow --id="$id" >/dev/null && echo "published $name"
done
```

Check you have 21 and no duplicate names:

```bash
docker exec arak-marketing-n8n n8n list:workflow | wc -l
docker exec arak-marketing-n8n n8n list:workflow | cut -d'|' -f2 | sort | uniq -d
```

The second command must print **nothing**. A duplicate name means two workflows
claim one webhook path with no defined winner. If it does print something, see
`README.md` — the fix is `docker compose down -v` and reimport.

---

## Step 5 — Disable the two scheduled workflows (temporarily)

Per [0.2](#02-two-schedule-triggered-workflows-must-not-run-on-both-machines) —
the Mac is still running these.

```bash
for n in "Arak Lighting – Zernio Sync" "Arak Lighting – Creative Video Reconcile"; do
  id=$(docker exec arak-marketing-n8n n8n list:workflow | awk -F'|' -v n="$n" '$2==n {print $1}')
  docker exec arak-marketing-n8n n8n update:workflow --id="$id" --active=false && echo "paused $n"
done
docker compose restart n8n
```

> A deactivation only takes effect after a restart — n8n says so itself, and
> `redeploy.sh` restarts for the same reason.

Confirm exactly those two are inactive:

```bash
docker exec arak-marketing-n8n n8n list:workflow --active=false
```

---

## Step 6 — Start the tunnel WITHOUT taking over production

`cloudflared` is not in Ubuntu's repositories — install the binary directly:

```bash
curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /tmp/cloudflared
sudo install -m 755 /tmp/cloudflared /usr/local/bin/cloudflared
cloudflared --version
```

Then, from `n8n/docker`:

```bash
./start-tunnel.sh --no-publish
```

It prints a `https://<random>.trycloudflare.com` URL and explicitly does **not**
point the app at it. Copy that URL — call it `$NEW`.

---

## Step 7 — Prove it works, before cutting over

Run these from the new box, against `$NEW`. **This is the step that decides
whether the migration is safe.**

```bash
NEW=https://<the-url-from-step-6>
SEC=$(grep '^N8N_WEBHOOK_SECRET=' .env | cut -d= -f2-)
```

**7a — the guard rejects an unsigned call:**

```bash
curl -s -o /dev/null -w "unsigned: http=%{http_code} bytes=%{size_download}\n" -X POST "$NEW/webhook/arak-fal-balance" -H 'Content-Type: application/json' -d '{}'
```

Expect `http=200 bytes=0`. Zero bytes **is** the rejection — see 0.1.

**7b — a signed call reaches the workflow:**

```bash
curl -s -X POST "$NEW/webhook/arak-fal-balance" -H 'Content-Type: application/json' -H "x-webhook-secret: $SEC" -d '{}'
```

Expect real JSON, e.g. `{"balance":20.36,"currency":"USD"}`. This single call
proves four things at once: the tunnel routes, the guard matches, `FAL_KEY` is
valid, and the container has outbound network.

**7c — Supabase credentials work.** `SUPABASE_KEY` is not exercised by 7b, and
a wrong key here fails silently later:

```bash
SB_URL=$(grep '^SUPABASE_URL=' .env | cut -d= -f2-)
SB_KEY=$(grep '^SUPABASE_KEY=' .env | cut -d= -f2-)
curl -s -o /dev/null -w "supabase: %{http_code}\n" "$SB_URL/rest/v1/app_config?select=key&limit=1" -H "apikey: $SB_KEY" -H "Authorization: Bearer $SB_KEY"
```

Expect `200`. A `401` means the anon key was pasted instead of the service key.

**7d — the retired Instagram webhooks are gone** (they must never have been
imported; this confirms the repo you pulled is current):

```bash
for p in arak-ig-plan-generation arak-instagram arak-instagram-reels; do
  curl -s -o /dev/null -w "$p: %{http_code}\n" -X POST "$NEW/webhook/$p" -d '{}'
done
```

Expect `404` for all three.

**Do not continue until 7a–7d all pass.**

---

## Step 8 — Cut over

One command moves production. Run it when Step 7 is green and nobody is
mid-generation.

```bash
curl -s -o /dev/null -w "cutover: %{http_code}\n" -X PATCH \
  "$SB_URL/rest/v1/app_config?key=eq.n8n_base_url" \
  -H "apikey: $SB_KEY" -H "Authorization: Bearer $SB_KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=minimal" \
  -d "{\"value\":\"$NEW\",\"updated_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
```

Expect `204`. No Vercel redeploy is needed — the proxy reads this per request.

Then re-enable the two scheduled workflows on the new box:

```bash
for n in "Arak Lighting – Zernio Sync" "Arak Lighting – Creative Video Reconcile"; do
  id=$(docker exec arak-marketing-n8n n8n list:workflow | awk -F'|' -v n="$n" '$2==n {print $1}')
  docker exec arak-marketing-n8n n8n update:workflow --id="$id" --active=true
done
docker compose restart n8n
```

**Now stop the Mac's tunnel** (Ctrl+C in its terminal). Its container can keep
running harmlessly — nothing points at it — but its two scheduled workflows are
still firing, so on the Mac also run the Step 5 pause, or stop the container:

```bash
# on the Mac
cd n8n/docker && docker compose stop n8n
```

Verify from anywhere that production now answers on the new box:

```bash
curl -s "$SB_URL/rest/v1/app_config?key=eq.n8n_base_url&select=value" -H "apikey: $SB_KEY" -H "Authorization: Bearer $SB_KEY"
```

Then sign into the app and run one real action end to end — generate an image in
Creative Studio. That exercises the Vercel proxy, the guard, `FAL_KEY` and the
Supabase write in one go.

---

## Keeping it alive

**Restart the tunnel automatically.** The container restarts itself; the tunnel
does not. Because a new URL must be republished, run the publishing version
under a supervisor. In WSL:

```bash
sudo tee /etc/systemd/system/arak-tunnel.service >/dev/null <<'UNIT'
[Unit]
Description=ARAK n8n Cloudflare tunnel
After=docker.service
Requires=docker.service

[Service]
Type=simple
User=YOUR_WSL_USER
WorkingDirectory=/path/to/Marketing/n8n/docker
ExecStart=/path/to/Marketing/n8n/docker/start-tunnel.sh
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload && sudo systemctl enable --now arak-tunnel
```

Note: **no** `--no-publish` here. Once migrated, republishing on every restart
is exactly what you want — it is what makes a tunnel restart a non-event.

**The remaining weak point.** Between a tunnel dropping and the new URL landing
in `app_config`, calls fail. Nothing detects it. If this becomes a problem, the
real fix is a Cloudflare **named tunnel** on a domain you control — a permanent
hostname, set `app_config` once, never again. Worth revisiting if you ever put
`arak-sa.com` (or any domain) on Cloudflare.

---

## Deploying workflow changes afterwards

Unchanged, and still the only correct route — never hand-edit workflow JSON:

```bash
python3 n8n/gen_workflows.py
./n8n/redeploy.sh "Arak Lighting – Creative Compose"
```

`redeploy.sh` looks up the existing id and injects it before importing, which is
what stops a second copy appearing on the same webhook path. It restarts n8n at
the end so activation takes effect.

---

## If something is wrong

| Symptom | Cause |
|---|---|
| Every AI feature returns nothing; HTTP 200, empty body | `N8N_WEBHOOK_SECRET` mismatch — see 0.1 |
| Webhook returns 404 | workflow not published, or not active — re-run Step 4, restart |
| `healthz` is 200 but webhooks 404 | normal briefly after a restart; healthz lies, poll the webhook |
| Workflow imports fine but never activates; log says "Unrecognized node type" | `NODES_EXCLUDE` — Creative Compose needs ExecuteCommand; already set in compose |
| `getaddrinfo ENOTFOUND fal.run` | DNS; compose already pins 1.1.1.1 / 8.8.8.8 |
| A Code node dies at exactly 300s | `N8N_RUNNERS_TASK_TIMEOUT`; already set to 600 in compose |
| App 503s with "n8n base URL not configured" | `app_config.n8n_base_url` is empty or stale |
| Metrics doubling / videos reconciled twice | both machines running the scheduled workflows — see 0.2 |
