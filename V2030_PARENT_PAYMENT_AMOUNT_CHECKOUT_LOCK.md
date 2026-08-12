# V2030 Parent Payment Amount Checkout Lock

Build: `2042-database-truth-roster-integrity-lock`
Backend package version: `2.1.525`

This integration adds the missing parent school-fee amount-to-pay checkout workflow while preserving the v2029 multi-tenant provider/IPN setup.

## Locked behavior

- Parent selects child and fee/invoice.
- Parent sees outstanding balance.
- Parent can choose full balance, half, or custom amount.
- Parent can trigger STK/online checkout using the selected amount.
- Manual payment also requires amount and reference.
- Backend validates parent-child ownership, selected fee account, amount > 0, and amount <= outstanding balance unless overpayment is explicitly allowed.
- Backend creates a pending payment before provider prompt/checkout.
- Webhooks or finance verification are still the only paths that update balances.

## Preserved

- Provider/IPN automation.
- Manual verification queue.
- Webhook security.
- Multi-tenant school provider separation.
- Report cards, analytics, auth, tenant isolation.
