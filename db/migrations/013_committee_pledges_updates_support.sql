-- Pledges recorded by the committee (made at a meeting or on paper): who recorded them, and whether the
-- pledger confirmed or said "this is not my pledge".
ALTER TABLE pledges ADD COLUMN source TEXT NOT NULL DEFAULT 'self';        -- self | committee | import
ALTER TABLE pledges ADD COLUMN recorded_by TEXT REFERENCES users(id);
ALTER TABLE pledges ADD COLUMN confirmed_at TIMESTAMPTZ;
ALTER TABLE pledges ADD COLUMN disputed_at TIMESTAMPTZ;

-- "Remind everyone who still owes": at most once a day per event.
ALTER TABLE events ADD COLUMN last_nudged_at TIMESTAMPTZ;

-- Updates from the organizer to supporters ("We reached 80%!", a hospital update).
CREATE TABLE event_updates (
  id             TEXT PRIMARY KEY,
  event_id       TEXT NOT NULL REFERENCES events(id),
  author_id      TEXT NOT NULL REFERENCES users(id),
  body           TEXT NOT NULL,
  image_file_id  TEXT REFERENCES files(id),
  notified       INT NOT NULL DEFAULT 0,          -- how many pledgers got a WhatsApp/SMS about it
  hidden_at      TIMESTAMPTZ,
  hidden_by      TEXT REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX event_updates_event_idx ON event_updates(event_id, created_at DESC);

-- Help and contact: requests to Ahadi support, with a private link so the person can follow the conversation.
CREATE TABLE support_requests (
  id           TEXT PRIMARY KEY,
  ref          TEXT NOT NULL UNIQUE,              -- shown to the person, e.g. AH-SUP-7KX2
  token        TEXT NOT NULL UNIQUE,              -- their private link /help/r/<token>
  name         TEXT NOT NULL,
  phone        TEXT,
  email        TEXT,
  topic        TEXT NOT NULL,                     -- payment | pledge | event | account | fraud | other
  event_ref    TEXT,                              -- event link or receipt number they mention
  status       TEXT NOT NULL DEFAULT 'open',      -- open | waiting | resolved
  assigned_to  TEXT REFERENCES users(id),
  user_id      TEXT REFERENCES users(id),         -- when sent while logged in
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX support_requests_status_idx ON support_requests(status, updated_at DESC);

CREATE TABLE support_messages (
  id          TEXT PRIMARY KEY,
  request_id  TEXT NOT NULL REFERENCES support_requests(id),
  from_staff  BOOLEAN NOT NULL,
  author_id   TEXT REFERENCES users(id),
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX support_messages_req_idx ON support_messages(request_id, created_at);
