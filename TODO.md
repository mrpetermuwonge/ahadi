# Ahadi – To do before real users

These items were left for later on purpose (15 Nov 2026; items 6–7 added 17 Nov 2026). The app works for testing without them, but **none of them can be skipped before launch**.

## 1. Switch off on-screen codes
- [ ] In `.env.local` (and on the live server) set `OTP_SHOW_ON_SCREEN=false`.
- Why: in test mode the login and pledge codes appear on the screen and code limits are switched off. Anyone could log in to any number.
- Do this only **after** WhatsApp (item 4) works, or nobody will receive codes.

## 2. Set the real web address
- [ ] Set `APP_URL` to the live address, e.g. `APP_URL=https://ahadi.ug`.
- Why: links in WhatsApp messages, the event link, the QR code and the pledge card all use it. Today they point to `localhost:3000`, which only works on this computer.
- Also update the Google sign-in redirect and the WhatsApp webhook to use the new address (see `.env.example`).

## 3. Change the background-jobs secret
- [ ] Replace `CRON_SECRET=change-me-cron-secret` with a long random value (at least 32 characters).
- Why: anyone who knows it can trigger reminders and payment jobs.
- If the host runs its own scheduler instead of the built-in one (`INTERNAL_CRON=false`, e.g. Vercel), set it to call:
  - `POST {APP_URL}/api/cron/reminders` every 15 minutes
  - `POST {APP_URL}/api/cron/pending` every 2 minutes
  - `POST {APP_URL}/api/cron/reconcile` daily at 02:00 Kampala time
  - each with the header `x-cron-secret: <your secret>`

## 4. Connect WhatsApp and the payment providers
- [ ] **WhatsApp Business API (Meta):** access token, phone number ID, the login (authentication) template and the 12 message templates approved by Meta, webhook verify token and app secret. Templates are listed in `docs/whatsapp-templates.md`.
- [ ] **ZengaPay and DPO:** the adapters are stubs. Needed: official API docs, sandbox keys, callback/webhook format and signing, fee schedule, prompt timeout. Files: `src/lib/payments/zengapay.ts`, `src/lib/payments/dpo.ts`. Then set `PAYMENT_PROVIDERS` (it is `mock` today).
- [ ] Optional: email (Resend API key and a verified domain), Google sign-in (OAuth client ID and secret), Africa's Talking SMS keys for the SMS fallback.

## 5. Move to a hosted database
- [ ] Create a managed PostgreSQL database (e.g. Supabase, Neon, Railway, AWS RDS) and set `DATABASE_URL`.
- Why: the built-in database (PGlite, folder `.data`) is for one computer only. It has no automatic backups and can't be shared by several servers.
- The same migrations (`db/migrations`) run on the new database at start-up. Turn on daily backups.

## 6. Operations to switch on (built in v1.22, need your accounts)
- [ ] **Error alerts:** create an incoming webhook in Slack, Teams, Discord or Google Chat and put its URL in `ALERT_WEBHOOK_URL`.
- [ ] **Uptime monitor:** sign up for a free monitor (e.g. UptimeRobot or Better Stack) and point it at `{APP_URL}/api/health` every 1–5 minutes.
- [ ] **Off-site backups:** the app backs itself up every night to `.data/backups` (keeps 14). Copy that folder to Google Drive / OneDrive automatically. Restore with `npm run db:restore -- <file>` (see `scripts/restore-backup.ts`). With a hosted database (item 5), turn on the provider's daily backups instead.
- [ ] **Several servers?** The speed limits are counted per server. If you run more than one server, move them to a shared store (e.g. Redis).
- [ ] **Behind a proxy or load balancer:** make sure it sets `X-Forwarded-For`, and that the app is not reachable directly (otherwise people can fake their IP for the speed limits).

## 6b. Replace the demo staff
- [ ] Add real staff numbers in Admin → Team (at least two Super admins), then remove the demo numbers 0700 000 001–005 and take `0700000001` out of `ADMIN_PHONES`.

## 7. Data protection (Uganda Data Protection and Privacy Act, 2019)
- [ ] Register Ahadi with the Personal Data Protection Office (PDPO) as a data collector/processor.
- [ ] Name a data protection officer and a contact address for privacy requests (shown in the privacy policy).
- [ ] Have a lawyer confirm the retention periods in `src/lib/privacy.ts` (money records 7 years; codes, visits and message wording removed earlier).
- [ ] When the privacy policy or terms change, update `PRIVACY_VERSION` in `src/lib/privacy.ts` so new agreements are recorded with the new version.
- [ ] Ask each payment provider and WhatsApp/SMS provider for their data-processing agreement.

## Also before launch (from STATUS.md)
- [ ] A native speaker reviews the Luganda and Swahili wording (`src/i18n/lg.ts`, `src/i18n/sw.ts`).
- [ ] A Ugandan lawyer reviews the privacy policy and terms, and the licensing question (who holds the money) is settled.
