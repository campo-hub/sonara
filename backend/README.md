# AgriStore Backend

The Express API provides the backend for AgriStore, an agricultural marketplace for Kenya. It includes Firebase authentication, marketplace product and order APIs, and hosted checkout through PesaPal.

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
| `MODERATE_LISTINGS` | Set to `true` to create new product listings as pending |
| `FIREBASE_PROJECT_ID` | Firebase project used for Admin token verification |
| `FIREBASE_CLIENT_EMAIL` | Firebase service-account client email |
| `FIREBASE_PRIVATE_KEY` | Firebase service-account private key |
| `R2_ACCOUNT_ID` | Cloudflare account for R2 |
| `R2_ACCESS_KEY_ID` | R2 access key identifier |
| `R2_SECRET_ACCESS_KEY` | R2 secret access key |
| `R2_BUCKET_NAME` | R2 bucket name |
| `R2_PUBLIC_BASE_URL` | Public base URL used when forming object URLs |
| `PESAPAL_ENVIRONMENT` | Provider API environment: `sandbox` by default, `live` for production |
| `PESAPAL_CONSUMER_KEY` | PesaPal API consumer key |
| `PESAPAL_CONSUMER_SECRET` | PesaPal API consumer secret |
| `PESAPAL_CALLBACK_URL` | HTTPS frontend URL where PesaPal returns the buyer |
| `PESAPAL_IPN_URL` | Public HTTPS backend URL ending in `/api/payments/pesapal/ipn` |
| `PESAPAL_IPN_ID` | PesaPal notification ID registered for `PESAPAL_IPN_URL` |

Firebase and R2 credentials are backend-only. Do not use `VITE_*` names for them.
Payment secrets are backend-only as well. Leave payment variables blank to keep online payments disabled. Register the notification URL once with `node scripts/register-pesapal-ipn.js`, then copy the printed `PESAPAL_IPN_ID` into the backend secret environment. Production requires the live provider environment and HTTPS callback/IPN URLs.

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
- `PUT /api/me/seller-profile` — completes seller onboarding and grants the seller role.
- `GET /api/categories` — returns supported marketplace product categories.
- `GET /api/products` — public searchable product browse with category, county, KES price, location/radius, sort, and cursor pagination filters; returns thumbnails only.
- `GET /api/sellers/:uid` — public seller profile and active, available listings; private account fields are not returned.
- `POST /api/products/:id/reports` — authenticated, rate-limited listing report; one report per account/listing.
- `POST /api/orders` — authenticated checkout; server-priced cart quantities are reserved for 15 minutes and split into separate orders per seller.
- `GET /api/orders` and `GET /api/orders/:id` — private buyer order history/details, with seller access limited to their own orders.
- `GET /api/seller/orders` — authenticated seller order list.
- `POST /api/orders/:id/cancel` — buyer cancellation before seller confirmation; releases reserved stock and flags paid cancellations for manual refund review.
- `POST /api/orders/:id/confirm`, `/dispatch`, and `/deliver` — seller-owned order lifecycle actions; confirmation requires payment.
- `POST /api/orders/:id/complete` — buyer confirms delivery and commits reserved stock.
- `POST /api/orders/:id/payment` — buyer starts or resumes PesaPal hosted checkout for their pending order.
- `GET /api/orders/:id/payment` — buyer reads their latest payment status.
- `GET /api/payments/pesapal/ipn` — public provider notification endpoint; the API queries PesaPal before applying payment status.
- `POST /api/products` — seller-only multipart listing creation with up to five processed images.
- `GET /api/products/:id` — public active product detail; non-active listings are private to owner/admin.
- `PATCH /api/products/:id` — owner/admin listing edits and image removal/reordering/addition.
- `POST /api/products/:id/pause` and `/resume` — owner/admin listing visibility controls.
- `DELETE /api/products/:id` — owner/admin soft-removes products referenced by orders; otherwise removes listing and image objects.
- `GET /api/me/products` — seller's products in all statuses.
- `GET /api/admin/reports` — admin-only open listing reports.
- `POST /api/admin/reports/:id/takedown` — admin-only listing removal with a required reason and audit event.
- `GET /api/admin/listings` and `POST /api/admin/listings/:id/approve` or `/reject` — listing moderation.
- `POST /api/admin/sellers/:uid/suspend` or `/verify` — seller administration.
- `GET /api/admin/orders`, `/api/admin/payments`, and `/api/admin/orders.csv` — bounded admin views/export.
- `POST /api/admin/orders/:id/resolve-dispute` — record an admin dispute resolution.

The legacy music endpoints, catalog synchronization, uploads, playlists, recommendations, and admin-claim flow have been removed.

## Tests

```bash
npm test
```

Tests cover authentication and role checks, production runtime validation, rate limiting, safe error responses, CORS rejection, JSON size limits, health/auth routing, seller product management, browse filters and pagination, seller profile privacy, thumbnail-only public responses, listing reports and takedowns, checkout snapshots and seller splits, stock reservation/rollback/expiry, order access/state transitions, PesaPal hosted checkout and notification verification. Tests mock Firebase token verification, payment provider, and external storage/database access.

## Deployment

Configure the environment variables in the hosting provider, set `NODE_ENV=production`, and provide `MONGODB_URI`. The service fails startup if production MongoDB configuration is missing or database initialization fails. Configure `CORS_ORIGIN` with exact frontend origins. Keep all credentials in the provider's secret store. See the [PesaPal API 3.0 reference](https://developer.pesapal.com/how-to-integrate/e-commerce/api-30-json/api-reference) for provider setup details.
