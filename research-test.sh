#!/usr/bin/env bash
# Stage 0 end-to-end check. Read-only against Instagram (business_discovery),
# no publishing, no model calls, nothing spent.
set -uo pipefail
BASE="${BASE:-http://localhost:5678/webhook}"
SEC="${N8N_WEBHOOK_SECRET:?set N8N_WEBHOOK_SECRET first}"
WS=00000000-0000-0000-0000-000000000001
post() { curl -sS -X POST "$BASE/$1" -H 'Content-Type: application/json' \
           -H "x-webhook-secret: $SEC" -d "$2"; echo; }

echo "── 1. resolve handles for all 6 named Arak competitors ──"
post arak-research-resolve "$(cat <<'JSON'
{"workspace_id":"00000000-0000-0000-0000-000000000001","competitors":[
{"name":"Technolight","positioning":"KSA's leading lighting supplier (35+ yrs) with Riyadh & Jeddah showrooms — architectural fixtures, contract furniture and lighting-control systems.","website":"https://technolight-ksa.com/","source_row_id":"30ee1978-9576-4472-9555-28b39ecc23ef"},
{"name":"Alnasser Lighting","positioning":"Riyadh-HQ professional lighting since 1976 — decorative, retail, tunnel and architectural lighting across KSA.","website":"","source_row_id":"e66844f3-ee1a-4f10-ab22-9f5b7ecaa3f1"},
{"name":"Arclight","positioning":"Riyadh-based specialist in technical, emergency, fibre-optic and architectural lighting with lighting control.","website":"","source_row_id":"360f9f52-a0e0-4155-a552-0da05b9b620a"},
{"name":"Rayon Progressive Lighting (Al-Babtain)","positioning":"Riyadh outdoor-lighting leader since 1955, part of Al-Babtain Power & Telecom — street, LED and decorative lighting at scale.","website":"","source_row_id":"1058c366-8d2b-4783-9b51-5e95340f1556"},
{"name":"Huda Lighting","positioning":"KSA provider known for architectural and hospitality lighting solutions.","website":"","source_row_id":"e4489791-5997-4bae-9fe2-34b52d785d1a"},
{"name":"Alfanar Lighting","positioning":"Major Saudi electrical & LED lighting manufacturer serving residential, commercial and industrial segments nationwide.","website":"https://www.alfanar.com/lighting","source_row_id":"a7a26274-eada-4b0f-bfaf-0e78eab7c1ca"}]}
JSON
)"

echo "── 2. first run — expect baseline:true, movements:0 ──"
post arak-research-run "{\"workspace_id\":\"$WS\"}"

echo "── 3. second run — expect baseline:false, quiet_week:true, movements:0 ──"
echo "   (proves the delta path computes AND correctly reports nothing moved)"
post arak-research-run "{\"workspace_id\":\"$WS\"}"
