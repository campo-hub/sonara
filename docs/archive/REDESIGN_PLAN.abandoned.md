# Sonara redesign plan

## Current state

The codebase is a working monorepo with a serviceable product surface but a legacy single-file UI:

- `Web/src/App.jsx` is the main shell and holds nearly all logic in a single component.
- `Web/src/styles.css` is a large stylesheet with the existing visual system, not a modular design layer.
- The backend already exposes the catalog, daily mix, upload, recommendation, and admin endpoints needed for the redesign.
- The app still has `home`, `library`, `all-music`, `playlists`, `favorites`, `lab`, `upload`, and `admin` state that can be reorganized under a deeper route model.

## Decision framework

We keep the product behavior, not the old layout. The redesign preserves the Sonara identity (wordmark, record-dot branding, warm listening-room mood) while replacing the old structure with a routed, design-system-first product.

### Product direction

- Replace the old dashboard feel with a “personal listening room” aesthetic.
- Collapse duplicated navigation and centralize the library under `Library`.
- Make all pages deep-linkable and route-based.
- Treat `Admin` as a cached, persistent workspace instead of a page that reloads and destroys state.
- Put genre-aware recommendations and universal daily mixes behind a single server model.

## Architecture decisions

### 1. Route shell

Use hash-based routing so GitHub Pages keeps working without a server rewrite:

- `#/home`
- `#/library/songs`
- `#/library/albums`
- `#/library/artists`
- `#/playlists`
- `#/playlists/genre/:genre`
- `#/player`
- `#/lab`
- `#/admin`
- `#/admin/batches`
- `#/upload`

This makes navigation back-button friendly, preserves scroll state, and matches the existing deployment model.

### 2. Design tokens

Create a single token layer for the redesign before redoing the UI. The foundations are:

- type scale using `clamp()`
- light/dark themes
- warm neutral palette + record red accent
- motion system and reduced-motion handling
- elevated surfaces and deck/player colors
- large-screen TV scaling rules

### 3. Data and feedback system

We will not keep the current giant fetch-on-render pattern. The new shell uses a lightweight query cache and action lifecycle:

- fetch once, cache, revalidate in background
- show last-updated state rather than blocking loaders
- all mutations use the same 7-state feedback pattern: ack, validate, work, progress, success, error, follow-up

### 4. Backend compatibility

The app must keep existing endpoints working for current clients. At the same time, we add:

- universal daily mix generation
- genre playlist generation
- job/progress APIs for long admin actions
- ETags and cache headers for reads
- stronger user identity resolution for storage and billing views

## Phased execution

### Phase 1 — foundation

- Create the route map and token layer.
- Add a lightweight cache layer for admin and library queries.
- Define the action and status feedback pattern.
- Split the design system out of the current CSS into `tokens`, `base`, and feature styles.

### Phase 2 — backend and recommendation model

- Standardize the daily mix flow to a single universal day snapshot.
- Expose cached mix and genre APIs.
- Add robust user identity resolution in admin storage reporting.
- Add admin progress job support.

### Phase 3 — web shell and pages

- Build the new global layout shell.
- Replace the old `Home` with a personal listening-room layout.
- Merge `All Music` into `Library` and remove the duplicate navigation model.
- Build the new Playlists, Player/Stage, Upload, and Admin sections.

### Phase 4 — responsive and large-screen QA

- Validate phones, tablets, laptops, 4K monitors, and 50" TV-sized layouts.
- Add Playwright viewport checks for overflow and clipping.
- Provide large-screen D-pad usability and living-room mode.

### Phase 5 — Android parity

- Rebuild the Android screens against the same IA and token set.
- Align the same mix and player behaviors.
- Keep the data model and API contracts consistent.

## Current risks and constraints

1. The current frontend is still monolithic, so the redesign must be done with a staged replacement rather than a single patch.
2. The app is already using a lot of behavioral logic in `App.jsx`; that needs to be moved into hooks/services rather than overwritten blindly.
3. GitHub Pages only supports static hosting, so routing must remain hash-based or a static rewrite strategy must be used.
4. Admin identity reporting depends on denormalized uploader fields and a human-readable user profile lookup; we must resolve that server-side rather than patching the UI only.
5. Large-screen TV layouts can break at 50" and wider, so the root scaling rules must be handled globally.

## Immediate next milestone

The next action is to establish the route shell, tokens, and query cache as the new design foundation before touching the more opinionated page-level redesign.
