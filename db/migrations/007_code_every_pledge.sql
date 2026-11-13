-- No permanent PIN: every pledge is verified with a fresh one-time code sent to the phone (WhatsApp, SMS fallback).
ALTER TABLE pledgers DROP COLUMN pin_hash;
ALTER TABLE pledgers DROP COLUMN pin_failures;
ALTER TABLE pledgers DROP COLUMN pin_locked_until;

-- pledger_devices now holds short verification sessions (15 minutes, used up by one pledge).
ALTER TABLE pledger_devices DROP COLUMN pending_pin_hash;
ALTER TABLE pledger_devices RENAME COLUMN pin_confirmed_at TO verified_at;
DELETE FROM pledger_devices;
