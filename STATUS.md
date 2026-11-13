# Ahadi Phase 1 — status (12 Nov 2026)

## Verified

- `npm test`: 46 tests pass (unit + full flows on a real Postgres engine).
- `npm run build`: production build compiles with no type errors.
- Clicked through in a browser at 360 px wide: public event page → 3-screen pledge → mobile money status screen → mock approval with duplicate webhooks → receipt. Totals rose by exactly the pledged amount; one payment was recorded despite a double tap.
- Organizer pages (dashboard, share, ledger, committee, withdraw, settings) and CSV / Excel / PDF / event-day exports load; the CSV totals match the dashboard.
- Another organizer's event returns 403/404 through both the interface and the API.
- Luganda and Swahili switch every UI string; hospital events render the calm theme with no confetti.

## Login (updated 12 Nov 2026)

- **Phone:** 6-digit code sent on **WhatsApp** (Meta WhatsApp Business Platform, approved authentication template). If WhatsApp can't deliver, the code goes by SMS instead (`OTP_SMS_FALLBACK`).
- **Email:** 6-digit code by email (Resend), or **Continue with Google**. Google matches by Google account id, then by verified email, so an email-code account and Google with the same Gmail are one account.
- Email/Google users add and verify a phone (WhatsApp code) before withdrawing; a committee invite for that number is merged into their account.
- Codes are never stored in plain text or written to the message log; per-identifier rate limits and lockout apply to all channels.
- Not live yet: WhatsApp, email and Google run in "console" mode (codes show on screen in development) until the keys below are added.

## Messages on WhatsApp (updated 12 Nov 2026)

- Pledge confirmations, receipts, reminders, organizer milestones and committee invites go on **WhatsApp**, in the pledger's language (English or Swahili; Luganda readers get English because WhatsApp has no Luganda templates). Hospital/funeral events use the calm wording.
- **SMS safety net:** if WhatsApp refuses a message, or later reports it undelivered (e.g. the number has no WhatsApp), the SMS version goes out once. Turn off with `NOTIFY_SMS_FALLBACK=false`; turn WhatsApp off entirely in Admin → Settings (`whatsapp_messages_enabled`).
- Replying **STOP** on WhatsApp stops reminders. Delivery reports are recorded per message.
- 12 Utility templates × 2 languages must be approved by Meta first: see `docs/whatsapp-templates.md` (`npm run wa:templates` regenerates it).

## Homepage showcase and categories (updated 12 Nov 2026)

- Organizers choose **who is organising** (individual/family, group/committee, church/mosque, nonprofit/NGO, company, school) and can tick **"Show my event on the Ahadi homepage"** in the wizard or later in Settings.
- The homepage shows a **"Happening on Ahadi"** slideshow under folder tabs: All · Individuals & families · Churches & nonprofits · Companies & schools. It auto-advances every 5 s, pauses on hover/touch, is swipeable, and stays still for reduced-motion users. Only title, photo, type and progress are shown, and only for open, unfrozen events.
- Requests wait for an admin (Admin → Events: Show on homepage / Decline / Remove). Admins can switch review off (`home_requires_approval`) and set how many appear (`home_max_events`).
- **My events** has folder tabs: All · Celebrations · Support · Community & faith · Closed.

## Pledger verification: a one-time code for every pledge (updated 13 Nov 2026)

- Pledging needs no account and **no PIN or password**. Every pledge is verified with a **fresh 6-digit code** sent to the number (WhatsApp, SMS fallback). One code opens 15 minutes for that exact number and allows **one** pledge; the next pledge, even with the same number, needs a new code. Checked on the server.
- **A new code every time the pledger enters their portal:** the pledge form, My pledges, and the personal pledge link (from WhatsApp) all start locked. Moving inside the portal (pledge, receipt, payment) does not ask again; going back to an event page or the homepage ends the verification. The personal link and its actions (change amount, download / delete data) are refused without it, and the code always goes to the pledge's own number, shown masked.
- After the code, the pledger sees "Welcome back" with their summary: pledged so far / paid / still to pay, what is due next, and each pledge's status, due date, last payment and a Pay link. The My pledges page (/my) works the same way.
- **Fixed:** going back to an event after a "pay later" pledge reopened the old pledge. Opening the form now always starts a fresh, empty pledge.
- **Pledgers cannot stop reminders:** no button, no STOP replies, no opt-out wording. Reminders stop when the pledge is paid or the event closes. Deleting personal data still ends them.
- **Code limits:** while codes are shown on screen (test mode) there is no limit. Live: 30 seconds between codes to the same number, at most 10 per 10 minutes and 40 per day per number (Admin → Settings: otp_min_gap_seconds, otp_max_per_10min, otp_max_per_day). They stop someone flooding another person's WhatsApp and running up message costs.
- **Temporary codes:** with OTP_SHOW_ON_SCREEN=true (set now in .env.local) codes are shown on screen because WhatsApp/SMS is not connected. While on, anyone can confirm any number: set it to false before real users. The admin panel shows a warning while it is on.

## One login, the right portal (updated 13 Nov 2026)

- Everyone logs in the same way: phone number + one-time code (or email / Google for organizers). The number decides where they land:
  - runs events (any committee role) or admin → **organizer dashboard**, badge "Organizer", with a **My pledges** tab for their own pledges;
  - has only pledged → **pledger portal** (/my), badge "Pledger". No organizer account is created for them;
  - brand new → organizer sign-up. "Start an event" always signs in as an organizer.
- In the pledge form, after the code, a number that also runs events sees "Open my events dashboard". The pledger portal shows the same link.
- The per-entry code rule for pledgers is unchanged; the "Support Ahadi" tip at checkout is unchanged.
- **My pledges** has a **Slides / List** switch (remembered on the phone). Slides show one card per pledge with the organizer's cover photo (or the event's colour banner), status, progress, pledged / paid / still to pay and a Pay / Open button; no auto-play. Tapping a pledge opens its page (pay, change pledge, balance, receipts) without a second code during the same visit.
- Every event page has a **My pledges** button next to "Pledge now" / "Give support": it opens the pledger portal (code required) with all the pledger's pledges and their details.
- The "Support Ahadi" tip shows at checkout (Pay now / Pay part now) on weddings, birthdays and community events; it is off for hospital and funeral events, as specified in the brief.
- A back arrow is on every page except the homepage. Where there is no earlier Ahadi page, it goes one level up (event tab → event → My events → homepage).

## Acceptance checklist

| Item | State | Notes |
| --- | --- | --- |
| Sign up, create wedding, share in < 60 s | Done | OTP login → 4-step wizard (autosaved) → share page with WhatsApp + QR |
| Pledge and pay in 3 screens at 360 px | Done | Who → how much → confirm + pay |
| Double tap / refresh = one payment | Done, tested | Idempotency key + unique index + client re-entry guard |
| Webhook twice / late / out of order | Done, tested | Event-id dedupe + state machine + one-time ledger posting |
| Failed / expired / cancelled prompts | Done, tested | Clear message, "You were not charged", safe retry |
| Partial, overpayment, reduction balanced | Done, tested | |
| 07xx / +2567xx / 2567xx same person | Done, tested | |
| Manual entries audited, reversal only | Done, tested | DB triggers block edits/deletes |
| Reminders: quiet hours, opt-out, Kampala | Done, tested | |
| Hospital/funeral calm, second approver | Done, tested | Plus admin review and verification documents |
| Isolation between users (UI + API) | Done, tested | Server-side role checks on every action |
| Exports match dashboard | Done, tested | Same ledger functions |
| Offline: clear message, no data lost | Done | Drafts saved on the phone; requests wait for the connection and resend with the same key |
| Language switch changes every string | Mostly | All app screens and SMS templates. **Privacy and Terms pages are English only** (legal text needs a lawyer before translation) |
| Admin changes fees/prices without deploy | Done | Admin → Settings, applies on the next request |
| No console errors, tests pass | Mostly | Tests pass. The preview browser logged a service-worker fetch error; check in Chrome on a phone |

## Not done / needs you

0. **WhatsApp:** access token, phone number ID, the login (authentication) template and the 12 message templates approved by Meta, plus webhook verify token and app secret. **Email:** Resend API key + a verified sending domain. **Google:** (OAuth client ID and secret). See `.env.example`.

1. **ZengaPay and DPO adapters are stubs.** As the brief required, I did not invent endpoints. To build them I need: current official API docs, sandbox keys, callback / webhook format and how it is signed, fee schedule and prompt timeout. See `src/lib/payments/zengapay.ts` and `dpo.ts`.
2. **Africa's Talking SMS** adapter follows their public API but has not been tested with real keys.
3. **Luganda and Swahili are draft translations.** A native speaker must review `src/i18n/lg.ts` and `sw.ts` and the SMS templates in `src/lib/messages.ts`.
4. **Privacy policy and terms** are plain-language drafts; a Ugandan lawyer should review them, and the licensing question (who holds the money) must be settled before launch.
5. **Row-level security in Postgres** is not enabled; access is enforced in the server code (every route checks the role). Add RLS policies if you expose the database directly (e.g. Supabase client SDK).
6. **End-to-end browser tests (Playwright)** are not included; flows are covered by service-level tests plus the manual browser check above.
7. **WhatsApp reminders** fall back to SMS until the WhatsApp Business API is connected (Phase 2). WhatsApp *sharing* works now.
8. **Phase 2/3 items are prepared, not built:** recurring pledges (`pledges.recurrence`, `events.is_recurring`), institution plan (`plans`), digital invitations, vendor marketplace, partner offers.
9. **Performance on real 3G** was not measured. The first load is about 87 KB of shared JS plus the page (~110–120 KB in total); no web fonts are downloaded.

## Decisions I made (change any of them)

- Embedded Postgres (PGlite) for local runs so the app works with zero setup; real Postgres via `DATABASE_URL`.
- Fee 3% (min UGX 500), Event Pass UGX 50,000, 100 SMS for UGX 10,000, free tier 1 active event / 50 pledges. These are starting points only, all editable in Admin → Settings.
- A duplicate pledge does **not** reveal the existing pledge to whoever typed the number. The personal link is re-sent by SMS to that phone, and its owner updates the pledge there.
- The organizer's OTP-verified login number is their verified mobile money payout account. Bank accounts need admin verification (data model ready; no bank form yet).
- The first withdrawal for every organizer is reviewed by an admin. Hospital and funeral events also need a second committee member's approval and both documents verified.
