# Ahadi — pledges you can trust (Phase 1)

Mobile-first web app (installable PWA) for collecting, tracking and fulfilling pledges for weddings,
birthdays, hospital bills, funerals and community drives. Uganda first (UGX, Africa/Kampala, +256),
built so Kenya, Tanzania and Rwanda are a configuration change (`src/lib/countries.ts`).

**Stack:** Next.js 14 (App Router) + TypeScript + Tailwind · PostgreSQL (embedded PGlite for local use,
any Postgres/Supabase in production) · pdf-lib / ExcelJS for exports · Vitest.

## Run it locally (no database or payment keys needed)

Requires Node.js 20 or newer.

```bash
npm install
cp .env.example .env.local
npm run db:seed        # demo wedding, hospital and funeral events
npm run dev            # http://localhost:3000
```

- Log in with a phone number (code by WhatsApp) or an email address (code by email, or "Continue with Google" once configured). In development the 6-digit code is shown on screen and printed in the terminal, because the WhatsApp and email providers are set to `console`.
- Demo organizers: wedding `0772 100 200`, hospital `0752 300 400`, funeral `0782 500 600`. Admin: `0700 000 001` (from `ADMIN_PHONES`).
- Payments use the **mock gateway**. On the "Check your phone" screen a yellow *Test gateway* box lets you approve, decline, time out, or send duplicate / out-of-order webhooks.
- `npm run db:reset` wipes the local database. Stop the dev server before seeding or resetting (the embedded database allows one process at a time).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm test` | Unit + flow tests (ledger, idempotency, webhooks, payouts, reminders, permissions, exports, i18n) |
| `npm run typecheck` | TypeScript check |
| `npm run db:migrate` / `db:seed` / `db:reset` | Database tasks |

## Deploying

1. Create a PostgreSQL database (Supabase, Neon, RDS…) and set `DATABASE_URL`. Migrations in `db/migrations` run automatically on first request (or `npm run db:migrate`).
2. Set `APP_URL`, a long random `APP_SECRET`, `CRON_SECRET`, `ADMIN_PHONES`.
3. Login codes: WhatsApp (`WHATSAPP_PROVIDER=meta` + token, phone number id, approved authentication template), email (`EMAIL_PROVIDER=resend` + `RESEND_API_KEY`, `EMAIL_FROM`), Google (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, redirect URI `{APP_URL}/api/auth/google/callback`). See `.env.example`.
   SMS: set `SMS_PROVIDER=africastalking` with `AT_USERNAME`, `AT_API_KEY`, `AT_SENDER_ID` (confirm the API against Africa's Talking's current docs).
4. Schedule the background jobs (any scheduler that can send an HTTP POST with header `x-cron-secret`):
   - `POST /api/cron/pending` every 2 minutes — re-checks pending mobile money prompts, expires stale ones, confirms payouts
   - `POST /api/cron/reminders` every 15 minutes — sends due reminders (quiet hours 21:00–07:00 Kampala)
   - `POST /api/cron/reconcile` daily at 02:00 Kampala — ledger vs gateway reconciliation
5. Deploy to any Node host (Vercel, Render, Railway, a VPS with `npm run build && npm start`). Files (cover photos, documents) are stored in Postgres; move them to object storage when volume grows.
6. Keep `PAYMENT_PROVIDERS=mock` until the ZengaPay / DPO adapters are implemented and tested in sandbox. **Remove `mock` in production.**

## How money is kept correct

- Amounts are integers in the smallest unit (UGX has no decimals) with a currency code.
- **Double-entry ledger** (`src/lib/ledger.ts`): every journal balances to zero, rows are append-only (a database trigger blocks UPDATE/DELETE), mistakes are fixed by reversing journals. Each business fact posts at most once (unique `kind + source`).
- A payment is marked paid only by a verified webhook or server-side status call **and** an exact amount/currency match. The browser never decides.
- Every payment request has an idempotency key; double taps, refreshes and offline resends return the same payment. Webhooks are de-duplicated by provider event id, and the state machine ignores stale/out-of-order events.
- Dashboard, exports and admin all read totals from the same ledger functions, so they always match.
- Payout requests place a hold on the funds; failures and rejections reverse the hold.

## Project map

```
db/migrations/        SQL schema (tables, append-only triggers)
src/lib/ledger.ts     double-entry ledger + read models
src/lib/payments/     PaymentProvider interface, mock, ZengaPay + DPO stubs, router with fallback
src/lib/services/     auth (OTP), events, pledges, payments, payouts, milestones, jobs
src/lib/settings.ts   admin-editable fees, prices, limits, flags
src/i18n/             en / lg / sw dictionaries (every visible string)
src/app/              pages and API routes
tests/                Vitest unit + flow tests
scripts/              migrate, seed, reset
```

See `STATUS.md` for what is done, what is not, and what is needed from you.
