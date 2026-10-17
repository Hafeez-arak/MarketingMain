#!/usr/bin/env bash
# Applies a pulled change on the n8n box (WSL): rebuilds the containers the
# change touches, then redeploys the workflows it touches.
#
#   bash n8n/deploy/apply.sh <last deployed commit> <new commit>
#
# Called by auto-deploy.ps1 every time origin/main moves. Safe to run by hand
# with the same two arguments. DRY_RUN=1 prints the plan and changes nothing.
#
# Exit codes: 0 deployed and healthy, 2 something failed (auto-deploy does not
# retry the same commit, the next push retries the whole range), 3 deployed but
# a health check did not come back.
set -uo pipefail
OLD=$1
NEW=$2
cd "$(dirname "$0")/../.." || exit 2
COMPOSE_DIR=n8n/docker
DRY=${DRY_RUN:-}

# --no-renames: a renamed workflow shows as the old name removed and the new
# one added, which is exactly what n8n needs to hear.
changes=$(git -c core.quotePath=false diff --no-renames --name-status "$OLD" "$NEW") || exit 2
changed=$(cut -f2 <<<"$changes")
has() { grep -qE "$1" <<<"$changed"; }
run() { echo "+ $*"; [ -n "$DRY" ] || "$@"; }
echo "$(grep -c . <<<"$changed") file(s) changed"

# 1. Containers. Rebuilding first, because redeploy.sh imports into the running
# n8n and a rebuild after it would only restart it again for nothing. Build and
# up are separate so the build can be --quiet; `up --build` puts the whole
# BuildKit progress output into the auto-deploy log.
if has '^n8n/docker/(docker-compose\.yml|Dockerfile)$'; then
  echo "compose or n8n Dockerfile changed: rebuilding both containers"
  (cd "$COMPOSE_DIR" && run docker compose build --quiet && run docker compose up -d) || { echo "rebuild FAILED"; exit 2; }
  rebuilt_agent=1
elif has '^(server/(Dockerfile|agent\.js|agentHandlers/)|api/agent/|api/zernio/_zernio\.js|src/lib/)'; then
  # The same paths server/Dockerfile COPYs. Anything else in src/ or api/ is
  # Vercel's, not this box's.
  echo "agent code changed: rebuilding the agent"
  (cd "$COMPOSE_DIR" && run docker compose build --quiet agent && run docker compose up -d agent) || { echo "agent rebuild FAILED"; exit 2; }
  rebuilt_agent=1
fi

# 2. Workflows. Added or modified JSON goes through redeploy.sh, which keeps
# each workflow's n8n id, refuses JSON the generator disagrees with, publishes,
# and restarts n8n once at the end.
names=()
while IFS=$'\t' read -r status path; do
  [[ $path =~ ^n8n/workflows/(.+)\.json$ ]] || continue
  name=${BASH_REMATCH[1]}
  if [ "$status" = D ]; then
    # Not removed from n8n automatically: a workflow can carry execution
    # history and credentials someone still wants. Deactivate it by hand.
    echo "WARNING: \"$name\" was removed from the repo but is still in n8n; deactivate it by hand if it should stop"
  else
    names+=("$name")
  fi
done <<<"$changes"

if [ ${#names[@]} -gt 0 ]; then
  echo "redeploying ${#names[@]} workflow(s)"
  run ./n8n/redeploy.sh "${names[@]}" || { echo "workflow redeploy FAILED"; exit 2; }
fi

if [ -z "${rebuilt_agent:-}" ] && [ ${#names[@]} -eq 0 ]; then
  echo "nothing on this box to deploy (app-only change; Vercel deploys that from git)"
  exit 0
fi
[ -z "$DRY" ] || exit 0

# 3. Both containers must answer again. healthz says n8n is up, not that every
# webhook has registered, but it does catch a container that failed to start.
healthy() { curl -sf "localhost:$1/healthz" >/dev/null; }
for _ in $(seq 1 45); do
  if healthy 5680 && healthy 5690; then echo "n8n and agent healthy"; exit 0; fi
  sleep 2
done
healthy 5680 || echo "n8n did not come back healthy; check: cd $COMPOSE_DIR && docker compose logs n8n"
healthy 5690 || echo "agent did not come back healthy; check: cd $COMPOSE_DIR && docker compose logs agent"
exit 3
