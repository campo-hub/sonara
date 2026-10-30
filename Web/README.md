# AgriStore Web

The marketplace frontend uses React, Vite, React Router, and modular Firebase Authentication. The app entry point is `src/main.jsx`; marketplace pages, components, hooks, styles, translations, and API helpers live under `src/marketplace/`.

## Local setup

```powershell
npm ci
npm run dev
```

Copy `.env.example` to `.env.local` and configure the public Firebase web settings and `VITE_API_URL`. Public Firebase web configuration is not an API secret; Firebase security must be enforced by Authentication rules and the backend. Never put service-account keys, R2 credentials, MongoDB strings, or PesaPal secrets in `VITE_*` variables.

Phone sign-in is disabled unless `VITE_ENABLE_PHONE_AUTH=true` is explicitly enabled and Firebase phone authentication is configured.

## Checks

```powershell
npm test
npm run build
npm run qa:layout
```

The layout check opens 390, 800, 1100, and 1440 pixel viewports in light and dark color schemes. It requires the Playwright Chromium browser. Set `AGRI_WEB_URL` to test a locally running preview or deployed app; otherwise it uses `http://127.0.0.1:5173`.

## Hosting paths

GitHub Pages currently serves the repository project site at `/sonara/`. Vite assets use that base, and application routes use hash URLs (for example `/#/browse?sort=newest`) so page navigation and refreshes do not request unsupported static paths. A custom `public/404.html` redirects older path-style links. Keep both in sync if the repository or Pages URL changes.
