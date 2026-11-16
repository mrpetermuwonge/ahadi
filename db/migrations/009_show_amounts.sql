-- Organizer choice: show money (raised, pledged, target) on the public event page. On by default.
ALTER TABLE events ADD COLUMN show_amounts BOOLEAN NOT NULL DEFAULT TRUE;
