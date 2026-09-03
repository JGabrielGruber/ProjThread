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

CREATE TABLE node_work_item_bak AS SELECT * FROM node_work_item;
CREATE TABLE node_project_bak AS SELECT * FROM node_project;
CREATE TABLE node_rel_bak AS SELECT * FROM node_rel;

DROP TABLE node_rel;
DROP TABLE node_work_item;
DROP TABLE node_project;
DROP TABLE node;

ALTER TABLE node_new RENAME TO node;

CREATE INDEX idx_node_workspace ON node (workspace_id);

CREATE TABLE node_work_item (
  node_id TEXT NOT NULL REFERENCES node(id),
  work_item_id TEXT NOT NULL REFERENCES work_item(id),
  PRIMARY KEY (node_id, work_item_id)
);
INSERT INTO node_work_item SELECT * FROM node_work_item_bak;
DROP TABLE node_work_item_bak;

CREATE TABLE node_project (
  node_id TEXT NOT NULL REFERENCES node(id),
  project_id TEXT NOT NULL REFERENCES project(id),
  PRIMARY KEY (node_id, project_id)
);
INSERT INTO node_project SELECT * FROM node_project_bak;
DROP TABLE node_project_bak;

CREATE TABLE node_rel (
  from_id TEXT NOT NULL REFERENCES node(id),
  to_id TEXT NOT NULL REFERENCES node(id),
  kind TEXT NOT NULL CHECK (kind IN ('includes', 'ref')),
  position INTEGER,
  PRIMARY KEY (from_id, to_id, kind),
  CHECK (
    (kind = 'includes' AND position IS NOT NULL)
    OR (kind = 'ref' AND position IS NULL)
  )
);
INSERT INTO node_rel SELECT * FROM node_rel_bak;
DROP TABLE node_rel_bak;
CREATE INDEX idx_node_rel_from ON node_rel (from_id, kind, position);
