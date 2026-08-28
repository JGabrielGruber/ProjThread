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

CREATE INDEX idx_node_rel_from ON node_rel (from_id, kind, position);
