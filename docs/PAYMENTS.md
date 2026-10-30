# E-TAWELCO

This project uses environment variables for both Supabase auth and payment processing.

## Required runtime variables

Copy `.env.example` to `.env.local` for local development, or set the same variables in your host environment (Vercel/Netlify) before deployment.

### Supabase
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

### PayMongo
- `PAYMONGO_SECRET_KEY`
- `PAYMONGO_PUBLIC_KEY`
- `PAYMONGO_WEBHOOK_SECRET`

These variables are server-side only. Do not expose them in browser code or frontend bundles.

### Demo payments toggle
- `DEMO_PAYMENTS`

Keep this set to `false` unless you intentionally want the demo simulated payment route to be active.

## Security notes
- Never commit real secrets.
- Do not use the service-role key in browser code.
- Webhook signature verification must read the raw request body before parsing JSON.
- The demo payment flow remains a safety-limited stub and must not be used for production billing without explicit authorization and a full live provider integration.
