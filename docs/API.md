# AgriStore API reference

All routes are mounted under `/api`. Firebase bearer tokens are required for account, seller, buyer order, review, report, and admin operations unless marked public. Error responses use `{ "error": { "code": "...", "message": "..." } }`.

## Public routes

| Method and path | Purpose |
|---|---|
| `GET /health` | API status, uptime, database reachability, and version |
| `GET /categories` | Managed product categories as `{ id, name }` values |
| `GET /products` | Search/filter/sort active available products; cursor-based pagination |
| `GET /products/:id` | Active product detail |
| `GET /products/:id/price-comparison?county=...` | Similar active listings, sorted by whole-KES price per unit |
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
| `POST /conversations` | Start or resume a conversation about an active listing and send the first message |
| `GET /conversations` | List the signed-in user's conversations |
| `GET /conversations/:id/messages?before=...&limit=...` | Fetch participant-only messages with cursor pagination |
| `POST /conversations/:id/messages` | Send a participant-only message (maximum 2,000 characters) |
| `POST /conversations/:id/read` | Mark the signed-in participant's conversation read |
| `POST /conversations/:id/reports` | Submit a bounded report for admin review |
| `GET /notifications?limit=...` | List the signed-in user's feed and unread count |
| `POST /notifications/:id/read`, `POST /notifications/read-all` | Mark one or all notifications read |

## Admin routes

All require an admin role backed by the verified-email allowlist.

| Method and path | Purpose |
|---|---|
| `GET /admin/users` | List bounded user summaries for administration |
| `GET /admin/listings` | Filter listings by status |
| `POST /admin/listings/:id/approve`, `/reject` | Review pending listings |
| `GET /admin/categories`, `POST /admin/categories`, `PATCH /admin/categories/:id`, `DELETE /admin/categories/:id` | Manage categories; deletion is blocked while listings use the category |
| `GET /admin/reports` | List open listing reports |
| `POST /admin/reports/:id/takedown` | Remove the reported active listing and audit the action |
| `GET /admin/message-reports`, `GET /admin/message-reports/:id/messages` | Review conversations reported by participants |
| `POST /admin/sellers/:uid/suspend`, `/verify` | Seller administration |
| `GET /admin/orders`, `/admin/payments` | Filter order/payment records |
| `GET /admin/orders.csv` | Export a bounded order list |
| `GET /admin/reports/summary`, `GET /admin/reports/summary.csv` | Summary counts, whole-KES GMV, and CSV export |
| `POST /admin/orders/:id/resolve-dispute` | Record dispute resolution |

Conversation access is limited to the buyer and listing seller; only verified allowlisted admins can read a conversation through its open message-report record. New messages are polled by the Web client every five seconds; there is no WebSocket/SSE connection.

Notifications are persisted to the in-app feed first. Optional email webhook and Africa's Talking SMS adapters are disabled until configured. SMS delivery also requires a recipient phone number on the profile or notification event. No external delivery has been verified.

Summary reports read MongoDB directly and return `503 REPORTS_UNAVAILABLE` when the database is not configured. Payout summaries are backed by the `payouts` collection and remain empty until payout processing is implemented.
