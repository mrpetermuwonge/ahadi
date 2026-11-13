-- Ahadi Phase 1 schema.
-- Money is always BIGINT in the smallest currency unit, paired with a currency code.
-- UGX has no minor unit, so 50,000 UGX is stored as 50000.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  phone         TEXT NOT NULL UNIQUE,            -- E.164, e.g. +256772123456
  name          TEXT,
  is_admin      BOOLEAN NOT NULL DEFAULT FALSE,
  locale        TEXT NOT NULL DEFAULT 'en',
  referred_by   TEXT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE otp_codes (
  id            TEXT PRIMARY KEY,
  phone         TEXT NOT NULL,
  code_hash     TEXT NOT NULL,
  attempts      INT NOT NULL DEFAULT 0,
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX otp_codes_phone_idx ON otp_codes(phone, created_at DESC);

CREATE TABLE login_lockouts (
  phone         TEXT PRIMARY KEY,
  failures      INT NOT NULL DEFAULT 0,
  locked_until  TIMESTAMPTZ
);

CREATE TABLE sessions (
  token_hash    TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE files (
  id            TEXT PRIMARY KEY,
  owner_user_id TEXT REFERENCES users(id),
  mime          TEXT NOT NULL,
  size_bytes    INT NOT NULL,
  data          BYTEA NOT NULL,
  is_public     BOOLEAN NOT NULL DEFAULT FALSE,   -- cover images are public, invoices / IDs are not
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE events (
  id              TEXT PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  type            TEXT NOT NULL,                  -- wedding | birthday | hospital | funeral | community | other
  status          TEXT NOT NULL DEFAULT 'active', -- draft | active | closed
  title           TEXT NOT NULL,
  event_date      DATE,
  story           TEXT NOT NULL DEFAULT '',
  details         JSONB NOT NULL DEFAULT '{}',    -- type-specific fields (couple names, hospital, venue ...)
  cover_file_id   TEXT REFERENCES files(id),
  currency        TEXT NOT NULL DEFAULT 'UGX',
  country         TEXT NOT NULL DEFAULT 'UG',
  target_amount   BIGINT,
  privacy         TEXT NOT NULL DEFAULT 'hidden_list', -- hidden_list | public_list
  urgent          BOOLEAN NOT NULL DEFAULT FALSE,
  frozen          BOOLEAN NOT NULL DEFAULT FALSE,
  verified        BOOLEAN NOT NULL DEFAULT FALSE,
  reminder_offsets INT[] NOT NULL DEFAULT '{7,1,0,-3}', -- days before due date (negative = after)
  whatsapp_reminders BOOLEAN NOT NULL DEFAULT FALSE,
  tips_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  milestones_sent INT[] NOT NULL DEFAULT '{}',
  is_recurring    BOOLEAN NOT NULL DEFAULT FALSE, -- Phase 2 (institution drives); modelled now
  created_by      TEXT NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE event_members (
  event_id      TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id),
  role          TEXT NOT NULL,                    -- owner | treasurer | viewer
  added_by      TEXT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE pledgers (
  id            TEXT PRIMARY KEY,
  phone         TEXT NOT NULL UNIQUE,            -- E.164; reusable across events
  name          TEXT NOT NULL,
  opted_out     BOOLEAN NOT NULL DEFAULT FALSE,  -- stop all reminders
  consent_at    TIMESTAMPTZ NOT NULL,
  deleted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pledges (
  id              TEXT PRIMARY KEY,
  event_id        TEXT NOT NULL REFERENCES events(id),
  pledger_id      TEXT NOT NULL REFERENCES pledgers(id),
  access_token    TEXT NOT NULL UNIQUE,           -- personal link for the pledger
  amount          BIGINT NOT NULL CHECK (amount > 0), -- current promised amount (mirrors ledger; ledger is the truth)
  currency        TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  anonymous       BOOLEAN NOT NULL DEFAULT FALSE,
  message         TEXT,
  message_status  TEXT NOT NULL DEFAULT 'pending', -- pending | approved | hidden
  pay_plan        TEXT NOT NULL,                  -- now | part | later
  due_date        DATE,
  recurrence      JSONB,                          -- Phase 2: {"interval":"monthly","count":12}
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, pledger_id)                   -- duplicate detection: one pledge per phone per event
);

CREATE TABLE pledge_change_requests (
  id            TEXT PRIMARY KEY,
  pledge_id     TEXT NOT NULL REFERENCES pledges(id),
  new_amount    BIGINT NOT NULL CHECK (new_amount > 0),
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  decided_by    TEXT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at    TIMESTAMPTZ
);

CREATE TABLE payments (
  id                TEXT PRIMARY KEY,
  idempotency_key   TEXT NOT NULL UNIQUE,         -- double tap / refresh returns the same payment
  purpose           TEXT NOT NULL,                -- pledge | event_pass | sms_credits
  event_id          TEXT REFERENCES events(id),
  pledge_id         TEXT REFERENCES pledges(id),
  user_id           TEXT REFERENCES users(id),    -- buyer for passes / credits
  provider          TEXT NOT NULL,
  method            TEXT NOT NULL,                -- mtn | airtel | card
  payer_phone       TEXT,
  currency          TEXT NOT NULL,
  pledge_credit     BIGINT NOT NULL DEFAULT 0,    -- amount credited to the pledge
  fee               BIGINT NOT NULL DEFAULT 0,    -- Ahadi transaction fee
  fee_covered       BOOLEAN NOT NULL DEFAULT FALSE, -- pledger paid the fee on top
  tip               BIGINT NOT NULL DEFAULT 0,
  charged_amount    BIGINT NOT NULL CHECK (charged_amount > 0), -- exactly what the payer is asked to pay
  status            TEXT NOT NULL DEFAULT 'created', -- created | pending | succeeded | failed | expired | refunded
  provider_ref      TEXT,                         -- provider transaction id
  failure_reason    TEXT,
  receipt_no        TEXT UNIQUE,
  redirect_url      TEXT,
  meta              JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  succeeded_at      TIMESTAMPTZ
);
CREATE INDEX payments_pledge_idx ON payments(pledge_id);
CREATE INDEX payments_status_idx ON payments(status, created_at);

CREATE TABLE payment_attempts (
  id            TEXT PRIMARY KEY,
  payment_id    TEXT NOT NULL REFERENCES payments(id),
  action        TEXT NOT NULL,                    -- initiate | status_check | webhook
  request       JSONB,
  response      JSONB,
  ok            BOOLEAN NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE webhook_events (
  provider      TEXT NOT NULL,
  event_id      TEXT NOT NULL,
  payload       JSONB NOT NULL,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, event_id)                -- replayed webhooks are ignored
);

-- Double-entry ledger. A journal groups lines whose amounts sum to zero (debit +, credit -).
CREATE TABLE ledger_journals (
  id              TEXT PRIMARY KEY,
  event_id        TEXT REFERENCES events(id),
  kind            TEXT NOT NULL,   -- pledge | pledge_change | payment | manual_payment | payout_hold | payout_paid | payout_release | refund | reversal | pass | credits
  source_type     TEXT NOT NULL,   -- pledge | payment | payout | manual | change_request | journal
  source_id       TEXT NOT NULL,
  reverses_id     TEXT REFERENCES ledger_journals(id),
  memo            TEXT,
  receipt_no      TEXT,
  created_by      TEXT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kind, source_type, source_id)           -- each business fact is posted exactly once
);

CREATE TABLE ledger_entries (
  id            BIGSERIAL PRIMARY KEY,
  journal_id    TEXT NOT NULL REFERENCES ledger_journals(id),
  event_id      TEXT REFERENCES events(id),
  pledge_id     TEXT REFERENCES pledges(id),
  account       TEXT NOT NULL,
  amount        BIGINT NOT NULL,                  -- debit positive, credit negative
  currency      TEXT NOT NULL
);
CREATE INDEX ledger_entries_event_idx ON ledger_entries(event_id, account);
CREATE INDEX ledger_entries_pledge_idx ON ledger_entries(pledge_id, account);

-- Ledger rows are append-only: no update or delete, ever. Corrections are reversing journals.
CREATE OR REPLACE FUNCTION ledger_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger is append-only; post a reversing entry instead';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER ledger_entries_no_change BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_append_only();
CREATE TRIGGER ledger_journals_no_change BEFORE UPDATE OR DELETE ON ledger_journals
  FOR EACH ROW EXECUTE FUNCTION ledger_append_only();

CREATE TABLE fees (
  id            TEXT PRIMARY KEY,
  payment_id    TEXT NOT NULL UNIQUE REFERENCES payments(id),
  event_id      TEXT REFERENCES events(id),
  fee_percent   NUMERIC(5,2) NOT NULL,
  amount        BIGINT NOT NULL,
  tip           BIGINT NOT NULL DEFAULT 0,
  currency      TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payout_accounts (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  kind          TEXT NOT NULL,                    -- mobile_money | bank
  label         TEXT NOT NULL,
  phone         TEXT,
  bank_name     TEXT,
  account_no    TEXT,
  account_name  TEXT,
  verified      BOOLEAN NOT NULL DEFAULT FALSE,   -- mobile money = owner's own OTP-verified phone; bank = admin check
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payouts (
  id              TEXT PRIMARY KEY,
  event_id        TEXT NOT NULL REFERENCES events(id),
  account_id      TEXT NOT NULL REFERENCES payout_accounts(id),
  amount          BIGINT NOT NULL CHECK (amount > 0),
  currency        TEXT NOT NULL,
  status          TEXT NOT NULL,                  -- awaiting_second_approval | in_review | processing | paid | failed | rejected
  requested_by    TEXT NOT NULL REFERENCES users(id),
  second_approver TEXT REFERENCES users(id),
  reviewed_by     TEXT REFERENCES users(id),
  provider        TEXT,
  provider_ref    TEXT,
  failure_reason  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reminder_templates (
  id            TEXT PRIMARY KEY,
  event_type    TEXT NOT NULL,                    -- or '*'
  locale        TEXT NOT NULL,
  stage         TEXT NOT NULL,                    -- before | due | after | thanks | milestone | invite
  body          TEXT NOT NULL,                    -- {name} {event} {amount} {balance} {date} {link}
  UNIQUE (event_type, locale, stage)
);

CREATE TABLE reminders (
  id            TEXT PRIMARY KEY,
  pledge_id     TEXT NOT NULL REFERENCES pledges(id),
  channel       TEXT NOT NULL DEFAULT 'sms',      -- sms | whatsapp
  stage         TEXT NOT NULL,
  send_at       TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL DEFAULT 'scheduled', -- scheduled | sent | skipped | failed
  skip_reason   TEXT,
  sent_at       TIMESTAMPTZ,
  UNIQUE (pledge_id, stage, send_at)
);
CREATE INDEX reminders_due_idx ON reminders(status, send_at);

CREATE TABLE messages_log (
  id            TEXT PRIMARY KEY,
  channel       TEXT NOT NULL,
  to_phone      TEXT NOT NULL,
  body          TEXT NOT NULL,
  purpose       TEXT NOT NULL,
  event_id      TEXT,
  status        TEXT NOT NULL,                    -- sent | failed | logged
  provider_ref  TEXT,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE verifications (
  id            TEXT PRIMARY KEY,
  event_id      TEXT REFERENCES events(id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  kind          TEXT NOT NULL,                    -- organizer_id | invoice | institution
  file_id       TEXT REFERENCES files(id),
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  note          TEXT,
  reviewed_by   TEXT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reports (
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL REFERENCES events(id),
  source        TEXT NOT NULL,                    -- user | system
  reason        TEXT NOT NULL,
  reporter_phone TEXT,
  status        TEXT NOT NULL DEFAULT 'open',     -- open | resolved
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id            BIGSERIAL PRIMARY KEY,
  actor_user_id TEXT,
  action        TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  event_id      TEXT,
  details       JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER audit_logs_no_change BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION ledger_append_only();

CREATE TABLE plans (
  id            TEXT PRIMARY KEY,                 -- free | event_pass | institution (phase 2)
  name          TEXT NOT NULL,
  price         BIGINT NOT NULL DEFAULT 0,
  currency      TEXT NOT NULL DEFAULT 'UGX',
  limits        JSONB NOT NULL DEFAULT '{}',
  active        BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE event_passes (
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL UNIQUE REFERENCES events(id),
  payment_id    TEXT NOT NULL REFERENCES payments(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE credits (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  delta         INT NOT NULL,                     -- + purchase / referral, - usage
  reason        TEXT NOT NULL,
  ref           TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (reason, ref)
);

CREATE TABLE settings (
  key           TEXT PRIMARY KEY,
  value         JSONB NOT NULL,
  updated_by    TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reconciliation_issues (
  id            TEXT PRIMARY KEY,
  run_date      DATE NOT NULL,
  payment_id    TEXT REFERENCES payments(id),
  kind          TEXT NOT NULL,
  details       JSONB NOT NULL DEFAULT '{}',
  resolved      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Built-in mock gateway state (development and tests only).
CREATE TABLE mock_transactions (
  ref           TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,                    -- collection | payout
  reference     TEXT NOT NULL,                    -- our payment / payout id
  amount        BIGINT NOT NULL,
  currency      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
