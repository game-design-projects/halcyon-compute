#!/usr/bin/env bash
# Read gameplay telemetry back from the Cloudflare Worker and replay a session.
#   tools/telemetry.sh list                 # recent sessions
#   tools/telemetry.sh get <session> [out]  # merged log JSON (default: telemetry/<session>.json)
#   tools/telemetry.sh replay <session>     # get + node tools/replay.js --bots
# Admin token: $HALCYON_TELEMETRY_TOKEN or the file ~/.config/halcyon/telemetry-admin-token (never printed).
set -euo pipefail
cd "$(dirname "$0")/.."
BASE="${HALCYON_TELEMETRY_BASE:-https://halcyon-telemetry.lishuyustevenli.workers.dev}"
TOKEN_FILE="${HOME}/.config/halcyon/telemetry-admin-token"
auth() { if [ -n "${HALCYON_TELEMETRY_TOKEN:-}" ]; then printf 'Authorization: Bearer %s' "$HALCYON_TELEMETRY_TOKEN"; else printf 'Authorization: Bearer %s' "$(cat "$TOKEN_FILE")"; fi; }
case "${1:-list}" in
  list) curl -fsS -H "$(auth)" "$BASE/v1/sessions" | python3 -c 'import json,sys
for s in json.load(sys.stdin): print(s["last"], s["session"], "seed", s["seed"], s["build"], "batches", s["batches"])' ;;
  get) out="${3:-telemetry/$2.json}"; mkdir -p "$(dirname "$out")"; curl -fsS -H "$(auth)" "$BASE/v1/session/$2" > "$out"; echo "$out" ;;
  replay) out=$("$0" get "$2"); node tools/replay.js "$out" --bots ;;
  *) echo "usage: $0 list | get <session> [out] | replay <session>" >&2; exit 2 ;;
esac
