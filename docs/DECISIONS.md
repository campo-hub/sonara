# AgriStore Product Decisions

Decisions collected before Phase 5 implementation:

| Topic | Decision |
|---|---|
| Site identity | AgriStore; use a green-and-earth palette with a simple crop/leaf mark. |
| Marketplace direction | Serve buyers and sellers equally. |
| Delivery and fees | Buyer and seller agree delivery details and cost directly. |
| Listing moderation | Publish listings immediately; support reports and admin takedowns. |
| Commission | 0% at launch. |
| Minimum order | No platform-wide minimum; sellers set product minimums. |
| Cancellation and refunds | Allow cancellation before seller confirmation; after confirmation, route refund decisions through seller/admin review. |
| Phone authentication | Optional; users may use phone or another supported sign-in method. |
| Hosting | GitHub Pages for the Web frontend and Render for the backend API; target Render Free for initial testing. |
| Multi-seller checkout | Split a cart into one seller-specific order per seller. |
| Fractional quantity totals | Round each line total to the nearest whole KES amount. |

The existing hash-based Web routing is compatible with GitHub Pages static hosting. Revisit hosting and plan selection before production if deployment requirements change.

Frontend rebuild decisions:

| Topic | Decision |
|---|---|
| Browser routing on GitHub Pages | Use `BrowserRouter` with a GitHub Pages `404.html` redirect/restore shim. This preserves ordinary path URLs for PesaPal query parameters without changing the selected hosting provider. |
| Firebase Web configuration in CI | Read the public Firebase web configuration and API base URL from GitHub repository variables; do not retain the legacy Sonara Firebase config in the workflow. |
| SMS sign-in rollout | Keep the code behind `VITE_ENABLE_PHONE_AUTH`; default it to `false` until SMS cost and rollout are explicitly approved. |
