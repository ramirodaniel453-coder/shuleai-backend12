# V2032 Single Active Provider Parent Payment Lock

This integration keeps the existing multi-tenant payment provider setup and fixes the parent payment flow:

- One school/platform scope has one active provider.
- Parents do not choose providers.
- Parents send only child, amount, phone, and fee/invoice.
- Backend resolves the child school, active provider, credentials, and provider adapter.
- Parent responses do not expose checkout URLs, callback URLs, IPN URLs, or webhook URLs.
- Existing callback/IPN/webhook security and idempotency remain unchanged.
- Pesapal IPN registration remains per school.
- M-Pesa, Paystack, Flutterwave, Pesapal, Stripe, and manual providers are handled by the active provider engine; parents see one simple payment action plus manual fallback.
- Manual payments remain verified by finance before balances update.
