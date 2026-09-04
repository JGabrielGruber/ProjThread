CREATE TABLE notify_subscription (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  organization_id TEXT NOT NULL REFERENCES organization(id),
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  kinds TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES principal(id)
);

CREATE INDEX idx_notify_subscription_workspace
  ON notify_subscription (workspace_id);
