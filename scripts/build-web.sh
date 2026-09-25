#!/usr/bin/env bash
# Assemble the playable web bundle (only what index.html loads) into dist/ for itch.io.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-dist}"
rm -rf "$OUT" && mkdir -p "$OUT/bots"
cp index.html "$OUT/"
cp -R css js "$OUT/"
cp bots/bots.js "$OUT/bots/"
# stamp the build id (tag or short SHA) and the optional telemetry endpoint into the bundle
BUILD_ID="${GITHUB_REF_NAME:-$(git rev-parse --short HEAD 2>/dev/null || echo dev)}"
printf 'window.HALCYON_BUILD = "%s";\nwindow.HALCYON_TELEMETRY_URL = "%s";\n' "$BUILD_ID" "${TELEMETRY_URL:-}" > "$OUT/js/build.js"
# every local src/href in index.html must exist in the bundle
missing=0
for ref in $(grep -oE '(src|href)="[^"#]+"' index.html | sed -E 's/^(src|href)="//; s/"$//' | grep -vE '^(https?:|data:|mailto:)'); do
  [ -e "$OUT/$ref" ] || { echo "missing in bundle: $ref" >&2; missing=1; }
done
[ "$missing" -eq 0 ]
echo "[build-web] $(find "$OUT" -type f | wc -l | tr -d ' ') files, $(du -sh "$OUT" | cut -f1) -> $OUT"
