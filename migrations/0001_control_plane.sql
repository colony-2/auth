PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS services (
  service_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  vocabulary_json TEXT NOT NULL,
  vocabulary_version INTEGER NOT NULL DEFAULT 1,
  active_service_version TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subjects (
  subject_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('User', 'ServiceAccount')),
  display_name TEXT NOT NULL,
  email TEXT UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended', 'disabled')),
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scopes (
  scope_id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES services(service_id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_scope_id TEXT REFERENCES scopes(scope_id),
  claim_id TEXT,
  active_version TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(service_id, claim_id)
);

CREATE TABLE IF NOT EXISTS scope_groups (
  group_id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL REFERENCES scopes(scope_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(scope_id, name)
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id TEXT NOT NULL REFERENCES scope_groups(group_id) ON DELETE CASCADE,
  member_id TEXT NOT NULL,
  member_kind TEXT NOT NULL CHECK (member_kind IN ('User', 'ServiceAccount', 'Group')),
  created_at TEXT NOT NULL,
  PRIMARY KEY(group_id, member_id)
);

CREATE TABLE IF NOT EXISTS bindings (
  binding_id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL REFERENCES scopes(scope_id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('User', 'ServiceAccount', 'Group')),
  role_id TEXT,
  permission_profile TEXT,
  permission_id TEXT,
  resource_type TEXT,
  path_space TEXT,
  named_path TEXT,
  inline_path_prefix TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (role_id IS NOT NULL OR (permission_profile IS NOT NULL AND permission_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS path_grants (
  path_grant_id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL REFERENCES scopes(scope_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  path_space TEXT NOT NULL,
  prefix TEXT NOT NULL,
  permissions_json TEXT NOT NULL,
  anchor_resource_type TEXT,
  anchor_resource_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(scope_id, name)
);

CREATE TABLE IF NOT EXISTS service_config_versions (
  version_id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES services(service_id) ON DELETE CASCADE,
  artifact_key TEXT NOT NULL,
  artifact_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  published_at TEXT
);

CREATE TABLE IF NOT EXISTS scope_config_versions (
  version_id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES services(service_id) ON DELETE CASCADE,
  scope_id TEXT NOT NULL REFERENCES scopes(scope_id) ON DELETE CASCADE,
  artifact_key TEXT NOT NULL,
  artifact_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  published_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  service_id TEXT,
  scope_id TEXT,
  detail_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scopes_service ON scopes(service_id, scope_type);
CREATE INDEX IF NOT EXISTS idx_groups_scope ON scope_groups(scope_id);
CREATE INDEX IF NOT EXISTS idx_members_member ON group_members(member_id, member_kind);
CREATE INDEX IF NOT EXISTS idx_bindings_scope_subject ON bindings(scope_id, subject_id, subject_kind);
CREATE INDEX IF NOT EXISTS idx_path_grants_scope ON path_grants(scope_id);
CREATE INDEX IF NOT EXISTS idx_audit_service_sequence ON audit_events(service_id, sequence DESC);
