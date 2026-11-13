-- A verification can view the portal until the pledger leaves it, but makes at most one pledge.
ALTER TABLE pledger_devices ADD COLUMN used_at TIMESTAMPTZ;
