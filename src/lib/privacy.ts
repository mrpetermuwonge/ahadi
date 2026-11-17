/**
 * Version of the privacy notice and terms that people agree to. Change it whenever /privacy or /terms change
 * in a meaningful way; each pledge and each new account records the version that was accepted.
 */
export const PRIVACY_VERSION = '2026-11-17';

/**
 * How long Ahadi keeps operational data (days). Money records (ledger, payments, receipts, audit log) are kept
 * for 7 years for accounting and anti-fraud duties and are never removed by the clean-up job.
 */
export const RETENTION = {
  otpCodesDays: 1, // one-time codes (already useless after 5 minutes)
  expiredSessionsDays: 1,
  pledgerVisitsDays: 7, // short "portal visit" records
  messageBodiesDays: 365, // message wording is blanked; who/when/status stay for delivery questions
  webhookPayloadsDays: 180,
  oauthStatesDays: 1,
} as const;
