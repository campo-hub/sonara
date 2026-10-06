# SONARA: UI RESTORATION & RECOVERY PROMPT

You are a careful senior engineer doing a **recovery job**, not a creative job. A previous attempt to redesign and improve Sonara left the project messy. Your task is to **put the original UI back exactly**, keep only the approved functional improvements, delete the debris, and track every step in `docs/PROGRESS.md`.

Do not ask questions. Do not start anything that is not in the tracker. Do not redesign anything.

---

## 0. What was found (evidence from comparing the two versions)

I compared the **baseline** (`sonara_1.zip`, the last good UI, `Web/src/App.jsx` = 3,740 lines, `styles.css` = 3,991 lines) with the **current** working tree (`sonara.7z`, last commit "still fighting", plus 123 uncommitted file changes).

**The most important finding: the current Web UI is still the old UI.** `main.jsx` still renders `App.jsx` + `styles.css`. The CSS diff is small (+222 / -19 lines). The mess is mostly *process debris and a few layout regressions*, not a rewritten interface:

1. **Dead redesign scaffold, never wired in.** `Web/src/app/` (`AppShell.jsx`, `AppShell.css`, `design-tokens.css`, `routes.js`, `queryCache.js`) is imported by nothing. It contains placeholder content ("Night Drive", "North Echo", "Welcome back to your listening room"). `docs/REDESIGN_PLAN.md` describes this abandoned direction.
2. **Duplicate modules.** `Web/src/app/routes.js` and `Web/src/lib/routes.js` both exist, as do `app/queryCache.js` and `lib/queryCache.js`. Only `lib/` is used by `App.jsx`.
3. **Two conflicting plans** in `docs/` (`REDESIGN_PLAN.md` vs `IMPROVEMENTS_PLAN.md`).
4. **Home layout regression.** Baseline Home is a 3-column grid (`minmax(260px,300px) 1fr minmax(260px,300px)`: DJ rail, main shelves, history rail). Current CSS collapsed it to one column (`grid-template-columns: minmax(0,1fr)`), removed the 860-1239px two-column tablet rule, and made the rails static. That stacks the DJ panel on top and Recently played at the bottom. The JSX (`renderNewHome`) is still the 3-column structure, so the CSS no longer matches what the markup was designed for.
5. **Half-finished TV fix.** Only 8 container `max-width` values were converted from px to rem (`1280px` to `80rem`, etc.), plus a `@media (min-width:1600px)` block that changes `html` font-size. Nearly every other rule (fonts, paddings, tiles, icons) is still in `px`, so **text and controls do not actually scale on a TV**; only the content width and column counts change.
6. **`App.jsx` grew from 3,740 to 4,136 lines** with ~950 changed lines, mostly admin logic inlined into the single giant component.
7. **Git hygiene problems:** `android/app/google-services.json`, `google-services (1).json`, `google-services (2).json` are **tracked in git** (adding `**/google-services*.json` to `.gitignore` does not untrack them). `.gitignore` was rewritten whole-file (line-ending churn). `Web/.env.example` is deleted in the working tree. `.env` files exist in the project folder (untracked, good, but never put them in shared zips).
8. **Android:** `.kt` files live in `com/castmobile/sender/ui/` but declare `package com.sonara.app.ui` (pre-existing mismatch; Kotlin tolerates it, do not "fix" it in this job).

Full per-item status is in `docs/PROGRESS.md`. Keep it updated.

---

## 1. Golden rules

1. **Baseline is the source of truth for look and feel.** `baseline/` in this kit contains the original `App.jsx`, `styles.css`, `main.jsx`, helper modules, `layout-check.mjs`, and all Android `ui/*.kt` files.
2. **Restore, never reinterpret.** If you are unsure whether something is "UI change", compare against the baseline and leave the baseline behavior.
3. **No new scaffolding, frameworks, design systems, or placeholder content.** Do not create new top-level folders other than the ones named here.
4. **One change per commit.** Each tracker item ID (e.g. `R-03`) = one commit with message `R-03: <summary>`. Update `docs/PROGRESS.md` in the same commit.
5. **Never edit line endings.** Both versions use CRLF in the Web files. Preserve them (`git config core.autocrlf false`; do not let tools reformat whole files). A diff must show only the lines you intentionally changed.
6. **If a step would touch more than ~150 lines of `App.jsx` at once, stop and split it.**
7. **Never print or read secret values** (`.env`, service accounts, Firebase config).

---

## 2. Decisions already made (do not reopen)

| Topic | Decision |
|---|---|
| Overall look | Restore the baseline UI exactly (palette, fonts, vinyl/sleeve language, header, deck, stage, Lab, Upload, Playlists, Favorites). |
| Home layout | **Restore the 3-column Home** (DJ rail / main / history rail), then fix the "panels scroll differently" annoyance with a **minimal** CSS change: rails become `position: static` so all three columns scroll together with the page. Columns, spacing and panels stay as in the baseline. |
| All Music page | **Stays removed** (explicitly requested earlier). Library "Songs" tab is the home for all music. Old `all-music` links redirect there. |
| Discover on Home | **Stays removed** (explicitly requested). Do not replace it with anything. |
| Admin improvements | **Keep** (cached data, 7-state feedback, jobs, activity log, identity-aware cost table), but make every new element use existing classes/variables so it is visually native. |
| Backend improvements | **Keep** (universal daily mixes, genre playlists, genre-named mixes, job endpoints, admin summary, identity resolution). Do not touch except for bug fixes listed in the tracker. |
| Android | **Keep current changes** (Library/All Music merge, Discover removal, WindowSizeClass, universal daily mix naming). Restore a baseline `.kt` file only if the build fails because of it. |
| TV scaling | Replace the rem-conversion approach with a **build-time px-to-rem transform** (section 5, step R-06) so baseline CSS stays untouched in source and below 1600px renders pixel-identical. |

---

## 3. Inputs

- `baseline/Web/src/*` and `baseline/Web/scripts/layout-check.mjs`: original files to restore from.
- `baseline/android-ui/*.kt`: original Android UI.
- `diffs/*.diff`: exact differences baseline-to-current for `App.jsx`, `styles.css`, and five Android files. Use them to **cherry-pick** approved changes and to identify what to revert.
- `docs/PROGRESS.md`: the tracker you must maintain.

---

## 4. Safety net (do this first, R-00)

```bash
git add -A && git commit -m "R-00: snapshot of current messy state"
git branch backup/pre-restore
git tag pre-restore-snapshot
```
Then create the baseline screenshots (needed later for visual parity):
1. Copy `baseline/Web/src/*` into a throwaway worktree (`/tmp/sonara-baseline`) with the same `package.json`, run it on port 5174.
2. Run the screenshot script (section 7) against it to produce `qa-output/baseline/*.png` at every viewport, light and dark, for every view reachable without sign-in plus signed-in views if a test account is configured via env vars (do not hardcode credentials).

---

## 5. Restoration procedure (execute in order, one commit each)

### R-01. Delete the dead redesign scaffold
Remove `Web/src/app/` entirely (`AppShell.jsx`, `AppShell.css`, `design-tokens.css`, `routes.js`, `queryCache.js`). Move `docs/REDESIGN_PLAN.md` to `docs/archive/REDESIGN_PLAN.abandoned.md`. Confirm with `grep -rn "src/app\|AppShell\|design-tokens" Web/` that nothing references them.

### R-02. Single source for routing and cache modules
Keep `Web/src/lib/{routes.js,queryCache.js,useAction.js,ProgressSteps.jsx}` (the ones `App.jsx` imports). Make sure the tests `Web/tests/{routes,queryCache,useAction}.test.js` import from `lib/`. Run `cd Web && npm test`.

### R-03. Restore `styles.css` from baseline
Replace `Web/src/styles.css` with `baseline/Web/src/styles.css` verbatim. This discards: the px-to-rem edits, the single-column Home grid, the `overflow` edits, and the `>=1600px` block. Then re-append, at the very end of the file, one clearly delimited block:

```css
/* ===== SONARA ADDITIONS (tracked in docs/PROGRESS.md) ===== */
```
and inside it re-add only the approved pieces, each with a comment containing its tracker ID:

- **A-CSS-1 (cost table):** the `.cost-*` and `.storage-meter` rules from `diffs/styles.css.baseline-to-current.diff` (lines that add `.cost-breakdown` through the `@media (max-width: 859px)` cost rules). Check each uses existing variables (`--line`, `--muted`, `--accent`, `--text`, `--paper`, `--line-soft`) and nothing new.
- **A-CSS-2 (Home scroll fix, minimal):**
  ```css
  .home-rail { position: static; }            /* was sticky: rails now scroll with the page */
  .home-main, .home-section { overflow-x: clip; overflow-y: visible; } /* no inner scroll container */
  ```
  Also keep the shelf rule `.mix-shelf { overflow-y: hidden; overscroll-behavior-x: contain; }` only if shelves were showing a vertical scrollbar in the baseline screenshots. Do not change grid columns or the 860-1239px rule.

### R-04. Restore `App.jsx` from baseline, then re-apply approved changes as separate commits
Replace `Web/src/App.jsx` with `baseline/Web/src/App.jsx`, then port each approved change from `diffs/App.jsx.baseline-to-current.diff`. **Port by intent, one tracker item at a time.** Prefer moving new logic into small modules (`Web/src/lib/adminActions.js`, `Web/src/lib/adminCost.js`) and importing it, so `App.jsx` stays close to the baseline and the diff stays reviewable.

Approved ports (each its own commit; the diff shows where each lives):

| ID | Port | Notes |
|---|---|---|
| P-01 | Imports for `queryCache`, `routes`, `useActionMap`, `ProgressSteps`; `adminCacheKeys`, `invalidateAdminCache`, `playlistsCacheKey`, `pollAdminJob` helpers | Top of file |
| P-02 | Hash routing (`parseHashRoute`/`createRouteHash`, `hashchange` sync, per-route scroll restore, `goTo` writes hash) | Must keep deep links and the back button working; `all-music` aliases to Library Songs |
| P-03 | Nav: remove `all-music` from `navItems`, `mobileTabs` (`home, library, playlists, lab`), `pageMeta`, cover map | Visual result: one fewer nav item |
| P-04 | Remove Discover (`discoverTracks` memo and both render sites) | Home and any other view |
| P-05 | Admin data through `queryCache` (instant on return, silent revalidate, "Updated Ns ago") | No blocking loader after first load |
| P-06 | Admin actions on `useActionMap` + `ProgressSteps` + job polling, per-row busy state, activity drawer, Undo toast | Reuse `.btn`, `.toast`, `.admin-*`, `batch-status`; no new visual language |
| P-07 | Cost table: `username (email)` first column, copy email, copy all, billing CSV export, sort/search, totals row, free-tier footnote, mobile cards | CSS from A-CSS-1 |
| P-08 | Genre playlists loaded via `queryCache` and merged into Playlists | Use existing playlist card |
| P-09 | Daily recommendations from the universal set; mix subtitles | Existing recommendation card |
| P-10 | `keydown` remote/arrow navigation (only active at `>=2560px` or when living-room mode is on) | No visual change at normal sizes |

After each port: `npm run build`, `npm test`, quick manual check of that screen, then commit and tick the tracker.

### R-05. Restore `main.jsx`, `catalogUtils.js`, `colorUtils.js`, `firebaseAuth.js`
Restore from baseline unless a P-item genuinely needs a change (e.g. catalog cache keys). Any retained change must be listed in the tracker with the reason.

### R-06. TV / large-screen scaling, done properly
Goal: pixel-identical below 1600px, proportionally scaled UI above it, with the baseline CSS untouched.
1. `cd Web && npm i -D postcss postcss-pxtorem`.
2. In `vite.config.js` add:
   ```js
   import pxtorem from 'postcss-pxtorem';
   css: { postcss: { plugins: [pxtorem({ rootValue: 16, unitPrecision: 4, propList: ['*', '!border*', '!outline*', '!box-shadow'], mediaQuery: false, minPixelValue: 2 })] } }
   ```
3. In the A-CSS block add the scaling steps (root stays 100% = 16px below 1600px, so nothing changes):
   ```css
   @media (min-width: 1600px) { html { font-size: 112.5%; } }
   @media (min-width: 1920px) { html { font-size: 125%; } }
   @media (min-width: 2560px) { html { font-size: 175%; } }
   @media (min-width: 3840px) { html { font-size: 250%; } }
   ```
   (media queries stay in px because `mediaQuery: false`).
4. Add overscan-safe padding at `>=1920px` (`padding-inline: max(3.5vw, 1.5rem)` on `.page`, same offsets on `.deck`). Add ultra-wide handling (`min-aspect-ratio: 21/9`): center `.page` and `.deck` with a max width.
5. Known limit: sizes set in JS props (icon `size={19}`, `CoverArt size`) do not scale. Check screenshots at 2560 and 3840; if icons look small, add a CSS rule scaling those SVGs (`svg { width: 1em; height: 1em }` is NOT allowed to be applied globally; scope it to the specific components and verify nothing changes below 1600px).
6. **Living-room mode toggle** (Lab > Settings, existing toggle styling): `prefs.livingRoom` forces the `>=2560px` scale and enables the arrow-key focus navigation at any width; focus ring uses `outline: 3px solid var(--accent)` on `:focus-visible`.
7. If pxtorem causes any regression that cannot be fixed in two attempts, fall back to `@media (min-width:1600px){ body{ zoom: <step> } }` and re-test the fixed-position `.stage` and `.deck`.

### R-07. Restore the harness
Replace `Web/scripts/layout-check.mjs` with a version that screenshots **all views** at 360x800, 390x844, 768x1024, 1280x720, 1440x900, 1920x1080, 2560x1440, 3840x2160, 5120x1440, light and dark; fails on horizontal overflow, clipped text, overlapping fixed elements (`.deck` vs content), or any element with `overflow-y: auto|scroll` that is not a modal or the stage. Write output to `qa-output/current/`.

### R-08. Git hygiene
- `git rm --cached "android/app/google-services.json" "android/app/google-services (1).json" "android/app/google-services (2).json"` (keep the local files, remove from tracking; delete the numbered duplicates locally if they are copies).
- Verify `git ls-files | grep -i "\.env"` shows only `*.env.example` files; restore `Web/.env.example` (it exists in baseline).
- Restore `.gitignore` with `\n` normalized to the original line endings so the diff is only the added `**/google-services*.json` line.
- Tell me which Firebase/API keys appeared in tracked files so I can rotate them. Do not print values.

---

## 6. UI Diff Register (every visible baseline vs current difference and the final decision)

| # | Where | Baseline | Current | Final |
|---|---|---|---|---|
| 1 | Header nav | Home, Library, All Music, Playlists, Favorites, Lab, Admin | All Music removed | **Keep removal** |
| 2 | Mobile tabs | Home, Library, All Music, Lab | Home, Library, Playlists, Lab | **Keep** |
| 3 | Home grid | 3 columns, sticky rails | 1 column, static rails | **Revert to 3 columns; rails static (A-CSS-2)** |
| 4 | Home tablet 860-1239px | 2-column rule | rule deleted | **Restore** |
| 5 | Home Discover | present | removed | **Keep removal** |
| 6 | Library | tabs songs/albums/artists | same, plus all-music redirect | **Keep** |
| 7 | Admin first load | blocking loader on every visit | cached | **Keep** |
| 8 | Admin actions | one shared busy flag, silent | per-action states, steps, undo, activity | **Keep, native styling** |
| 9 | Admin cost table | UID + N/A, red `$0.0000` | `username (email)`, meters, neutral cost | **Keep** |
| 10 | Containers | `max-width` in px | rem | **Revert (pxtorem handles scaling)** |
| 11 | `body` font-size | `15px` | `0.9375rem` | **Revert** |
| 12 | `>=1600px` | nothing | rem grid block | **Replace with R-06** |
| 13 | Overflow rules on home columns | `hidden` | `visible` / `clip` | **`overflow-x: clip` only (A-CSS-2)** |
| 14 | Android Home/Library | separate All Music, Discover | merged, Discover removed | **Keep** |

---

## 7. Visual parity gate (must pass before declaring done)

1. Run baseline and current at the same viewports and viewport states.
2. Pixel-diff with `pixelmatch` (threshold 0.1). At **1280 and below, and 1440**, the only allowed differences are: missing "All Music" nav item/tab, missing Discover section, Home rails scroll with the page (compare at scroll 0 only), and Admin screens. Everything else must show **0 changed pixels** outside those regions (mask them explicitly in the script).
3. At 1920 / 2560 / 3840 / 5120: no horizontal overflow, text visibly larger than at 1440, content centered with TV-safe margins, deck not overlapping the last row.
4. Save a `qa-output/REPORT.md` listing each viewport/view with PASS/FAIL and the diff-pixel count.

---

## 8. Android (verify, do not redesign)

1. `cd android && ./gradlew :app:assembleDebug`. If it passes, no restoration is needed.
2. If a file fails to compile, restore only that file from `baseline/android-ui/` and re-apply the minimal change from `diffs/android.*.diff` (`MainViewModel` must expose `dailyRecommendationTracks` and `dailyRecommendationName`; `MainNavigation` must pass `windowSizeClass`).
3. Confirm tabs are Home, Library, Lab (plus Admin if applicable) and that Library contains the former All Music list.
4. Do not touch `dj/*`, `media/*`, or the package declarations.

---

## 9. Going-forward plan (only after sections 5-8 are green)

Work these in order, each as its own tracked item with the same one-commit-per-item rule. All are **not done yet** (details in `docs/PROGRESS.md`):

1. **N-01** Confirmation modal for destructive admin actions (release, rollback, import apply) using the existing modal/dialog styles.
2. **N-02** Lazy-load Admin and Lab (`React.lazy`) so normal users never download them.
3. **N-03** Apply the same action/feedback pattern to upload, like, add-to-playlist, sign-in and profile-save.
4. **N-04** Genres group in Playlists (dedicated section + genre playlist page route) using existing playlist cards.
5. **N-05** Artist Mix and Artist Radio (backend contract, then UI on artist and track menus).
6. **N-06** Android: feedback snackbars, response caching for instant cold start, genre playlists.
7. **N-07** Virtualize Library > Songs only if profiling shows a real need (record numbers).
8. **N-08** Run `scripts/perf-check.mjs` before/after and record results in the tracker.

---

## 10. Reporting rules

- After every item: update `docs/PROGRESS.md` (status, commit hash, files touched, how it was verified).
- If something cannot be verified in your environment (e.g. no Firebase sign-in), mark it `UNVERIFIED` with the exact manual steps for me to check. Never mark an item DONE on code reading alone.
- Final message: a table of items DONE / PARTIAL / NOT DONE / UNVERIFIED, the parity report, and a list of anything you deliberately left alone.

**Definition of done:** baseline look restored (parity gate passes), approved improvements still working, dead scaffold gone, secrets untracked, tracker fully up to date, and `npm test` (Web and backend) plus `npm run build` green.
