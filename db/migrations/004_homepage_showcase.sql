-- Homepage showcase and organizer categories.

-- Who is organising: individual | group | faith | nonprofit | company | school
ALTER TABLE events ADD COLUMN organizer_kind TEXT NOT NULL DEFAULT 'individual';

-- The owner asks for the event to appear in the homepage slideshow ...
ALTER TABLE events ADD COLUMN show_on_home BOOLEAN NOT NULL DEFAULT FALSE;
-- ... and (unless the admin turns review off) Ahadi approves it: NULL = not reviewed, TRUE = approved, FALSE = declined.
ALTER TABLE events ADD COLUMN home_approved BOOLEAN;
ALTER TABLE events ADD COLUMN home_requested_at TIMESTAMPTZ;

CREATE INDEX events_home_idx ON events(show_on_home, home_approved) WHERE show_on_home;
