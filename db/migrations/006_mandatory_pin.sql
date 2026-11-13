-- Every pledge is now confirmed with the pledger's PIN.
-- pin_confirmed_at: when this device last proved the PIN (a pledge needs a confirmation from the last 30 minutes).
-- pending_pin_hash: a first-time pledger chooses their PIN before their pledger record exists; it is applied
--                   to the record when the first pledge is created.
ALTER TABLE pledger_devices ADD COLUMN pin_confirmed_at TIMESTAMPTZ;
ALTER TABLE pledger_devices ADD COLUMN pending_pin_hash TEXT;
