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
| Listing report policy | Signed-in users can report a public active listing once per account; admins may remove a reported listing with a required reason and audit record. |
| Seller payouts | Automated seller payouts are not implemented; the operator must document a manual settlement and reconciliation process before live transactions. |

The existing hash-based Web routing is compatible with GitHub Pages static hosting. Revisit hosting and plan selection before production if deployment requirements change.

Frontend rebuild decisions:

| Topic | Decision |
|---|---|
| Browser routing on GitHub Pages | Use `BrowserRouter` with a GitHub Pages `404.html` redirect/restore shim. This preserves ordinary path URLs for PesaPal query parameters without changing the selected hosting provider. |
| Firebase Web configuration in CI | Read the public Firebase web configuration and API base URL from GitHub repository variables; do not retain the legacy Sonara Firebase config in the workflow. |
| SMS sign-in rollout | Keep the code behind `VITE_ENABLE_PHONE_AUTH`; default it to `false` until SMS cost and rollout are explicitly approved. |

## Proposal-alignment implementation assumptions (2026-10-30)

| Topic | Decision |
|---|---|
| Proposal source | The referenced PDF is not in the repository/workspace. The alignment table maps the requirement names and scope supplied in the task, not unprovided verbatim Appendix II–IV language. |
| Similar-product identity | Compare same-category listings whose titles match after Unicode normalization, lowercasing, and punctuation/spacing normalization. County is an optional additional filter. |
| Messaging | A conversation is unique per buyer/seller pair and product. Messages are plain text, capped at 2,000 characters, and the Web thread polls every five seconds instead of using WebSockets/SSE. |
| Message review | Participants can report a conversation; an administrator may read its messages only while reviewing an open report. |
| Category records | Seeded category identifiers remain stable when their display names change. A category cannot be deleted while products reference its identifier. |
| External notification delivery | The in-app feed is authoritative. Email is an opt-in adapter webhook and SMS is an opt-in Africa's Talking REST adapter; neither was configured or live-tested. |
| Admin dashboard reports | GMV counts orders in paid and later non-refunded lifecycle states. Payout totals read the future `payouts` collection and are zero/empty until payout code exists. |
| Admin user scope | The current console lists user summaries and supports the existing seller suspension/verification operations. It does not expose arbitrary role assignment. |
