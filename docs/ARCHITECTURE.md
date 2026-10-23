# AgriStore architecture

## Runtime components

- **Web:** React/Vite static app on GitHub Pages. Firebase client SDK supports email/password and Google sign-in; optional phone sign-in is feature-flagged.
- **API:** Express service on Render. It verifies Firebase ID tokens, applies CORS/security/rate limits, validates requests, and owns business rules.
- **Database:** MongoDB stores users, products, orders, payments, reviews, reports, and admin audit records.
- **Image storage:** Cloudflare R2 stores transformed product images and thumbnails; image keys and public URLs are stored on product records.
- **Payments:** PesaPal hosted checkout is initiated and verified by the API. The browser return is informational; the verified provider notification determines paid status.

## Request boundaries

```text
Browser -- Firebase ID token --> API
Browser -- public browse ------> API -- MongoDB
Seller -- image upload --------> API -- Sharp --> R2
Buyer -- checkout --------------> API -- reserve stock/order --> MongoDB
Buyer -- hosted payment -------> PesaPal
PesaPal -- IPN callback -------> API -- provider status query --> MongoDB
```

The client never supplies authoritative prices, payment status, seller identity, role assignments, or product ownership. The API reads current product prices and stock, snapshots order items, and changes payment state only after querying the provider.

## Data and operational boundaries

- Anonymous product browse returns active, available listings and thumbnail metadata only.
- Signed-in users receive private cache headers for personalized endpoints.
- Admin writes require an allowlisted, verified Firebase email and are recorded in `auditLog`.
- A listing report is authenticated, limited by the API, unique per reporter/listing, and visible only to admins. Admin takedowns change the listing to `removed` and create an audit record.
- Stock reservations expire after 15 minutes and are cleaned up by the API process.
- Notification delivery currently logs structured events to the API console; no external notification provider is configured.

## Marketplace limitations

AgriStore has a 0% launch commission decision and does not collect delivery fees. Buyer and seller agree delivery details directly. PesaPal collects buyer payments to the configured merchant account; automated seller payouts, split settlement, escrow, and refunds are not implemented. Paid cancellations and late payments may require manual review.

See [`API.md`](./API.md), [`PAYMENTS-AND-PAYOUTS.md`](./PAYMENTS-AND-PAYOUTS.md), and [`GO-LIVE.md`](./GO-LIVE.md).
