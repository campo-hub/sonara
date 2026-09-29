# Privacy policy recommendations

This document is a working recommendation for the owner. It should be reviewed by counsel before publication.

## Data collected and why

- Firebase authentication: sign-in status, UID, email, and email verification state are used to secure access and identity-bound features.
- MongoDB profile data: username, createdAt, and contact metadata support account setup and profile display.
- Listening analytics: playback events are collected to estimate usage, active-user engagement, and top content trends. The raw event payload includes a pseudonymous listener hash, not a direct user identifier.
- Library preferences: favorites, theme, volume, playback, and device preferences are stored to personalize the app on the account and device.
- Upload metadata: title, artist, album, duration, uploader identity, and file size are stored to support the catalog and storage-cost reporting.
- Cloudflare R2 storage metadata: bucket usage and file size are used for storage accounting and admin-only cost estimation.

## Pseudonymous listener IDs

The `listener` field is a pseudonymous HMAC derived from a user identifier and a server secret. It is used only to count unique listeners and active users. It must never be exposed through public or admin APIs, and admin dashboards should only show aggregate analytics.

## Retention

- Raw listen events should be retained for a limited period, recommended at 400 days, as described in the product requirements.
- Daily rollups and aggregate analytics may be retained longer for trend reporting.
- Playlist content and account library data should be kept only while the account remains active and should be deleted when the account is deleted.

## Access boundaries

- Playlist contents are private to the owner. Admin users should never receive names or details for another user's playlists.
- Aggregated analytics may be visible to admins, but they should never reveal a specific user’s listening history, email, username, or listener hash.
- Identity-bearing tables in Users/Storage & Costs should be restricted to admin-only views and should present names or emails only where that level of access is required as a business control.

## Opt-out

Users should be offered a clear toggle for anonymous analytics sharing. When disabled, the client should avoid sending listen events and the backend should reject any that are still transmitted.

## Account deletion

When a user deletes their account, the system should delete or anonymize the following data:

- playlists owned by the user
- user profile and stored username/email association
- favorites and preference data
- listen events linked to the pseudonymous user hash
- uploaded track metadata associated with the account, if the account is the uploader and policy allows it

If a deletion hook is not yet implemented, the owner should add a backend cleanup task or service that executes the same steps at account removal time.

## Third-party processors

The product likely relies on the following third parties:

- Firebase Authentication and Firebase Admin
- MongoDB Atlas or a MongoDB hosting service
- Cloudflare R2 storage
- Render hosting

The policy should disclose those processors and the categories of personal data they process.

## Data protection notices

The owner should confirm whether, and to what extent, a local data-protection registration or notice obligation applies in Kenya (for example under the Data Protection Act). A qualified lawyer should confirm whether the current app and processing categories require a formal notice or registration filing.

## Recommended wording

The owner should state plainly:

- what data is collected and why
- that listening analytics are aggregated and pseudonymized
- that raw listening data is retained for a limited period
- that playlists are private to their owner
- that admins can see aggregate analytics and limited identity metadata only where needed
- that users can opt out of anonymous usage statistics
- how account deletion removes or anonymizes related data
- which third-party providers process the data
