# AgriStore

AgriStore is a Kenyan farm-produce marketplace. The web client is a React/Vite app in [`Web/`](./Web/); the Express API and deployment package are in [`backend/`](./backend/). The Android app is a frozen legacy music player and is not part of the marketplace.

## Local development

```powershell
npm --prefix backend ci
npm --prefix Web ci
npm --prefix backend run dev
npm --prefix Web run dev
```

Configure local values using `backend/.env.example` and `Web/.env.example`. Do not commit `.env` files or place backend credentials in `VITE_*` variables. See [`Web/README.md`](./Web/README.md), [`backend/README.md`](./backend/README.md), and [`docs/`](./docs/) for details.

## Validation

```powershell
npm --prefix backend test
npm --prefix Web test
npm --prefix Web run build
npm --prefix Web run qa:layout
```

The Playwright layout command requires the Chromium browser installed for the repository's Playwright version. External Firebase, MongoDB, Cloudflare R2, and PesaPal flows require separately configured test services and credentials.

## Deployment overview

- GitHub Pages deploys the Web build from `.github/workflows/deploy-pages.yml`.
- Render deploys the API from the root `.render.yaml` blueprint, with the service root set to `backend`.
- Required GitHub Pages variables and Render environment values are documented in [`docs/GO-LIVE.md`](./docs/GO-LIVE.md).
- Do not enable live payments until the production checklist and PesaPal sandbox verification are complete.

The GitHub Pages project URL currently retains the repository path `/sonara/`; app navigation uses hash routes to work with static hosting. Changing the project URL requires updating the Vite base path and legacy-link redirect together.
