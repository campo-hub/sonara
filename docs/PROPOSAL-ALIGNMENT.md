# Proposal alignment

## Source and status convention

The referenced degree-project proposal PDF was not present in the repository or workspace when this document was prepared. The matrix below maps the module names and functional scope quoted in the implementation request. Appendix II, III, and IV identifiers and exact wording cannot be verified without the PDF; “requirement” summaries are paraphrases from the supplied brief, not quotations.

- **DONE (run and observed):** the behavior was exercised by local tests or build checks listed in the verification column.
- **CODE-ONLY:** code is present, but a required external service, production database, or end-to-end/live verification was not performed.
- **BLOCKED:** the requested behavior is not implemented or cannot be verified because a prerequisite is missing.

## Proposal module and requirement map

| Proposal module | Appendix II — functional requirement (brief-derived) | Appendix III — non-functional requirement (brief-derived) | Appendix IV — user story (brief-derived) | Implementation mapping | Status / verification |
|---|---|---|---|---|---|
| User Management | Separate buyer, farmer/seller, and administrator roles; manage user summaries and seller status. | Verify Firebase bearer tokens; keep privileged actions admin-only; do not allow clients to assign roles. | As a buyer, farmer, or administrator, I want role-appropriate pages and controls. | `GET /api/me/profile`, `GET /api/admin/users`, seller suspension/verification; Web header and account role display; role and admin tests. | CODE-ONLY for deployed role workflows; local authorization tests pass. No Firebase/MongoDB service was configured. |
| Product Management | Farmers create/update/pause listings; admins review, approve, reject, or remove listings. | Validate input and image content; enforce ownership; preserve listing/category relationships. | As a farmer, I want to manage listings; as an administrator, I want to moderate them. | `/api/products`, `/api/me/products`, `/api/admin/listings`; seller and admin pages; `product-routes.test.js`, `phase7.test.js`. | DONE (run and observed) for local API tests and Web production build. R2/MongoDB production behavior remains CODE-ONLY. |
| Search/Browse | Search active listings with category, county/location, whole-KES price range, and sorting filters. | Exclude inactive/unavailable stock, use bounded cursor pages, and expose thumbnails only. | As a buyer, I want to find available produce by name, location, and budget. | `GET /api/products`; Browse, FilterBar, ProductCard; `product-browse.test.js`; `Web/tests/marketplace-features.test.js`. | DONE (run and observed) in local tests. Live MongoDB text/geospatial search remains CODE-ONLY. |
| Price Comparison | Compare same-category, normalized-name listings by unit price; optionally narrow by county; show seller/location/rating; cheapest first. | Use integer KES, exclude unavailable/self listings, bound results, and keep public output minimal. | As a buyer, I want to compare similar produce and choose a suitable seller. | `GET /api/products/:id/price-comparison`; product comparison panel and `/compare/:id`; `marketplace-features.test.js` and Web helper tests. | DONE (run and observed) for local endpoint/store tests and Web build. MongoDB matching against a live catalog remains CODE-ONLY. |
| Communication | Start a listing conversation, list conversations, read cursor-paged messages, send, mark read, and report a conversation. | Participant-only reads/writes; admin read only through an open report; per-user rate limit; 2,000-character limit; plain-text handling. | As a buyer, I want to contact a farmer about a listing; as a farmer, I want to reply. | `/api/conversations*`, `/api/admin/message-reports*`; inbox, thread, report form, and Contact farmer links; `marketplace-features.test.js`; Web polling-note and helper tests. | DONE (run and observed) for local authorization/validation tests and Web build. MongoDB persistence and real multi-user sessions remain CODE-ONLY. |
| Notification | Store in-app events, unread count, mark one/all read; send lifecycle events; offer opt-in external adapters. | Scope feed data to owner; deduplicate lifecycle events; keep external credentials backend-only and disabled unless configured. | As a marketplace user, I want to see important order, payment, and listing updates. | `/api/notifications*`; Header unread badge and notification feed; `notify()` integration for order/payment/listing events; Africa's Talking and email adapter configuration. | In-app API behavior DONE (run and observed) by local tests. External adapter delivery CODE-ONLY; payout events BLOCKED pending Phase 2 payout implementation. |
| Administration/Reporting | Manage users, categories, listings and reports; view users, listings by category/county, orders, GMV, and payout summary; export CSV. | Verified admin allowlist, audit write actions, bounded exports, and whole-KES totals. | As an administrator, I want to oversee marketplace activity and export summary data. | `/api/admin/users`, `/api/admin/categories*`, `/api/admin/reports*`, `/api/admin/orders*`, `/api/admin/reports/summary*`; admin dashboard; category, report, and admin tests. | CODE-ONLY for MongoDB aggregation/audit persistence and complete user management. Injected route tests pass; live report data is not available. |
| Categories | Seed vegetables, fruits, cereals, and livestock product categories; provide admin CRUD. | Validate IDs/names and prevent deleting a category used by listings. | As an administrator, I want to maintain categories so farmers and buyers can use current product types. | `GET /api/categories`, `/api/admin/categories*`; category selector and admin management view; category route tests. | CODE-ONLY pending live MongoDB/index verification; default category shape is covered by browse API tests. |

## Cross-cutting requirements

| Requirement | Implementation | Status / verification |
|---|---|---|
| Low-digital-literacy UI; large controls and simple steps | Existing button/input minimum heights remain at least 46px; checkout remains a short flow; English/Kiswahili selector is available and added marketplace labels are translated. | CODE-ONLY for field usability testing; responsive production build succeeds. No user study was performed. |
| Search by category, location, and price | Browse supports category, county, min/max whole-KES prices, and optional nearest-by-coordinate ordering. | DONE (run and observed) in existing browse tests. |
| Polling trade-off documented | Messaging thread polls every five seconds; inbox explains that polling replaces a persistent connection. | DONE (run and observed) in source/build; no live multi-user latency test. |
| Payout notifications and payout reporting | Notification templates can represent payout lifecycle events; report query reads `payouts`. There is no payout service or payout collection writer yet. | BLOCKED pending Phase 2 implementation. |
| Live-service verification | No Firebase, MongoDB Atlas, Cloudflare R2, email/SMS, or production endpoints were accessed for this phase. | BLOCKED by unavailable configured services; no production readiness claim is made. |

## Deliberate differences from the brief

- Cloudflare R2 is used for images instead of Cloudinary.
- PesaPal is already implemented, and Daraja is planned alongside it in Phase 2; no provider will replace the existing PesaPal flow.
- Product reviews were added even though they are not in the supplied module list.
- Conversation updates use short-interval polling instead of WebSockets/SSE to reduce infrastructure and connection complexity.
- External email/SMS and payout workflows are not represented as live until their provider configuration and implementation are verified.
