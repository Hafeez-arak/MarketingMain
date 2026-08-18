#!/usr/bin/env bash
# Push regenerated workflow JSON into the running container.
#
#   ./n8n/redeploy.sh "Arak Lighting – Creative Compose" [more names...]
#
# Two traps this exists to avoid, both of which report success while shipping
# nothing (see CREATIVE-STUDIO.md):
#
#  1. Import does NOT update in place unless the JSON carries the id n8n
#     already assigned. Without it you get a SECOND workflow on the same webhook
#     path with no defined winner — which is exactly how the repo ended up with
#     two "Creative Video" workflows. This script looks the id up from
#     `n8n list:workflow` and injects it before importing.
#  2. `docker cp dir container:/existing` puts the source INSIDE the
#     destination, so reusing a path leaves stale files where --separate reads
#     them and hides the new ones a level down. Copied files are owned by root
#     while n8n runs as `node`, so they can't be deleted to recover. Hence a
#     fresh timestamped directory every run.
#
# Also note: `healthz` returns 200 well before webhooks are registered, so the
# only honest readiness check is polling the webhook itself.
#
# RUNS LOCALLY ONLY. Everything below is `docker exec` against a container on
# THIS machine — there is no remote mode and adding one would mean exposing
# n8n's API. Since the move to the 24/7 box, deploying a workflow change means
# running this ON that box after a git pull. See docker/MIGRATION.md.
#
#   ./n8n/redeploy.sh --all        # everything in workflows/ (after a pull)
#   ./n8n/redeploy.sh "Name" ...   # just these
set -euo pipefail

CONTAINER=arak-marketing-n8n
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "${1:-}" = "--all" ]; then
  shift
  # Read into an array, not `set -- $(ls ...)`: every workflow name contains
  # spaces ("Arak Lighting – Draft Copy"), so word-splitting a command
  # substitution would turn 21 names into ~70 fragments and fail on the first.
  ALL=()
  while IFS= read -r f; do
    ALL+=("$(basename "$f" .json)")
  done < <(find "$HERE/workflows" -maxdepth 1 -name '*.json' | sort)
  [ ${#ALL[@]} -gt 0 ] || { echo "no workflow JSON found in $HERE/workflows" >&2; exit 1; }
  set -- "${ALL[@]}"
  echo "deploying all $# workflow(s)"
fi

[ $# -ge 1 ] || { echo "usage: $0 --all | <workflow name> [...]" >&2; exit 1; }

# ── Is the committed JSON actually what the generator produces? ─────────────
# The trap this catches: someone edits gen_workflows.py, commits, and pushes
# WITHOUT re-running the generator. The box then pulls, deploys the stale JSON,
# and every check passes — the workflow is published, the webhook answers, and
# none of the change is in it. Exactly the "reports success while shipping
# nothing" failure this script already exists to prevent, just one step
# earlier in the chain.
#
# Skipped when python3 is absent (the box does not need it — the JSON is
# committed) and never fatal on its own; it only refuses to deploy something
# it can prove is stale.
if command -v python3 >/dev/null 2>&1 && [ -f "$HERE/gen_workflows.py" ]; then
  CHECK=$(mktemp -d)
  # The generator writes to a path derived from its OWN location, not from cwd
  # (`os.path.dirname(os.path.abspath(__file__))`). So it has to be COPIED into
  # the scratch dir and run from there — invoking it in place would regenerate
  # over the real workflows/ and silently "fix" the staleness this is meant to
  # detect, which is worse than not checking at all.
  cp "$HERE/gen_workflows.py" "$CHECK/" 2>/dev/null
  if python3 "$CHECK/gen_workflows.py" >/dev/null 2>&1 && [ -d "$CHECK/workflows" ]; then
    STALE=""
    for NAME in "$@"; do
      if [ -f "$CHECK/workflows/$NAME.json" ] && ! diff -q "$HERE/workflows/$NAME.json" "$CHECK/workflows/$NAME.json" >/dev/null 2>&1; then
        STALE="$STALE  • $NAME"$'\n'
      fi
    done
    rm -rf "$CHECK"
    if [ -n "$STALE" ]; then
      echo "✋ The committed JSON does not match gen_workflows.py for:" >&2
      printf '%s' "$STALE" >&2
      echo "   Someone changed the generator without regenerating. Run:" >&2
      echo "     python3 n8n/gen_workflows.py   # then commit the JSON it writes" >&2
      echo "   Deploying now would publish the OLD workflow and look successful." >&2
      exit 1
    fi
  else
    rm -rf "$CHECK"
  fi
fi

STAGE="/tmp/redeploy-$(date +%s)"
docker exec "$CONTAINER" mkdir -p "$STAGE"

LIST=$(docker exec "$CONTAINER" n8n list:workflow)
ACTIVE=$(docker exec "$CONTAINER" n8n list:workflow --active=true)

for NAME in "$@"; do
  SRC="$HERE/workflows/$NAME.json"
  [ -f "$SRC" ] || { echo "no such workflow file: $SRC" >&2; exit 1; }

  # Existing id, if n8n already knows this workflow. Names ARE duplicated in
  # this instance — "Creative Video" exists twice, from an earlier import that
  # ran without an id — so the active list is consulted first: that is the copy
  # actually serving the webhook, and updating the inactive twin would look
  # like a successful deploy that changed nothing.
  ID=$(printf '%s\n' "$ACTIVE" | awk -F'|' -v n="$NAME" '$2==n {print $1}' | head -1)
  [ -n "$ID" ] || ID=$(printf '%s\n' "$LIST" | awk -F'|' -v n="$NAME" '$2==n {print $1}' | head -1)
  DUPES=$(printf '%s\n' "$LIST" | awk -F'|' -v n="$NAME" '$2==n' | wc -l | tr -d ' ')
  [ "$DUPES" -le 1 ] || echo "  ⚠ $DUPES copies of \"$NAME\" exist; updating the active one ($ID)."

  TMP=$(mktemp)
  if [ -n "$ID" ]; then
    python3 -c "
import json,sys
wf=json.load(open(sys.argv[1]))
wf['id']=sys.argv[2]
json.dump(wf,open(sys.argv[3],'w'),indent=2,ensure_ascii=False)
" "$SRC" "$ID" "$TMP"
    echo "updating in place: $NAME ($ID)"
  else
    cp "$SRC" "$TMP"
    echo "importing new: $NAME"
  fi

  # Piped through stdin rather than `docker cp`, which writes as root while n8n
  # runs as `node` — the import then fails with EACCES on a file that is plainly
  # sitting there. `cat >` inside exec creates it owned by the exec user.
  docker exec -i "$CONTAINER" sh -c "cat > '$STAGE/$NAME.json'" < "$TMP"
  rm -f "$TMP"
done

docker exec "$CONTAINER" n8n import:workflow --separate --input="$STAGE"

for NAME in "$@"; do
  ID=$(docker exec "$CONTAINER" n8n list:workflow | awk -F'|' -v n="$NAME" '$2==n {print $1}' | head -1)
  docker exec "$CONTAINER" n8n publish:workflow --id="$ID" >/dev/null
  echo "published $NAME ($ID)"
done

echo "restarting n8n so activation takes effect..."
(cd "$HERE/docker" && docker compose restart n8n >/dev/null)
echo "done — poll the webhook itself for {\"status\":\"accepted\"}; healthz lies."
