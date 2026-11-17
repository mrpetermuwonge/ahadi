-- Privacy records: which version of the privacy notice / terms each person agreed to, and when.
ALTER TABLE pledgers ADD COLUMN consent_version TEXT;
ALTER TABLE users ADD COLUMN terms_version TEXT;
ALTER TABLE users ADD COLUMN terms_accepted_at TIMESTAMPTZ;
UPDATE pledgers SET consent_version = 'before-2026-11-17' WHERE consent_version IS NULL;

-- Backups and data clean-up runs, for the Admin panel and audits.
CREATE TABLE ops_runs (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,                 -- backup | retention
  ok          BOOLEAN NOT NULL,
  details     JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ops_runs_kind_idx ON ops_runs(kind, created_at DESC);
