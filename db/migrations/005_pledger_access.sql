-- Returning pledgers: see all their pledges without creating an account.
-- Access needs proof that the phone is theirs: a WhatsApp/SMS code, their optional PIN,
-- or a device that already proved it (remembered for 90 days).

ALTER TABLE pledgers ADD COLUMN pin_hash TEXT;                 -- scrypt(pin, salt + server pepper); never the PIN itself
ALTER TABLE pledgers ADD COLUMN pin_failures INT NOT NULL DEFAULT 0;
ALTER TABLE pledgers ADD COLUMN pin_locked_until TIMESTAMPTZ;

CREATE TABLE pledger_devices (
  token_hash  TEXT PRIMARY KEY,                -- sha256 of the httpOnly cookie value
  phone       TEXT NOT NULL,                   -- E.164 the device proved it owns
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX pledger_devices_phone_idx ON pledger_devices(phone);
