# Payments, delivery, and payouts

## Checkout and payment

1. The buyer submits product IDs, quantities, and delivery details. Product prices and stock are re-read by the API.
2. The API reserves stock for 15 minutes and creates one order per seller in a multi-seller cart.
3. Each order is paid separately through a PesaPal hosted checkout.
4. The browser return does not establish payment success. The API queries PesaPal from the IPN flow and checks transaction status, merchant reference, amount, and KES currency before updating an order.
5. Expired reservations are released. A late successful payment or a cancellation after payment may require manual reconciliation.

PesaPal configuration is backend-only. Sandbox testing must precede live configuration. Live production requires the live environment, HTTPS callback/IPN URLs, a registered IPN ID, and current provider credentials.

## Fees and seller settlement

The recorded launch policy is **0% platform commission**. The platform does not add or collect delivery fees. The buyer and seller agree on pickup/delivery arrangements directly.

The current integration does not implement split settlement, escrow, automated seller payouts, or automatic refunds. Payments go to the configured merchant account. Before taking live orders, the business owner must decide and document the seller settlement process, payout timing, reconciliation owner, refund authority, and dispute escalation. Do not represent a seller as automatically paid by this software.

## Operational checks

- Reconcile PesaPal transactions to order IDs, merchant references, amounts, and currencies.
- Monitor orders in `pending_payment`, late IPNs, `disputed`, and paid cancellations.
- Resolve payout/refund discrepancies manually, preserving provider references and audit records.
- Never store card details in AgriStore; payment entry is hosted by PesaPal.
