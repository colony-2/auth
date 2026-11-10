PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS service_drafts (
  service_id TEXT PRIMARY KEY REFERENCES services(service_id) ON DELETE CASCADE,
  openapi_json TEXT,
  auth_descriptor_json TEXT,
  schema_json TEXT,
  snippets_json TEXT NOT NULL DEFAULT '{}',
  global_policy TEXT,
  named_paths_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scope_drafts (
  scope_id TEXT PRIMARY KEY REFERENCES scopes(scope_id) ON DELETE CASCADE,
  includes_json TEXT NOT NULL DEFAULT '[]',
  policy TEXT,
  named_paths_json TEXT NOT NULL DEFAULT '{}',
  static_entities_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  idempotency_key TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_idempotency_expiry ON idempotency_keys(expires_at);
