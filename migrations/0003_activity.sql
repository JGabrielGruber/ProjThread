CREATE TABLE work_item_event (
  id TEXT PRIMARY KEY,
  work_item_id TEXT NOT NULL REFERENCES work_item(id),
  organization_id TEXT NOT NULL REFERENCES organization(id),
  type TEXT NOT NULL CHECK (type IN (
    'stage_changed',
    'owner_changed',
    'decision',
    'occurrence',
    'note'
  )),
  from_value TEXT,
  to_value TEXT,
  body TEXT,
  actor_id TEXT NOT NULL REFERENCES principal(id),
  ref_node_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_work_item_event_item
  ON work_item_event (work_item_id, created_at);
