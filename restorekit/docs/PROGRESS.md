# Sonara Progress Tracker

Legend: **DONE** = present in code and verified | **CODE-ONLY** = present in code, not yet run/verified | **PARTIAL** = some of it exists | **NOT DONE** = not found in code | **REVERT** = must be undone | **TODO** = restoration step not started

Audit basis: static comparison of `sonara_1.zip` (baseline, last good UI) against `sonara.7z` (current, last commit `b442ea2 "still fighting"` plus uncommitted changes), Oct 5 2026. Nothing was built or run during the audit, so nothing below is marked DONE unless it is a pure file-presence fact. Update this file in every commit.

---

## A. Restoration steps (from SONARA_RESTORE_PROMPT.md)

| ID | Step | Status | Commit | Verified how |
|---|---|---|---|---|
| R-00 | Snapshot branch/tag + baseline screenshots | TODO | | |
| R-01 | Delete dead scaffold `Web/src/app/*`, archive `REDESIGN_PLAN.md` | TODO | | |
| R-02 | Single `lib/` for routes/cache; tests import `lib/` | TODO | | |
| R-03 | Restore `styles.css` from baseline + A-CSS-1 (cost) + A-CSS-2 (home scroll) | TODO | | |
| R-04 | Restore `App.jsx` from baseline + ports P-01..P-10 | TODO | | |
| R-05 | Restore `main.jsx`, `catalogUtils.js`, `colorUtils.js`, `firebaseAuth.js` | TODO | | |
| R-06 | TV scaling via postcss-pxtorem + root steps + living-room toggle | TODO | | |
| R-07 | Full-matrix `layout-check.mjs` | TODO | | |
| R-08 | Git hygiene: untrack google-services files, restore `Web/.env.example`, fix `.gitignore` | TODO | | |
| R-09 | Visual parity gate passes (`qa-output/REPORT.md`) | TODO | | |
| R-10 | Android build check / minimal baseline restores | TODO | | |

### Ports into the restored `App.jsx`

| ID | Port | Present in current tree? | Status after restore |
|---|---|---|---|
| P-01 | queryCache / routes / useAction / ProgressSteps imports + helpers | yes | TODO |
| P-02 | Hash routing, scroll restore, `all-music` alias | yes | TODO |
| P-03 | Nav: All Music removed, mobile tabs updated | yes | TODO |
| P-04 | Discover removed (memo + 2 render sites) | yes | TODO |
| P-05 | Admin data via cache, "Updated Ns ago" | yes | TODO |
| P-06 | Admin per-action states, steps, job polling, undo, activity drawer | yes | TODO |
| P-07 | Cost table (`username (email)`, copy, CSV, sort, totals, mobile cards) | yes | TODO |
| P-08 | Genre playlists merged into Playlists | yes (state + fetch) | TODO |
| P-09 | Universal daily recommendations + subtitles | yes | TODO |
| P-10 | Arrow-key remote navigation at `>=2560px` | yes (width-gated only) | TODO |

---

## B. Visual regressions found (current vs baseline)

| ID | Issue | Evidence | Status |
|---|---|---|---|
| V-01 | Home collapsed to 1 column (rails stacked) | `.home-grid` columns, `.home-rail` static, tablet rule deleted | REVERT |
| V-02 | px-to-rem on 8 container widths + `body` font | `styles.css` lines 83-93, 574, 2494, 2609, 2732, 2968, 2995 | REVERT |
| V-03 | `>=1600px` rem block (grids only; text does not scale) | `styles.css` end of file | REVERT, replace with R-06 |
| V-04 | Overflow rules changed on `.home-main`, `.home-section` | `hidden` to `visible`/`clip` | REVERT, keep `overflow-x: clip` only |

---

## C. Debris to remove

| ID | Item | Status |
|---|---|---|
| D-01 | `Web/src/app/AppShell.jsx`, `AppShell.css`, `design-tokens.css` (unused, placeholder content) | TODO delete |
| D-02 | `Web/src/app/routes.js`, `queryCache.js` (duplicates of `lib/`) | TODO delete |
| D-03 | `docs/REDESIGN_PLAN.md` (abandoned direction; conflicts with improvements plan) | TODO archive |
| D-04 | `android/app/google-services (1).json`, `(2).json` (duplicate copies, tracked) | TODO untrack + delete local dupes |

---

## D. Improvements ledger (from the "improvements, no redesign" prompt)

### 1. Admin: no reload on every visit
| Item | Status | Evidence / gap |
|---|---|---|
| In-memory SWR cache with dedupe | CODE-ONLY | `lib/queryCache.js` + `queryCache.test.js` |
| Admin stats/catalog/batches via cache | CODE-ONLY | `adminCacheKeys`, `fetchQuery` usage in `App.jsx` |
| Instant return, silent revalidate, "Updated ago" | CODE-ONLY | 1 "Updated ... ago" hit |
| Admin state kept across navigation | CODE-ONLY | admin state already top-level in baseline |
| Cache for catalog / playlists / genres / recs | PARTIAL | playlists + genre playlists use cache; verify catalog and recs |
| `GET /api/admin/summary` | CODE-ONLY | present in `server.js` |
| ETag/Cache-Control on admin + catalog GETs | CODE-ONLY | ETag mentions 17 to 42 in `backend/src` |

### 2. Feedback system
| Item | Status | Evidence / gap |
|---|---|---|
| `useAction` + `ProgressSteps` | CODE-ONLY | `lib/useAction.js`, `lib/ProgressSteps.jsx`, tests |
| Per-action/per-row busy state (replaces `adminActionLoading`) | CODE-ONLY | `useActionMap` in `App.jsx` |
| Jobs + progress polling (requeue, import, rollback, backfill) | CODE-ONLY | `backend/src/adminJobs.js`, `pollAdminJob` |
| Undo (8s) | CODE-ONLY | 8 "Undo" hits |
| Activity log drawer | CODE-ONLY | `adminActivity` state |
| Confirmation modal for destructive actions | NOT DONE | no confirm dialog found |
| Global top progress bar / offline banner | NOT DONE | no new code vs baseline; `navigator.onLine` absent |
| `aria-live` announcements | PARTIAL | 1 to 2 occurrences |
| Same pattern for upload, like, playlist, sign-in, profile | NOT DONE | `useActionMap` used for admin only |

### 3. Cost table
| Item | Status | Evidence / gap |
|---|---|---|
| `username (email)` first column | CODE-ONLY | `adminStatsUtils.js`, cost CSS |
| Server-side identity resolution (profiles then Firebase Admin) | CODE-ONLY | `identity.displayName` logic in `server.js` |
| Click-to-copy email, copy all, billing CSV | CODE-ONLY | `copyAllEmails`, billing hits |
| Sort/search/totals/meters/mobile cards | CODE-ONLY | `.cost-*` CSS |
| Upload stores profile username/email | CODE-ONLY | `uploaderName` at upload route |
| Backfill job | CODE-ONLY | `backfill` in server + App |
| Free-tier footnote, neutral `$0` styling | CODE-ONLY | `.cost-zero`, `.cost-footnote` |

### 4. Navigation cleanup
| Item | Status |
|---|---|
| All Music page removed, merged into Library Songs | CODE-ONLY |
| Remaining `goTo('all-music')` calls resolve via alias | CODE-ONLY (6 call sites, all handled; tidy later) |
| Hash routing, back button, scroll restore | CODE-ONLY |
| Mobile tabs updated | CODE-ONLY |

### 5. Home
| Item | Status | Note |
|---|---|---|
| Discover removed (Web) | CODE-ONLY | keep |
| Discover removed (Android) | CODE-ONLY | keep |
| One scroll only | REWORK | achieved by collapsing to one column, which broke the layout. Redo as A-CSS-2 (rails static, 3 columns kept) |

### 6. Recommendations and playlists
| Item | Status | Evidence / gap |
|---|---|---|
| One universal daily set, once per day | CODE-ONLY | cron `5 0 * * *` (was hourly), `daily_mixes` doc |
| Stale-while-revalidate serving | CODE-ONLY | verify headers manually |
| Genre playlists (backend) | CODE-ONLY | `/genres/playlists` |
| Genre playlists (UI) | PARTIAL | merged into one flat list; no dedicated "Genres" group or `#/playlists/genre/:genre` page UI |
| Genre-named mixes ("Gospel Mix"), no "Sonara Set" | CODE-ONLY | `recommendationUtils.js` |
| Deep Cuts mix | PARTIAL | backend only, no UI |
| New Arrivals mix | NOT DONE | no backend mix found |
| Artist Mix / Artist Radio | NOT DONE | no backend or UI |
| Tests updated for determinism/naming | CODE-ONLY | `recommendation-utils`, `genre-mix`, `admin-jobs` tests |

### 7. Responsive / TV
| Item | Status | Note |
|---|---|---|
| Fluid scaling | REWORK | V-02/V-03: only containers scale. Replace per R-06 |
| Wider breakpoints and overscan padding | PARTIAL | rules exist at 1920/2560/3840 but inside the block being replaced |
| Living-room mode toggle | NOT DONE | only width-gated arrow-key handler |
| Remote/D-pad navigation | CODE-ONLY | `keydown` handler, only active at `>=2560px` |
| Mobile audit (targets, safe areas, deck overlap) | NOT DONE | no evidence |
| Playwright matrix (9 viewports, all views, overflow/scroller checks) | PARTIAL | script extended, not confirmed to cover all views/viewports |

### 8. Android
| Item | Status |
|---|---|
| Library and All Music merged (`LiquidLibrary` takes add-to-playlist + columns) | CODE-ONLY |
| WindowSizeClass for library columns | PARTIAL (library only) |
| Daily mix from `viewModel.dailyRecommendationTracks/Name` | CODE-ONLY |
| Discover removed from `HomeView` | CODE-ONLY |
| Feedback snackbars, retry, undo | NOT DONE |
| Response caching (Room/DataStore) | NOT DONE |
| Genre playlists / artist radio | NOT DONE |
| Gradle build passes | UNVERIFIED |

### 9. Engineering
| Item | Status |
|---|---|
| Lazy-load Admin/Lab | NOT DONE (no `React.lazy`) |
| Virtualize Library Songs | NOT DONE (do only if profiling shows need) |
| Media Session API | DONE in baseline (unchanged, 6 refs) |
| New unit tests (cache, routes, useAction, jobs) | CODE-ONLY (not run) |
| `perf-check.mjs` before/after numbers | NOT DONE |
| Secrets: untrack google-services, `.gitignore`, rotate keys | NOT DONE (files still tracked; see R-08) |

---

## E. Going-forward items (after section A is green)

| ID | Item | Status |
|---|---|---|
| N-01 | Confirmation modal for destructive admin actions | NOT DONE |
| N-02 | Lazy-load Admin and Lab | NOT DONE |
| N-03 | Feedback pattern for upload/like/playlist/sign-in/profile | NOT DONE |
| N-04 | Genres group + genre playlist page | NOT DONE |
| N-05 | Artist Mix and Artist Radio (backend + UI) | NOT DONE |
| N-06 | Android feedback, caching, genre playlists | NOT DONE |
| N-07 | Virtualization (only if needed) | NOT DONE |
| N-08 | Perf measurements recorded | NOT DONE |
| N-09 | New Arrivals mix (backend + UI) | NOT DONE |
| N-10 | Global network progress bar + offline banner | NOT DONE |

---

## F. Change log

| Date | Commit | Item | Notes |
|---|---|---|---|
| | | | |
