# AgriStore Backend

The Express API is being rebuilt as the backend foundation for AgriStore, an agricultural marketplace for Kenya. Phase 1 provides the health endpoint, Firebase token authentication, user profile storage, role checks, and shared security/database infrastructure. Product, order, and payment APIs are added in later phases.

## Architecture

```text
HTTP client
  -> Express app (Helmet, CORS allowlist, rate limits, 100 kB JSON limit)
  -> auth / role middleware
  -> health and user modules
  -> shared MongoDB helper + indexes
  -> Firebase Admin token verification
```

`src/server.js` performs startup checks, creates MongoDB indexes, and listens. `src/app.js` builds the Express app without opening a network port, so middleware and routes can be tested independently.

## Environment variables

Copy `.env.example` to `.env` for local setup and provide values locally; never commit `.env` or share credentials in chat.

| Name | Purpose |
|---|---|
| `NODE_ENV` | Runtime mode; production requires MongoDB |
| `PORT` | HTTP listen port (defaults to 4000) |
| `CORS_ORIGIN` | Comma-separated exact browser origins allowed to call the API |
| `MONGODB_URI` | MongoDB connection string |
| `MONGODB_DB_NAME` | Database name (defaults to `agristore`) |
| `ADMIN_EMAILS` | Comma-separated admin emails; Firebase email verification is required |
| `FIREBASE_PROJECT_ID` | Firebase project used for Admin token verification |
| `FIREBASE_CLIENT_EMAIL` | Firebase service-account client email |
| `FIREBASE_PRIVATE_KEY` | Firebase service-account private key |
| `R2_ACCOUNT_ID` | Cloudflare account for R2 |
| `R2_ACCESS_KEY_ID` | R2 access key identifier |
| `R2_SECRET_ACCESS_KEY` | R2 secret access key |
| `R2_BUCKET_NAME` | R2 bucket name |
| `R2_PUBLIC_BASE_URL` | Public base URL used when forming object URLs |

Firebase and R2 credentials are backend-only. Do not use `VITE_*` names for them.

## Run locally

```bash
npm ci
npm run dev
```

The API listens on `http://localhost:4000` by default. `http://localhost:5173` is allowed as a CORS origin outside production; other browser origins must be listed in `CORS_ORIGIN`.

## Routes currently available

- `GET /api/health` — returns service status, uptime, MongoDB reachability, and version.
- `GET /api/auth/me` — returns the authenticated Firebase user's verified token claims.
- `GET /api/me/profile` — returns the signed-in user's profile.
- `PUT /api/me/profile` — creates or updates the signed-in user's username.

The legacy music endpoints, catalog synchronization, uploads, playlists, recommendations, and admin-claim flow have been removed.

## Tests

```bash
npm test
```

Tests cover authentication and role checks, production runtime validation, rate limiting, safe error responses, CORS rejection, JSON size limits, and health/auth routing. Tests mock Firebase token verification and make no network calls to external services.

## Deployment

Configure the environment variables in the hosting provider, set `NODE_ENV=production`, and provide `MONGODB_URI`. The service fails startup if production MongoDB configuration is missing or database initialization fails. Configure `CORS_ORIGIN` with exact frontend origins. Keep all credentials in the provider's secret store.
