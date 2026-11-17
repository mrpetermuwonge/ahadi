-- Admin roles: super (everything), finance (money), trust (safety and verification), support (read-only).
-- users.is_admin stays as "has any admin role" so existing checks keep working.
ALTER TABLE users ADD COLUMN admin_role TEXT;
UPDATE users SET admin_role = 'super' WHERE is_admin AND admin_role IS NULL;

-- Step-up verification: a fresh one-time code proves it is really the account holder before money or
-- committee actions. Stored per session, valid for a few minutes.
ALTER TABLE sessions ADD COLUMN stepped_up_at TIMESTAMPTZ;

-- Two-person rule for money settings (fees, prices, limits): one super admin proposes, another approves.
CREATE TABLE setting_proposals (
  id           TEXT PRIMARY KEY,
  key          TEXT NOT NULL,
  value        JSONB NOT NULL,
  old_value    JSONB,
  proposed_by  TEXT NOT NULL REFERENCES users(id),
  status       TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  decided_by   TEXT REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at   TIMESTAMPTZ
);
CREATE INDEX setting_proposals_status_idx ON setting_proposals(status, created_at);
