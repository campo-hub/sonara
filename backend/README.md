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

## Run locally

```bash
npm install
npm run dev
```

Then open:

- http://localhost:4000/api/health
- http://localhost:4000/api/catalog
