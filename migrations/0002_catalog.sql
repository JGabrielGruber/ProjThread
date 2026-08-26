CREATE TABLE workspace (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE membership (
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  principal_id TEXT NOT NULL REFERENCES principal(id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  PRIMARY KEY (workspace_id, principal_id)
);

CREATE TABLE stage (
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, key)
);

CREATE TABLE project (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  organization_id TEXT NOT NULL REFERENCES organization(id),
  parent_id TEXT REFERENCES project(id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_project_workspace ON project (workspace_id);

CREATE TABLE work_item (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id),
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  organization_id TEXT NOT NULL REFERENCES organization(id),
  title TEXT NOT NULL,
  stage_key TEXT NOT NULL,
  owner_id TEXT REFERENCES principal(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_work_item_board ON work_item (workspace_id, project_id, stage_key);
