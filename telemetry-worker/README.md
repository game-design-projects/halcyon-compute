# halcyon-telemetry (Cloudflare Worker + D1)

Receives the game's anonymous gameplay telemetry (`js/telemetry.js`). Deploy:
```bash
cd telemetry-worker
npx wrangler login
npx wrangler d1 create halcyon-telemetry            # paste the database_id into wrangler.toml
npx wrangler d1 execute halcyon-telemetry --remote --file=schema.sql
npx wrangler secret put ADMIN_TOKEN                   # any long random string; used to read logs back
npx wrangler deploy                                   # prints https://halcyon-telemetry.<you>.workers.dev
```
Point the game at it: set `window.HALCYON_TELEMETRY_URL = "https://…/v1/batch"` in `js/build.js` (for CI, in
`scripts/build-web.sh` via the `TELEMETRY_URL` env var), or test with `?telemetry=https://…/v1/batch`.

Read logs back and replay one:
```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://…/v1/sessions
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://…/v1/session/<id> > play.json
node tools/replay.js play.json --bots
```
Players can turn sharing off in the main menu ("Share anonymous gameplay data"). Only gameplay events are sent:
random player/session ids, no names, no IP stored by the Worker.
