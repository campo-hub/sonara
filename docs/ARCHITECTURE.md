# AgriStore architecture

## Runtime components

- **Web:** React/Vite static app on GitHub Pages. Firebase client SDK supports email/password and Google sign-in; optional phone sign-in is feature-flagged.
- **API:** Express service on Render. It verifies Firebase ID tokens, applies CORS/security/rate limits, validates requests, and owns business rules.
- **Database:** MongoDB stores users, products, categories, orders, payments, reviews, listing/message reports, conversations, messages, notifications, and admin audit records.
- **Image storage:** Cloudflare R2 stores transformed product images and thumbnails; image keys and public URLs are stored on product records.
- **Payments:** PesaPal hosted checkout is initiated and verified by the API. The browser return is informational; the verified provider notification determines paid status.
- **Communication:** Buyer and listing seller conversations are stored in MongoDB. The Web client polls the API every five seconds; this avoids persistent connections at the cost of delayed updates and additional requests.
- **Notifications:** Order, payment, and listing lifecycle events create an in-app notification record. Email can be delivered through a configured adapter webhook; SMS can use the Africa's Talking REST adapter. Both are disabled until credentials are configured.

## Request boundaries

```text
Browser -- Firebase ID token --> API
Browser -- public browse ------> API -- MongoDB
Seller -- image upload --------> API -- Sharp --> R2
Buyer -- checkout --------------> API -- reserve stock/order --> MongoDB
Buyer -- hosted payment -------> PesaPal
PesaPal -- IPN callback -------> API -- provider status query --> MongoDB
Browser -- message polling ----> API -- participant check -----> MongoDB
API -- lifecycle event --------> notification feed ------------> Browser
```

The client never supplies authoritative prices, payment status, seller identity, role assignments, or product ownership. The API reads current product prices and stock, snapshots order items, and changes payment state only after querying the provider.

## Data and operational boundaries

- Anonymous product browse returns active, available listings and thumbnail metadata only.
- Signed-in users receive private cache headers for personalized endpoints.
- Admin writes require an allowlisted, verified Firebase email and are recorded in `auditLog`.
- A listing report is authenticated, limited by the API, unique per reporter/listing, and visible only to admins. Admin takedowns change the listing to `removed` and create an audit record.
- A conversation is keyed by its participants and product. Every read/write verifies membership; an admin can read messages only through an open participant-submitted conversation report.
- Categories are managed through admin CRUD. Product records store a category identifier; category deletion is blocked while listings reference it.
- Price comparison uses exact normalized listing-name and category matches, optionally narrows to a county, and sorts by integer KES unit price.
- Stock reservations expire after 15 minutes and are cleaned up by the API process.
- The notification feed is MongoDB-backed. Optional external adapters are code-only until provider credentials and delivery destinations are configured and tested.

## Marketplace limitations

AgriStore has a 0% launch commission decision and does not collect delivery fees. Buyer and seller agree delivery details directly. PesaPal collects buyer payments to the configured merchant account; Daraja, automated seller payouts, split settlement, escrow, and refunds are not implemented. Paid cancellations and late payments may require manual review.

See [`API.md`](./API.md), [`PAYMENTS-AND-PAYOUTS.md`](./PAYMENTS-AND-PAYOUTS.md), and [`GO-LIVE.md`](./GO-LIVE.md).
