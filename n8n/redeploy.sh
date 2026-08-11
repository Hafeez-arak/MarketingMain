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
set -euo pipefail

CONTAINER=arak-marketing-n8n
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ $# -ge 1 ] || { echo "usage: $0 <workflow name> [...]" >&2; exit 1; }

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
