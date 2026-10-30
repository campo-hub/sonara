# AgriStore privacy policy recommendations

This is an implementation-informed checklist, not a publishable privacy notice or legal advice. Have qualified Kenyan counsel review it and complete the actual business identity, contact, lawful-basis, retention, transfer, and user-rights details before launch.

## Data and purposes

- Firebase Authentication identifiers, email, and verified status support sign-in and access control.
- Buyer/seller account profiles, seller business details, listing content, approximate listing coordinates, orders, reviews, and user-submitted listing reports support marketplace transactions, support, fraud prevention, moderation, and dispute handling.
- Product images are transformed by the API and stored in Cloudflare R2.
- PesaPal processes payment checkout data on its hosted payment service. AgriStore stores provider references, amount, currency, and payment state; the API does not accept or store card numbers.
- Security and operational logs support reliability, abuse prevention, and administrative auditability.

## Service providers and access

The current architecture may use Firebase, MongoDB hosting, Cloudflare R2, Render, GitHub Pages, and PesaPal. The operator must confirm the production provider list and disclose applicable processing/transfer details. Public users can read active available listings and seller-public-profile fields. Admin access is restricted by role and a verified email allowlist; admin mutations are recorded in the audit log.

## Retention and user requests

The application does not currently implement self-service account deletion, a full retention scheduler, or a privacy-request workflow. The operator must define retention periods for account, order/payment, report, and audit data; identify legally required record retention; and publish a contact and response process for access, correction, deletion, and objection requests as applicable.

## Publication checklist

- Verify the controller/business identity and privacy contact.
- Document purposes and lawful bases, recipients/processors, international transfers, retention periods, and security practices.
- Explain that listing locations are approximate and that users can choose whether to share coordinates.
- Explain hosted payments and the limits of platform settlement/refunds.
- State user rights and how to submit privacy requests or complaints.
- Review all wording against the Kenya Data Protection Act and applicable regulations with counsel.
