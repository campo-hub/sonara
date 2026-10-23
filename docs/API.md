# AgriStore API reference

All routes are mounted under `/api`. Firebase bearer tokens are required for account, seller, buyer order, review, report, and admin operations unless marked public. Error responses use `{ "error": { "code": "...", "message": "..." } }`.

## Public routes

| Method and path | Purpose |
|---|---|
| `GET /health` | API status, uptime, database reachability, and version |
| `GET /categories` | Supported product categories |
| `GET /products` | Search/filter/sort active available products; cursor-based pagination |
| `GET /products/:id` | Active product detail |
| `GET /sellers/:uid` | Public seller profile and active available listings |
| `GET /payments/pesapal/ipn` | Provider callback; API verifies the transaction with PesaPal |

Browse filters include `q`, `category`, `county`, `minPrice`, `maxPrice`, `sort`, `lat`, `lng`, `radiusKm`, `cursor`, and `limit`. Supported sorts are `newest`, `price_asc`, `price_desc`, `nearest`, and `top_rated`. Public browse responses expose thumbnails, not storage keys/full image metadata.

## Account and marketplace routes

| Method and path | Purpose |
|---|---|
| `GET /auth/me` | Authenticated token claims |
| `GET /me/profile`, `PUT /me/profile` | Read/update account profile |
| `PUT /me/seller-profile` | Complete seller onboarding |
| `GET /me/products`, `POST /products`, `PATCH /products/:id` | Seller listings and image management |
| `POST /products/:id/pause`, `POST /products/:id/resume`, `DELETE /products/:id` | Seller/admin listing lifecycle |
| `POST /products/:id/reports` | Authenticated report of an active listing; one report per user/listing |
| `POST /orders`, `GET /orders`, `GET /orders/:id` | Buyer checkout and order history |
| `GET /seller/orders` | Seller's incoming orders |
| `POST /orders/:id/cancel`, `/confirm`, `/dispatch`, `/deliver`, `/complete` | Order lifecycle transitions |
| `POST /orders/:id/payment`, `GET /orders/:id/payment` | Buyer-scoped hosted checkout and payment status |
| `POST /products/:id/reviews` | Eligible review for a completed order |

## Admin routes

All require an admin role backed by the verified-email allowlist.

| Method and path | Purpose |
|---|---|
| `GET /admin/listings` | Filter listings by status |
| `POST /admin/listings/:id/approve`, `/reject` | Review pending listings |
| `GET /admin/reports` | List open listing reports |
| `POST /admin/reports/:id/takedown` | Remove the reported active listing and audit the action |
| `POST /admin/sellers/:uid/suspend`, `/verify` | Seller administration |
| `GET /admin/orders`, `/admin/payments` | Filter order/payment records |
| `GET /admin/orders.csv` | Export a bounded order list |
| `POST /admin/orders/:id/resolve-dispute` | Record dispute resolution |

This API summary is based on the implemented route surface; the deployed API may differ until a release is configured and verified.
