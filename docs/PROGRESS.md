# AgriStore Restoration Progress

Legend: **DONE** means run and observed; **CODE-ONLY** means present but not yet verified; **BLOCKED** means the verification could not be run because a required tool or service was unavailable.

## Phase 0 — Safety and baseline

| Item | Status | Verification |
|---|---|---|
| Site name set to AgriStore | DONE | Confirmed with the user |
| `sonara-music-final` tag and `agri-marketplace` branch | DONE | `git tag --list sonara-music-final`; `git branch --show-current` |
| Backend baseline | DONE | `npm --prefix backend test` — 45 passed, 0 failed |
| Web baseline | DONE | `npm --prefix Web test` — 26 passed, 0 failed |
| Ignore rules for env files and Google service config | DONE | Reviewed `.gitignore`; patterns and `.env.example` exception are present |
| Example env files contain variable names only | DONE | Checked `Web/.env.example` and `backend/.env.example`: assignments are blank |
| Google service config files removed from Git tracking | DONE | `git ls-files` confirms no tracked `.env` or `google-services*.json` files |
| Duplicate Google service config files removed locally | DONE | Confirmed both duplicate paths are absent; primary local file remains |
| Legacy documentation archived | DONE | Improvements plan and old progress moved to `docs/archive/`; abandoned redesign plan was already archived |
| Android marked as frozen legacy music player | DONE | Added `android/FROZEN.md` |

The root package has no `test` script; run the test commands in the backend and Web package directories (or use the `--prefix` commands above).

## Manual security action

The credentials previously present in `backend/.env` must be rotated before deployment:

- Cloudflare dashboard → R2 → Manage R2 API tokens: revoke/rotate the token backing `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`.
- Google Cloud Console → IAM & Admin → Service Accounts → Keys (or Firebase Console → Project settings → Service accounts): revoke the exposed key identified by `FIREBASE_PRIVATE_KEY_ID` and issue a replacement for `FIREBASE_PRIVATE_KEY`.
- MongoDB Atlas → Database Access: change the password for the database user in `MONGODB_URI`, then update the deployment environment.

Never put replacement credentials in chat, source files, or example env files.

## Existing worktree changes

Three pre-existing modifications in `android/app/src/main/java/com/castmobile/sender/ui/` were present before this task. They are user changes and must remain untouched.

## Phase 1 — Backend restructure and hardening

| Item | Status | Verification |
|---|---|---|
| Split app construction from server startup | DONE | `server.js` is 36 lines; live process returned `/api/health` |
| Central config and shared MongoDB helper/index setup | DONE | Startup validation tests pass; indexes created through `ensureIndexes()` |
| Production MongoDB requirement | DONE | Unit test confirms production config without `MONGODB_URI` is rejected |
| Firebase auth, seller/admin role middleware, verified-email admin allowlist | DONE | Auth and role middleware tests pass |
| Security headers, global/strict rate limits, 100 kB JSON limit, safe error handler | DONE | Integration and middleware tests pass |
| Exact CORS allowlist; local Vite origin only outside production | DONE | Integration test rejects the legacy GitHub Pages origin |
| User storage uses shared `users` collection, not Mongo driver internals | DONE | Profile and default-buyer tests pass |
| Remove backend music catalog, upload, recommendation, playlist, library and admin-claim code | DONE | Backend source scan found no music domain identifiers or legacy route symbols |
| Remove unused audio dependencies | DONE | `npm --prefix backend ls --depth=0` lists no `music-metadata`, `multer`, or `node-cron` |
| Health response includes status, uptime, DB state and version | DONE | Live check returned `status=degraded`, `db=down`, `version=2.0.0` without local MongoDB |
| Backend regression/security tests | DONE | `npm --prefix backend test` — 7 passed, 0 failed |
| Web regression tests | DONE | `npm --prefix Web test` — 26 passed, 0 failed |

## Phase 2 — Data model

| Item | Status | Verification |
|---|---|---|
| Explicit marketplace validators for users, products, orders, payments, reviews and audit log entries | DONE | Unit tests cover valid documents and invalid enums, fields, amounts, IDs and totals |
| Required marketplace indexes centralized in `ensureIndexes()` | DONE | Mock DB test checks repeatable index declarations, GeoJSON/text and unique/sparse indexes |
| UUID ID helper (not filename-derived) | DONE | Unit test checks generated UUID shape; product/order/payment/review validators require UUIDs |
| Integer-only KES parsing and formatting | DONE | Tests cover grouped KES strings, exact formatting, decimals, malformed values and unsafe integers |
| Phase 2 backend tests | DONE | `npm --prefix backend test` — 16 passed, 0 failed |

MongoDB was not configured locally; index declarations were verified using a mock database. Fractional quantity × unit price is rounded to the nearest whole KES per line during Phase 5 checkout.

## Phase 3 — Product API and image upload

| Item | Status | Verification |
|---|---|---|
| Seller product creation and seller-owned product listing routes | DONE | HTTP tests cover 401/403, create response and own listing status |
| Product detail visibility and owner/admin editing | DONE | HTTP tests confirm active product visibility and non-active owner-only reads |
| Pause/resume and ownership-protected deletion | DONE | HTTP tests cover status transitions and non-owner edit/delete rejection |
| Soft-delete products referenced by orders; hard-delete otherwise with R2 cleanup | DONE | Mock store/storage tests cover both branches |
| Multipart limits: 5 images, 5 MB each, bounded fields/parts | DONE | HTTP tests cover oversize and six-file rejection |
| JPEG/PNG/WebP magic-byte validation and Sharp WebP processing | DONE | Tests reject SVG bytes with a `.jpg` filename; successful processing asserts WebP output and metadata removal |
| R2 image pairs, thumbnails, immutable cache headers, upload rollback | DONE | Mock storage tests verify public URLs/cache headers and partial-upload cleanup |
| Approximate coordinates rounded to two decimals | DONE | Product create test checks the stored GeoJSON point |
| Upload rate limit keyed by authenticated seller | DONE | Test confirms a seller's second request is limited while another seller has a separate quota |
| Backend tests | DONE | `npm --prefix backend test` — 24 passed, 0 failed |
| Web regression tests | DONE | `npm --prefix Web test` — 26 passed, 0 failed |
| Clean backend dependency install | DONE | `npm --prefix backend ci --no-fund --no-audit` completed |

MongoDB and R2 were not configured locally; persistence and object storage were tested with injected mocks. Live marketplace deployment remains unverified.

## Phase 4 — Browse, search, and seller pages

| Item | Status | Verification |
|---|---|---|
| Public categories and searchable product browse | DONE | HTTP tests cover supported categories, query filters, and active/in-stock visibility |
| County and whole-shilling KES price filters | DONE | Browse tests cover combined filters, invalid categories/prices, and min/max validation |
| Sort by newest, price, nearest, and top rated | DONE | Memory-store tests verify deterministic ordering and radius filtering |
| Cursor pagination | DONE | Tests verify matching-filter enforcement and stable pages after newer listings are inserted |
| Nearest search with optional radius | DONE | Tests cover distance ordering and radius exclusion |
| Thumbnail-only browse and seller listing responses | DONE | HTTP and mapping tests confirm full image URLs/object keys are not exposed |
| Public seller profile and active listings | DONE | HTTP tests verify profile/listing response and private profile-field exclusion |
| Cache behavior for anonymous and authenticated requests | DONE | HTTP tests confirm short public cache and `private, no-store` for signed-in users |
| Backend tests | DONE | `npm --prefix backend test` — 31 passed, 0 failed |
| Web regression tests | DONE | `npm --prefix Web test` — 26 passed, 0 failed |

MongoDB was not configured locally; browse database queries are covered through the memory-store implementation. Verify live MongoDB text and geospatial queries after deployment to a configured test database.

## Phase 5 — Checkout and orders

| Item | Status | Verification |
|---|---|---|
| Checkout request validation; reject client-supplied prices and unsupported fields | DONE | Order-route tests cover altered price inputs and malformed checkout requests |
| Server-side product price snapshots and whole-KES line rounding | DONE | Tests check per-line nearest-shilling totals using authoritative product prices |
| Split a multi-seller cart into individual seller orders | DONE | HTTP test checks separate order records, totals, and delivery details per seller |
| Stock reservations with rollback when any cart item cannot be reserved | DONE | Service tests verify insufficient-stock rollback leaves no partial hold/order |
| 15-minute reservation expiry and periodic cleanup | DONE | Tests verify expired orders are cancelled and reserved stock is released |
| Buyer/seller order history, access control, and cancellation | DONE | HTTP tests cover private order reads, buyer cancellation, and seller ownership |
| Seller order state transitions and buyer delivery completion | DONE | HTTP tests cover payment prerequisite, seller-only transitions, and stock consumption |
| Backend tests | DONE | `npm --prefix backend test` — 36 passed, 0 failed |
| Web regression tests | DONE | `npm --prefix Web test` — 26 passed, 0 failed |

Product-level delivery negotiation is outside platform checkout; the order records delivery details and the platform does not add or collect a delivery fee. MongoDB was unavailable locally; database persistence and stock concurrency still require configured-database verification. Product decisions and additional checkout choices are recorded in [`DECISIONS.md`](./DECISIONS.md).

## Phase 6 — PesaPal hosted payments

| Item | Status | Verification |
|---|---|---|
| Configurable sandbox/live PesaPal API client and OAuth token caching | DONE | Provider-client tests cover sandbox host, authentication, and request payloads |
| One-time IPN registration helper and required backend-only configuration | DONE | Mock provider registration test; runtime config rejects incomplete or insecure settings |
| Buyer-owned payment start/resume with an order-scoped in-flight lock | DONE | HTTP/service tests cover reuse, ownership, email validation, and reservation expiry |
| Verify provider IPN by querying transaction status; match merchant reference, amount, and KES currency | DONE | Tests confirm verified success advances order; mismatched notification is rejected |
| Payment state persistence, retries, and duplicate-notification behavior | DONE | Mock store tests cover lifecycle; duplicate status behavior remains idempotent at order transition |
| Backend tests | DONE | `npm --prefix backend test` — 48 passed, 0 failed |
| Web regression tests | DONE | `npm --prefix Web test` — 26 passed, 0 failed |

Payments remain disabled until provider settings are configured. Live PesaPal credentials, network callbacks, and MongoDB persistence are not available in this environment; validate in provider sandbox before enabling live transactions. A successful payment arriving after cancellation/expiry is marked for order review rather than silently restoring an expired stock reservation. Cancelling an already-paid order flags it for manual refund review; automatic refunds are not implemented.

## Phase 7 — Notifications, reviews, and administration

| Item | Status | Verification |
|---|---|---|
| Notification interface with console driver; order placed, seller new-order, paid, confirmed, dispatched, and delivered events | DONE | Backend tests exercise checkout, lifecycle transitions, and verified payment flow; structured console messages include template and order ID |
| Buyer reviews limited to completed orders containing the product; one review per order/product | DONE | `phase7.test.js` verifies ineligible reviews, successful submission, and duplicate rejection |
| Product rating average and count updated atomically in MongoDB | CODE-ONLY | MongoDB aggregation-pipeline update implemented; local MongoDB is unavailable |
| Admin listing review, seller suspension and verification, filtered order/payment lists, dispute resolution, CSV export | CODE-ONLY | Routes and scoped store operations implemented; live Mongo persistence and end-to-end admin verification remain outstanding |
| Admin write actions recorded in `auditLog` | CODE-ONLY | Audit writes wired to each admin mutation and CSV export; live Mongo persistence unavailable |
| Seller verification shown on the public seller profile for the frontend badge | DONE | Public seller profile response already exposes `sellerProfile.verified`; frontend wiring follows in Phase 8 |
| Backend tests | DONE | `npm --prefix backend test` — 50 passed, 0 failed |
| Web regression tests | DONE | `npm --prefix Web test` — 26 passed, 0 failed |

Notification delivery currently uses the console driver only. Provider delivery, MongoDB-backed reviews/admin actions, and operational verification require later configuration/testing.

## Phase 8 — Modular marketplace frontend

| Item | Status | Verification |
|---|---|---|
| Replace the Web entry point with a modular AgriStore React app while retaining the legacy app until parity is proven | DONE | `Web/src/main.jsx` boots the marketplace modules; the legacy app and its tests remain in the tree |
| Buyer flows: browse/search/filter, product details, cart, seller profiles, checkout, payment return, orders, and reviews | CODE-ONLY | Routes and API wiring are implemented; live Firebase, MongoDB, and PesaPal flows are not configured |
| Seller and admin flows, seller onboarding, listing image uploads, order management, and admin views | CODE-ONLY | UI and seller-profile API are implemented; persistence and live role-based flows need configured services |
| Firebase email/password and Google sign-in; optional SMS behind an explicit build flag | CODE-ONLY | Modular Firebase integration builds; authentication providers cannot be exercised without Firebase configuration |
| English/Swahili labels, KES formatting, responsive styles, image upload progress, and PWA assets | DONE | Web tests pass; responsive widths 390, 800, 1100, and 1440 were manually checked in the integrated browser with no horizontal overflow |
| GitHub Pages path routing and runtime configuration | DONE | Production build contains the SPA path restore logic and `/sonara/` asset base; deployment reads Firebase/API settings from repository variables |
| Backend tests | DONE | `npm --prefix backend test` — 51 passed, 0 failed |
| Web tests | DONE | `npm --prefix Web test` — 34 passed, 0 failed, including legacy regression coverage |
| Production frontend build | DONE | `npm --prefix Web run build` completed |
| Automated Playwright layout screenshots | BLOCKED | `npm --prefix Web run qa:layout` cannot launch because the Playwright Chromium executable is missing; browser download previously timed out |

The responsive browser check is not a substitute for the automated light/dark screenshot matrix. Full buyer/seller/admin parity and live service integration remain unverified; do not remove the retained legacy app/tests until those flows are explicitly compared.

## Phase 9 — Cleanup, documentation, and operations

| Item | Status | Verification |
|---|---|---|
| Add authenticated listing report submission with duplicate protection and per-user rate limiting | DONE | `reports.test.js` verifies valid, duplicate, invalid, and seller-self-report cases |
| Add admin report queue and reasoned listing takedown with audit event | DONE | `reports.test.js` verifies active listing removal and audit logging |
| Add AgriStore root/Web READMEs and API, architecture, payments/payouts, privacy, legal-draft, and go-live docs | DONE | Documentation reviewed against current route/config behavior; legal copy is explicitly marked draft-only |
| Update Render blueprints and backend route docs for AgriStore | DONE | Removed stale Sonara project/database values, unused variables, and invalid Pages path from the CORS origin |
| Remove all legacy Sonara music app assets/tests and docs | DEFERRED | Retained legacy Web app and regression tests because complete marketplace flow parity is not proven; Android remains the explicitly frozen legacy app |
| Backend tests | DONE | `npm --prefix backend test` — 53 passed, 0 failed |
| Web tests and production build | DONE | `npm --prefix Web test` — 34 passed, 0 failed; `npm --prefix Web run build` completed |

The report API stores records in MongoDB when configured and uses an in-memory store for local tests. MongoDB report persistence and the live administrator workflow remain unverified without a configured database. Seller payout automation, self-service account deletion, and external notification delivery remain out of scope for the current implementation and are called out in the operating/legal docs.

## Phase 10 — Release quality and handoff

| Item | Status | Verification |
|---|---|---|
| Backend and Web regression suites | DONE | `npm --prefix backend test` — 53 passed; `npm --prefix Web test` — 34 passed |
| Production Web build | DONE | `npm run build:web` completed |
| Responsive smoke check with mocked catalog data | DONE | Integrated browser checked home at 390/800/1100/1440 px in light and dark modes; product detail checked at all four widths. No horizontal overflow or card overlap observed |
| Playwright automated screenshot/layout job | BLOCKED | Repository `qa:layout` runner still needs the Playwright Chromium binary; prior browser download attempts timed out |
| Dependency audit and safe fixes | BLOCKED | Web audit: 15 advisories (6 high, 9 moderate) remain after a non-forced fix upgraded `source-map-js` to 1.2.2. Backend production dependency audit: 9 advisories (2 high, 7 moderate). Remaining remediation requires reviewed dependency upgrades; no `--force` changes were applied |
| Firebase/MongoDB/R2/PesaPal sandbox end-to-end and audit persistence | BLOCKED | External service configuration and credentials are unavailable in this environment |
| Legacy music-code retirement after AgriStore parity | BLOCKED | Full parity has not been demonstrated; old Web app/tests and the frozen Android app remain |
| Open pull request to `main` | BLOCKED | Not opened: automated layout QA, live service flows, legacy parity, and dependency advisory review are release gates still outstanding |

The current local branch contains Phase 8 and Phase 9 commits; the final release handoff is intentionally incomplete. Resolve or formally accept the dependency findings, run the automated and configured-service checks, and verify parity before opening a release PR.
