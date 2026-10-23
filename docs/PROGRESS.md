# AgriStore Restoration Progress

Legend: **DONE** means run and observed; **CODE-ONLY** means present but not yet verified.

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

MongoDB was not configured locally; index declarations were verified using a mock database. No rounding rule for fractional quantity × unit price is assumed in this phase; order line totals are validated as whole-shilling integers, with checkout computation to be defined in Phase 5.

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

**Not started.** Product decisions are recorded in [`DECISIONS.md`](./DECISIONS.md); begin implementation only after the user asks to continue.
