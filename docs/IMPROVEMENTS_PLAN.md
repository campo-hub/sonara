# Sonara Functional and UX Improvements Plan

## Audit Snapshot

- Web is React 18/Vite. `Web/src/App.jsx` owns navigation, page rendering, admin actions, and most state; view changes render one page at a time. `Web/src/styles.css` contains the approved design and must retain its current tokens and component styles.
- Web already has catalog/recommendation localStorage helpers in `Web/src/catalogUtils.js`; `/api/catalog` and `/api/recommendations/daily` already emit ETags, while only `/api/catalog` currently has explicit cache-control.
- Admin data is fetched on each visit, all admin actions share `adminActionLoading`, and Admin state is already top-level in `App`, so switching pages does not erase the CSV preview/file state. Scroll restoration is not route-based.
- Home uses a three-column `.home-grid`, sticky desktop rails, hidden overflow on `.home-main`/`.home-section`, and a Discover memo and two render sites.
- Backend daily mixes are keyed by owner and date, enrich recommendations per request with saved state, and cron currently runs hourly. Existing genre mix and CSV utilities should be reused.
- Admin stats currently use uploader fields directly, hard-code the storage rate, and do not resolve Firebase UIDs through `userProfiles`. Uploads use token identity rather than saved profile identity.
- Android UI files are stored beneath `android/app/src/main/java/com/castmobile/sender/`, but the inspected source declares `package com.sonara.app.ui`. `MainNavigation` has separate Library and All Music tabs; Android currently uses local media and playlist state.
- `Web/scripts/layout-check.mjs` currently checks only Home at 1440, 1100, 800, and 390px in light and dark modes. `npm run qa:layout` is the existing browser QA entry point.
- Web tests: `cd Web && npm test`; backend tests: `cd backend && npm test`; Web build: `cd Web && npm run build`. Android validation is via the Gradle wrapper.
- `.gitignore` ignores `.env` and `.env.*` except `.env.example`. The tracked-file audit found no tracked `.env` or Google Services JSON; `google-services*.json` was not ignored, so that pattern is being added without reading any secret contents.
- Initial worktree audit: `main` tracks `origin/main`; `docs/REDESIGN_PLAN.md` is untracked and will be left untouched. No tracked local edits were present at audit time.

## Phases

### 1. Audit and Baseline

Files: `docs/IMPROVEMENTS_PLAN.md`, `Web/scripts/layout-check.mjs`, screenshot output under `qa-output/`.

- Extend the existing Playwright check to the requested viewport matrix and all navigable views, preserving the existing visual checks and adding overflow, clipped-text, nested vertical scroll, and fixed-player overlap detection.
- Capture before screenshots before runtime changes. Record inaccessible/auth-gated states rather than bypassing authentication.
- Complete the secret tracking audit using Git metadata only; do not read or print secret contents.

Risks: local backend/auth configuration may make some views unavailable in an unauthenticated browser. Baseline checks must distinguish a blocked view from a layout failure.

### 2. Web Foundation

Files: `Web/src/lib/queryCache.js`, focused tests under `Web/tests/`, and targeted integration points in `Web/src/App.jsx` (extract modules only where useful).

- Add an in-memory stale-while-revalidate cache with deduplication and a React hook; use it for catalog, playlists, genres, recommendations, and admin reads.
- Add an action state hook and existing-style feedback components; replace the shared admin busy flag with per-action state.
- Add hash routes for existing views, legacy All Music redirection, browser history handling, and per-route scroll restoration.
- Keep Admin form/file/filter state across route transitions; preserve all established classes, CSS variables, copy tone, and visual styling.

Risks: authenticated requests must not share cached responses across identities; hash routing must preserve GitHub Pages base paths and existing links.

### 3. Backend Data, Identity, and Jobs

Files: `backend/src/server.js`, `backend/src/userStore.js`, `backend/src/firebaseAdmin.js`, `backend/src/catalogStore.js`, `backend/src/recommendationUtils.js`, `backend/src/genreMixUtils.js`, and focused `backend/tests/*`.

- Add `/api/admin/summary`, cache validators and cache headers for admin/catalog reads, profile-backed identity resolution, upload identity correction, and a backfill path.
- Convert expensive admin mutations to tracked jobs with status/progress endpoints; keep existing route behavior compatible during client migration.
- Move daily mix persistence to one date-keyed universal document, generate once daily in a configurable timezone, serve stale prior data while refreshing, and keep old Android endpoints returning compatible payloads.
- Generate cached genre playlists from catalog data and invalidate after genre-changing imports. Add genre-oriented deterministic mix names and artist mix/radio data contracts.

Risks: MongoDB schema/index compatibility, concurrent job idempotency, public caching of personalized fields, date/timezone boundaries, and old-client response compatibility. Public recommendation payloads must not include user-specific saved state.

### 4. Web Product Behavior

Files: `Web/src/App.jsx`, `Web/src/styles.css` (layout rules only), `Web/src/catalogUtils.js`, new focused `Web/src/lib/*` modules, and Web tests.

- Move All Music workflows into Library Songs and redirect old entry points/search; remove Discover from both render paths and derived state.
- Reflow Home into a single document scroll with the existing panel and shelf styles; remove sticky/vertical scroll behavior while retaining horizontal shelf clipping.
- Use cached reads and visible action feedback throughout Admin, upload, playlist, like, sign-in, and profile-save actions. Add the identity-aware billing table and safe destructive-action confirmation/undo behavior.
- Add genre playlists, recommended mix subtitles, artist mix/radio controls, new arrivals, and deep cuts using existing cards and playback/queue logic.
- Virtualize long Library lists only if profiling shows a measurable need and row behavior remains unchanged.

Risks: the monolithic component creates broad regression risk; split only testable cache/action/router/Admin logic, and keep extraction behavior-preserving. Avoid unrelated text/copy changes.

### 5. Responsive and Living-Room QA

Files: `Web/src/styles.css`, `Web/src/App.jsx` or focused navigation helpers, `Web/scripts/layout-check.mjs`, `qa-output/`.

- Preserve pixel output through 1440px; use rem-based scaling and wider breakpoints only above that threshold. Keep grids card-sized rather than stretching items.
- Add TV-safe spacing, visible keyboard focus/D-pad navigation, living-room mode, mobile touch/safe-area checks, and route/page screenshots at all requested sizes.
- Extend automated checks for horizontal overflow, clipped text, fixed-player overlap, and non-modal vertical scrollers.

Risks: OS/browser font metrics affect screenshot diffs; authenticated Admin and API-backed pages require deterministic fixtures or explicit gated-state screenshots.

### 6. Android Parity

Files: `android/app/src/main/java/com/castmobile/sender/ui/MainActivity.kt`, `MusicViews.kt`, `HomeView.kt`, `MainViewModel.kt`, `repository/MusicRepository.kt`, `api/SonaraApiClient.kt`, and Android tests/build configuration as needed.

- Merge All Music into Library tabs, remove Discover where present, integrate universal recommendations and genre playlists, add persistent API caching and action feedback, and use WindowSizeClass for adaptive layouts and D-pad focus.
- Keep `SonaraDesign.kt`, `DesignSystem.kt`, and DJ internals visually/behaviorally unchanged except the Artist Radio hook.

Risks: current Android music behavior is primarily local-device based; remote catalog/recommendation parity requires explicit repository/API mapping and cannot assume web track models are equivalent.

### 7. Verification and Delivery

- Run Web unit tests/build, backend tests, Android Gradle checks, and the full Playwright viewport matrix after relevant phases.
- Run `scripts/perf-check.mjs` before and after if present; otherwise record it as unavailable and add a narrow reproducible request-count check rather than inventing baseline numbers.
- Save after screenshots and compare normal viewports at or below 1440px; expected differences are limited to removing Discover/All Music and the requested Home rearrangement.
- Commit each completed phase only after its focused checks pass. Do not include pre-existing untracked documentation in these commits.

## Open Constraints

- No visual redesign: do not change color, typography, tokens, iconography, record/sleeve artwork language, shadows, radii, or existing copy tone.
- The 7-state action flow and background jobs are cross-cutting; implement them incrementally and retain ordinary synchronous endpoints until clients are migrated.
- Security cleanup must not print secret values or rewrite Git history without a separate explicit scope confirmation; report tracked exposure and recommend key rotation.
