PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS change_requests (
  request_id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('service', 'scope')),
  service_id TEXT NOT NULL REFERENCES services(service_id) ON DELETE CASCADE,
  scope_id TEXT REFERENCES scopes(scope_id) ON DELETE CASCADE,
  requested_version TEXT NOT NULL,
  summary TEXT NOT NULL,
  diff_json TEXT NOT NULL,
  impact_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'executed', 'failed')),
  requested_by TEXT NOT NULL,
  reviewed_by TEXT,
  review_note TEXT,
  requested_at TEXT NOT NULL,
  reviewed_at TEXT,
  executed_at TEXT
);

CREATE TABLE IF NOT EXISTS break_glass_grants (
  grant_id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(subject_id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES services(service_id) ON DELETE CASCADE,
  scope_id TEXT NOT NULL REFERENCES scopes(scope_id) ON DELETE CASCADE,
  role_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'rejected', 'revoked', 'expired')),
  requested_by TEXT NOT NULL,
  approved_by TEXT,
  requested_at TEXT NOT NULL,
  approved_at TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS entitlement_projections (
  service_id TEXT NOT NULL REFERENCES services(service_id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL REFERENCES subjects(subject_id) ON DELETE CASCADE,
  azs_json TEXT NOT NULL,
  dirty INTEGER NOT NULL DEFAULT 1,
  generated_at TEXT NOT NULL,
  valid_until TEXT,
  PRIMARY KEY(service_id, subject_id)
);

CREATE TABLE IF NOT EXISTS entitlement_projection_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL,
  path TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processed', 'failed')),
  created_at TEXT NOT NULL,
  processed_at TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS artifact_replication_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  service_id TEXT NOT NULL,
  scope_id TEXT,
  version TEXT NOT NULL,
  replica TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_change_requests_status ON change_requests(status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_break_glass_active ON break_glass_grants(subject_id, service_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_projections_dirty ON entitlement_projections(dirty, generated_at);
CREATE INDEX IF NOT EXISTS idx_projection_events_status ON entitlement_projection_events(status, sequence);
CREATE INDEX IF NOT EXISTS idx_replication_status ON artifact_replication_events(status, sequence DESC);
