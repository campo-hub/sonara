# Sonara Backend

This backend is the API layer for the Sonara music platform. It follows the architecture you chose:

- Render handles app logic
- MongoDB stores metadata
- Cloudflare R2 stores audio files
- The frontend calls the API for catalog, playlists, and profile data

## Current state

This is a working starter API with endpoints:

- GET /api/health
- GET /api/catalog
- GET /api/catalog/:id
- GET /api/featured

## Run locally

```bash
npm install
npm run dev
```

Then open:

- http://localhost:4000/api/health
- http://localhost:4000/api/catalog
