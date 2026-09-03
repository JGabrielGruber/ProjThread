PRAGMA foreign_keys = OFF;

CREATE TABLE node_new (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  organization_id TEXT NOT NULL REFERENCES organization(id),
  type TEXT NOT NULL CHECK (type IN (
    'note',
    'decision',
    'process',
    'research'
  )),
  payload_kind TEXT NOT NULL CHECK (payload_kind IN ('markdown', 'json', 'blob')),
  title TEXT NOT NULL,
  summary TEXT,
  content TEXT,
  blob_key TEXT,
  mime_type TEXT,
  byte_size INTEGER,
  filename TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0
);

INSERT INTO node_new (
  id, workspace_id, organization_id, type, payload_kind, title, summary, content,
  blob_key, mime_type, byte_size, filename, created_at, updated_at, pinned
)
SELECT
  id, workspace_id, organization_id, type, payload_kind, title, summary, content,
  blob_key, mime_type, byte_size, filename, created_at, updated_at, pinned
FROM node;

DROP TABLE node;
ALTER TABLE node_new RENAME TO node;

CREATE INDEX idx_node_workspace ON node (workspace_id);

PRAGMA foreign_keys = ON;
