-- Login by phone (code via WhatsApp, SMS fallback), by email code, or with Google.
-- A user now has a phone, an email, or both.

ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE users ADD COLUMN email TEXT UNIQUE;          -- lowercase
ALTER TABLE users ADD COLUMN google_sub TEXT UNIQUE;     -- Google account id (never changes, unlike email)
ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD CONSTRAINT users_has_identity CHECK (phone IS NOT NULL OR email IS NOT NULL);

-- One-time codes are now for a phone or an email address.
ALTER TABLE otp_codes RENAME COLUMN phone TO identifier;
ALTER TABLE otp_codes ADD COLUMN channel TEXT NOT NULL DEFAULT 'sms';   -- whatsapp | sms | email
ALTER TABLE otp_codes ADD COLUMN purpose TEXT NOT NULL DEFAULT 'login'; -- login | add_phone
ALTER TABLE login_lockouts RENAME COLUMN phone TO identifier;

-- Short-lived state for the Google sign-in round trip (CSRF protection).
CREATE TABLE oauth_states (
  state       TEXT PRIMARY KEY,
  nonce       TEXT NOT NULL,
  next_path   TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL
);

-- The message log now records SMS, WhatsApp and email.
ALTER TABLE messages_log RENAME COLUMN to_phone TO recipient;
