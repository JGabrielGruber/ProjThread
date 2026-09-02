ALTER TABLE session ADD COLUMN workspace_id TEXT REFERENCES workspace(id);
