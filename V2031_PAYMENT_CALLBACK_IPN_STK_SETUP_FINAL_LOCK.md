# V2031 Payment Callback/IPN/STK Setup Final Lock

Build: `2042-database-truth-roster-integrity-lock`

This integration fixes payment setup URLs and parent STK behavior without changing payment finalization security.

## Locked changes
- Payment callback/IPN URLs are generated only from `PUBLIC_API_BASE_URL`.
- Old Render fallback domains are rejected for payment callback/IPN generation.
- Provider cards auto-show Website Domain, Notification/Callback URL, M-Pesa STK/C2B URLs, setup status, and STK test status.
- Pesapal IPN setup registers/lists the correct `https://api.shuleai.live/api/payments/webhook/pesapal` URL and saves the per-school IPN ID.
- Blank secret fields preserve existing encrypted provider secrets.
- Checkout/test link is no longer shown as a webhook URL. Test links/status are generated only by real test actions.
- Admin/finance can run Test STK Push; test payments do not update student balances.
- Parent school-fee online payment is STK-only and uses `POST /api/payments/parent/stk/initiate`.
- Parents never see callback, webhook, IPN, or checkout URLs.
- Manual payment verification remains available and unchanged.

## Required env
`PUBLIC_API_BASE_URL=https://api.shuleai.live`
