# Moving this n8n instance to the 24/7 machine

Runbook for standing up the ARAK Content Studio n8n instance on a Windows box
running Linux in WSL2, while the current Mac keeps serving production
untouched until the new one is proven.

Written 2026-08-18 against n8n 2.33.3, 21 workflows.

> ## ✅ Migration complete — 2026-08-18
>
> Production runs on the 24/7 box, reached at a permanent `*.ngrok-free.dev`
> address held in `app_config.n8n_base_url`. Verified from outside: **20/20
> webhooks registered**, the secret guard rejecting unsigned calls and passing
> signed ones, and the three retired Instagram paths returning 404.
>
> **The Mac is stood down.** Its container is stopped and its cloudflared tunnel
> killed, which is what ended the double-scheduler overlap in §0.2. No damage
> came of that overlap — there were no `pending` video rows at any point during
> it, so the two reconcilers never had anything to race over.
>
> The steps below are kept as the record of how this was done, and as the
> procedure for rebuilding the box or standing up another one.
>
> **Two standing rules now that the Mac is not production:**
> 1. Never run `start-tunnel.sh` here without `--no-publish` — it rewrites
>    `app_config.n8n_base_url` and takes production back.
> 2. Restarting the Mac's container for local work is fine, but leave
>    `Zernio Sync` and `Creative Video Reconcile` **inactive** on it. They are
>    schedule-triggered (Reconcile every 2 minutes) and would double-process the
>    same Supabase rows all over again.

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

### 0.3 One URL controls production, and the Mac's changes constantly

Production reaches n8n through `app_config.n8n_base_url` in Supabase. Whatever
that column says is where every AI feature goes — no Vercel redeploy is involved,
which is what makes cutover a single command in Step 8.

The Mac serves a `*.trycloudflare.com` **quick tunnel**, whose hostname is random
and **changes every time `cloudflared` restarts**. `start-tunnel.sh` compensates
by PATCHing each new URL into `app_config` as Cloudflare assigns it — which also
means **running that script on any machine takes over production.** Do not run it
on the new box.

The new box uses ngrok instead, on a permanently assigned hostname (Step 6). That
removes the churn entirely: `app_config` is written once, at cutover, and never
again. Until you run that one PATCH, the new instance is invisible to users no
matter how much you test against it.

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

## Step 6 — Expose it on a permanent URL (ngrok)

**This is the one step that differs from how the Mac has been running**, and it is
a deliberate upgrade rather than a like-for-like port.

The Mac uses a Cloudflare *quick* tunnel, whose hostname is random and changes on
every restart. That is why `start-tunnel.sh` exists at all: it writes the new URL
into `app_config.n8n_base_url` each time so the app can follow it. On a machine
meant to run for years, that churn is the weakest part of the system — every
restart is a window where calls fail, and nothing detects it.

ngrok's free plan includes **one permanently assigned domain** that does not
change or expire. With it, `app_config.n8n_base_url` is set once at cutover and
never touched again, and a tunnel restart becomes a true non-event: same
hostname, no republish, no gap. `start-tunnel.sh` and its `--no-publish` flag are
then only needed for the Mac.

### 6.1 Account and domain

1. Create a free account at ngrok.com.
2. **Dashboard → Domains** — the free plan grants one. It looks like
   `some-words-here.ngrok-free.app`. Copy it.
3. **Dashboard → Your Authtoken** — copy that too. Treat it like the other
   secrets: it is what lets a machine claim your domain.

### 6.2 Install and authenticate

```bash
curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc \
  | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null
echo "deb https://ngrok-agent.s3.amazonaws.com bookworm main" \
  | sudo tee /etc/apt/sources.list.d/ngrok.list
sudo apt update && sudo apt install -y ngrok
ngrok version
```

```bash
ngrok config add-authtoken <YOUR_AUTHTOKEN>
```

### 6.3 Point it at the container

The container publishes on host port **5680** (see `docker-compose.yml`).

```bash
ngrok http 5680 --url=https://YOUR-DOMAIN.ngrok-free.app
```

Leave it running for now. That URL is `$NEW` for Step 7 — and unlike the
Cloudflare one, it is the URL forever.

> **This does not touch production.** Nothing points at ngrok until you run the
> PATCH in Step 8. There is no `--no-publish` equivalent to remember, because
> ngrok has no publishing step at all — which is precisely the simplification.

### Does this fit the free plan?

Yes, with a lot of room, because of how the system is shaped:

| Limit | Free plan | This workload |
|---|---|---|
| Requests | 4,000 / min | one call per deliberate user action |
| Outbound data | 1 GB / month | small JSON in, small JSON out |
| Endpoints / agents | 3 | 1 |
| Session timeout | none | — |

The reason the data cap is comfortable is that **the tunnel never carries media.**
Images and video move n8n → fal → Supabase Storage directly; the tunnel sees only
the webhook request and its JSON reply. Nor does anything poll through it: the
Creative Studio progress poller reads Supabase every 4s, not n8n — n8n owns
writing results back to the table, which is also why closing the tab
mid-generation loses nothing.

The one way to break this would be a future workflow that returns image or video
**bytes** in its webhook response instead of a URL. Don't do that; return the
Storage URL, as every workflow does today.

---

## Step 7 — Prove it works, before cutting over

Run these from the new box, against `$NEW`. **This is the step that decides
whether the migration is safe.**

```bash
NEW=https://YOUR-DOMAIN.ngrok-free.app   # the permanent one from Step 6
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

The container restarts itself (`restart: unless-stopped`). The ngrok agent does
not, so put it under systemd. Because the hostname is permanent, this unit has
no publishing logic and no URL to chase — it just reconnects.

```bash
sudo tee /etc/systemd/system/arak-ngrok.service >/dev/null <<'UNIT'
[Unit]
Description=ARAK n8n ngrok tunnel
After=docker.service network-online.target
Requires=docker.service

[Service]
Type=simple
User=YOUR_WSL_USER
ExecStart=/usr/local/bin/ngrok http 5680 --url=https://YOUR-DOMAIN.ngrok-free.app --log=stdout
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload && sudo systemctl enable --now arak-ngrok
systemctl status arak-ngrok --no-pager
```

Check `which ngrok` and correct the `ExecStart` path if apt installed it to
`/usr/bin/ngrok`.

### What can still take it down

Being straight about this, because "it won't go down" would not be true of any
setup:

- **Windows is now the weak link, not the tunnel.** Once the URL is permanent,
  the realistic cause of an outage is the host: an automatic Windows Update
  reboot, WSL not starting on boot, or the Docker daemon not coming up. Set
  Windows Update to a fixed maintenance window with automatic restarts off, and
  actually test a full reboot before trusting the box — reboot it once and
  confirm the container and tunnel both come back with nobody logged in.
- **The ngrok agent dying** — handled by `Restart=always` above, and harmless
  now that the hostname survives a restart.
- **An ngrok service outage.** Real, but the same class of risk as Cloudflare,
  and unavoidable with any tunnel.
- **The free plan is a developer tier**, not an SLA'd product. It fits this
  workload comfortably today, but if usage grows past ~1 GB/month of webhook
  traffic, endpoints are cut off until the billing cycle resets. Watch it in the
  ngrok dashboard occasionally rather than assuming.
- **Losing the authtoken** would mean a new domain and one `app_config` update.
  Keep it with the other secrets.

The upgrade path, if it ever matters: a Cloudflare **named** tunnel on a domain
you control is free and has no bandwidth cap. It needs that domain's nameservers
moved to Cloudflare — which for `arak-sa.com` would also move its MX records, so
it is a real change to weigh against company email, not a quick swap.

### The Cloudflare quick tunnel, for reference

`start-tunnel.sh` (and its `--no-publish` flag) stays in the repo for the Mac and
for local testing. It is no longer part of the 24/7 setup — the whole reason it
PATCHes `app_config` on every start is a churning hostname that ngrok removes.

---

## Deploying workflow changes afterwards

**`redeploy.sh` is local-only.** Every command in it is `docker exec` against a
container on the machine it runs on. There is no remote mode, and adding one
would mean exposing n8n's API to the internet. So a deploy is now two halves on
two machines, and git is what joins them.

### On the Mac (or wherever you edit)

Never hand-edit workflow JSON — `gen_workflows.py` is the source of truth, and
the generated JSON is committed precisely so the box does not need Python.

```bash
python3 n8n/gen_workflows.py          # rewrites n8n/workflows/*.json
git add -A && git commit -m "..." && git push
```

Regenerating and committing in the *same* commit is the whole contract. Push the
generator without its JSON and the box deploys the old workflow while every
check passes.

### On the 24/7 box

```bash
cd /path/to/Marketing
git pull
./n8n/redeploy.sh --all                       # or name specific workflows
```

`--all` covers everything in `workflows/`, which is what you want after pulling
a change you did not personally make. Naming workflows individually is faster
when you know exactly what changed.

`redeploy.sh` looks up each workflow's existing id and injects it before
importing — that is what stops a second copy appearing on the same webhook path
— then publishes and restarts n8n so activation takes effect. Expect ~15s where
webhooks 404 during that restart.

### The staleness guard

Before deploying anything, `redeploy.sh` re-runs the generator into a scratch
directory and diffs the result against the committed JSON. If they differ it
**refuses to deploy** and tells you to regenerate.

That exists for one specific failure: someone edits `gen_workflows.py`, commits
without regenerating, and pushes. The box pulls, deploys stale JSON, and
everything reports success — workflow published, webhook answering, and none of
the change actually in it. The check is skipped where `python3` is absent (the
box does not need it), so it protects the machine that edits as much as the one
that deploys.

### Verifying a deploy landed

An unsigned POST is free — the secret guard kills it before any node runs — so
this is a safe way to confirm every webhook is registered:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$NEW/webhook/arak-draft-copy" -d '{}'
```

**`404` means not registered. Anything else means it is.** Do not check for
`200` specifically: the guard's rejection surfaces as `200` with an empty body
on `responseMode=responseNode` workflows and as `500` on `responseMode=lastNode`
ones (7 of the 21 — Caption Studio, Elongate Idea, Media Options, Creative
Enhance, Publish Post, Zernio Sync, Zernio Dashboard). Both are the same
rejection; only the shape on the wire differs.

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
