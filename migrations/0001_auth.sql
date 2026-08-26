CREATE TABLE principal (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('human', 'agent', 'service')),
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE session (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES principal(id),
  minted_by TEXT NOT NULL REFERENCES principal(id),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_session_principal ON session (principal_id);

CREATE TABLE organization (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
