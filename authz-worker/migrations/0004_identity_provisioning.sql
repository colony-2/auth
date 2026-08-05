PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS idx_identities_external
  ON identities(external_provider, external_subject);

CREATE TABLE IF NOT EXISTS scim_group_mappings (
  scim_id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL UNIQUE REFERENCES scope_groups(group_id) ON DELETE CASCADE,
  scope_id TEXT NOT NULL REFERENCES scopes(scope_id) ON DELETE CASCADE,
  external_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(scope_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_scim_groups_scope
  ON scim_group_mappings(scope_id, updated_at DESC);
