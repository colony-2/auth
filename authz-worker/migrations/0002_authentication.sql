PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS identities (
  identity_id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL UNIQUE REFERENCES subjects(subject_id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  mfa_secret TEXT,
  mfa_enabled INTEGER NOT NULL DEFAULT 0,
  recovery_codes_json TEXT,
  external_provider TEXT,
  external_subject TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(external_provider, external_subject)
);

CREATE TABLE IF NOT EXISTS service_account_credentials (
  credential_id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(subject_id) ON DELETE CASCADE,
  secret_hash TEXT NOT NULL,
  label TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS refresh_sessions (
  session_id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(subject_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  audience TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  rotated_from TEXT,
  user_agent TEXT,
  ip_hash TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_challenges (
  challenge_id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(subject_id) ON DELETE CASCADE,
  challenge_type TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_credentials_subject ON service_account_credentials(subject_id);
CREATE INDEX IF NOT EXISTS idx_sessions_subject ON refresh_sessions(subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON refresh_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_challenges_subject ON auth_challenges(subject_id, expires_at);
