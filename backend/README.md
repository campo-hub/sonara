# Sonara Backend

This backend is the API layer for the Sonara music platform. It follows the architecture you chose:

- Render handles app logic
- MongoDB stores metadata
- Cloudflare R2 stores audio files
- The frontend calls the API for catalog, playlists, and profile data

## Current state

This is the API layer for the Sonara catalog, playback support, and daily recommendations.

Core endpoints include:

- GET /api/health
- GET /api/catalog
- GET /api/catalog/:id
- GET /api/featured
- GET /api/recommendations/daily?tz=<IANA timezone>&deviceId=<UUID>
- GET /api/me/mixes (sign-in required)
- POST /api/me/mixes with `{ dailyMixId, dateKey }` (sign-in required)
- PATCH /api/me/mixes/:id (sign-in required)
- DELETE /api/me/mixes/:id (sign-in required)

Daily recommendation snapshots are stored in `dailyMixes` and the rolling coverage state is stored in `mixHistory`. Saved copies live in `savedMixes`; they are independent of the daily snapshot and are scoped by `ownerUid`. The server accepts only catalog-derived track IDs when saving a mix and returns `404` for another user's saved-mix IDs.

The daily generator uses every playable catalog track, produces up to ten non-overlapping mixes, and degrades to fewer mixes when the catalog has fewer than 100 playable songs. With no MongoDB connection, these collections use an in-memory fallback for local development and do not survive a restart.

## Performance and scheduling

`GET /api/catalog` serves a 30-second in-memory snapshot with `ETag`, `Cache-Control`, and compression. R2 bucket reconciliation runs in the background and never blocks that response. Daily recommendations use the same cached playable catalog where possible; the server precomputes upcoming local-day snapshots hourly while awake.

The external scheduler calls `POST /api/internal/jobs/daily-mixes` with the `x-cron-secret` header. Configure `CRON_SECRET` in Render and `SONARA_API_URL` plus `CRON_SECRET` as GitHub Actions secrets. The included workflow also pings `/api/health` every ten minutes. UptimeRobot or cron-job.org can call `/api/health` and the internal job endpoint if GitHub Actions is not suitable.

Render's free tier can still sleep for 30-60 seconds. The only reliable way to remove that cold start is an always-on Render plan; a scheduled pinger only reduces how often it occurs. For audio delivery, attach a custom Cloudflare domain in front of R2 and enable caching rather than relying on an `r2.dev` public URL.

Run the local performance table with:

```bash
SONARA_API_URL=https://your-api.example/api SONARA_AUDIO_URL=https://your-audio.example/song.m4a node scripts/perf-check.mjs
```

| Path | Before | After | Measurement status |
| --- | --- | --- | --- |
| Catalog timeout | 30 s plus retries | 8 s background refresh | Client setting verified; live TTFB requires a running deployment |
| Catalog request path | Awaited full R2 sync | In-memory snapshot, background sync | Code path verified; live timing requires a running deployment |
| Catalog transfer | No compression or conditional cache | Compression, ETag, 30 s cache, stale-while-revalidate | Headers covered by server code; live response requires a running deployment |
| Daily mixes | Generated during the request | Hourly precompute plus fast lazy fallback | Scheduler code verified; live timing requires Mongo and a running deployment |
| Home first paint | Waited for network-backed state | Cached catalog/mixes/history render immediately | Browser timing requires Playwright Chromium and a populated cache |
| Playback start | Metadata preload and repeated source loads | Auto preload, unchanged-source guard, next-track prefetch | Audio timing requires three real playable URLs |

The audio range row should return `206`, include `Accept-Ranges: bytes`, a correct audio `Content-Type`, cache headers, and the required CORS headers. Existing M4A/MP4 files should be checked for `moov` placement; optimize affected copies with `ffmpeg -i in.m4a -c copy -movflags +faststart out.m4a` without re-encoding them in the app.

The responsive browser command is `npm run qa:layout` from `Web/`. It checks 1440, 1100, 800, and 390 pixel viewports in both themes and writes screenshots to `docs/qa/`; it requires the Playwright Chromium browser to be installed.

## Run locally

```bash
npm install
npm run dev
```

Then open:

- http://localhost:4000/api/health
- http://localhost:4000/api/catalog
