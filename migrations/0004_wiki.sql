CREATE TABLE node (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  organization_id TEXT NOT NULL REFERENCES organization(id),
  type TEXT NOT NULL CHECK (type IN (
    'note',
    'decision',
    'process',
    'research'
  )),
  payload_kind TEXT NOT NULL CHECK (payload_kind IN ('markdown', 'blob')),
  title TEXT NOT NULL,
  summary TEXT,
  content TEXT,
  blob_key TEXT,
  mime_type TEXT,
  byte_size INTEGER,
  filename TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_node_workspace ON node (workspace_id);

CREATE TABLE node_work_item (
  node_id TEXT NOT NULL REFERENCES node(id),
  work_item_id TEXT NOT NULL REFERENCES work_item(id),
  PRIMARY KEY (node_id, work_item_id)
);

CREATE TABLE node_project (
  node_id TEXT NOT NULL REFERENCES node(id),
  project_id TEXT NOT NULL REFERENCES project(id),
  PRIMARY KEY (node_id, project_id)
);
