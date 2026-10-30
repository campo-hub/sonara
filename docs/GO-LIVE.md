# AgriStore go-live checklist

This checklist is not a declaration that the service is production-ready. Mark items complete only after the responsible operator has observed the live result.

## Accounts, secrets, and hosting

- [ ] Rotate credentials previously present in local development configuration: Cloudflare R2 keys, Firebase service-account key, and MongoDB password. Do not paste replacements into source or chat.
- [ ] Configure Render secrets for MongoDB, Firebase Admin, R2, and the verified admin email allowlist.
- [ ] Use a production MongoDB database and verify indexes, backups, restore procedure, and access restrictions.
- [ ] Configure GitHub repository variables for `VITE_API_URL` and public Firebase web settings before enabling Pages deployment.
- [ ] Confirm the Firebase authorized domain and production authentication providers.
- [ ] Confirm Render `CORS_ORIGIN` is the exact Pages origin (host only; no project path).
- [ ] Confirm image R2 bucket CORS, access policy, lifecycle, and public URL behavior.
- [ ] Configure HTTPS callback and IPN endpoints; register the PesaPal IPN and store its ID in Render.
- [ ] Complete PesaPal sandbox orders, failure/cancel, duplicate-IPN, amount-mismatch, and late-IPN checks before setting live credentials.
- [ ] Decide the merchant-account-to-seller payout/reconciliation workflow; automated seller payouts are not implemented.

## Product and legal operations

- [ ] Review the privacy and seller/buyer terms drafts with qualified counsel for Kenyan law, consumer protection, tax, and data-protection duties.
- [ ] Publish final privacy notice, terms, cancellation/refund, prohibited-items, and dispute policies before onboarding users.
- [ ] Verify the report/takedown queue, admin authorization, audit persistence, seller appeal/contact path, and response-time ownership.
- [ ] Choose whether listings should be moderated before publication (`MODERATE_LISTINGS=true`) or published immediately.
- [ ] Confirm support contact, incident response owner, order escalation and manual refund process.

## Release verification

- [ ] Backend and Web test suites pass on the release commit.
- [ ] Production Web build and Playwright layout matrix pass with Chromium at 390/800/1100/1440 px and light/dark themes.
- [ ] Run a real Firebase buyer/seller/admin journey against a configured staging API and database.
- [ ] Verify seller upload, checkout, multi-seller orders, payment confirmation, delivery completion, review eligibility, report/takedown, CSV export, and audit log.
- [ ] Confirm backend and Web npm audits report 0 vulnerabilities on the release commit.
- [ ] Verify the deployed health endpoint, Pages deep links, monitoring/log access, backup restore, and rollback procedure.
- [ ] Keep the pull request unmerged until an authorized reviewer approves release.

## Current known verification gaps

- The automated Playwright browser is not installed in the current development environment; Chromium download attempts timed out.
- Firebase, MongoDB, Cloudflare R2, and PesaPal sandbox services are not configured here.
- External-service flows and MongoDB-backed persistence therefore remain unverified.
- The latest backend production and Web npm audits report 0 vulnerabilities; rerun both audits on the release commit.
