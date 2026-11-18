-- Account control by super admins: a suspended account cannot log in and all its sessions end.
ALTER TABLE users ADD COLUMN suspended_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN suspended_reason TEXT;
ALTER TABLE users ADD COLUMN suspended_by TEXT REFERENCES users(id);

-- Partners shown in the sliding strip on the homepage (managed in Admin → Partners).
CREATE TABLE partners (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  tagline       TEXT,
  url           TEXT,
  logo_file_id  TEXT REFERENCES files(id),
  sort          INT NOT NULL DEFAULT 0,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  demo          BOOLEAN NOT NULL DEFAULT FALSE,   -- made-up sample partners; replace before launch
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX partners_active_idx ON partners(active, sort);

-- Demo partners (fictional names) so the homepage strip can be seen; edit or remove them in Admin → Partners.
INSERT INTO partners(id, name, tagline, sort, demo) VALUES
  ('ptn_demo1', 'Nile Bridal Expo', 'Weddings & introductions', 1, true),
  ('ptn_demo2', 'Rwenzori Health Fund', 'Medical support', 2, true),
  ('ptn_demo3', 'Jinja Youth SACCO', 'Savings & loans', 3, true),
  ('ptn_demo4', 'Kololo Gospel Choir', 'Church fundraising', 4, true),
  ('ptn_demo5', 'Entebbe Lakeside Caterers', 'Event catering', 5, true),
  ('ptn_demo6', 'Masaka Community Trust', 'Community projects', 6, true),
  ('ptn_demo7', 'Mbale Schools Network', 'School fees drives', 7, true),
  ('ptn_demo8', 'Gulu Burial Association', 'Funeral support', 8, true);
