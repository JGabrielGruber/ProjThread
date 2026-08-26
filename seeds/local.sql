INSERT OR IGNORE INTO organization (id, name, created_at)
VALUES ('01FARM00000000000000000001', 'Farm', '2010-01-01T00:00:00.000Z');

INSERT OR IGNORE INTO principal (id, type, display_name, created_at)
VALUES ('01FARM00000000000000000002', 'human', 'Farm', '2010-01-01T00:00:00.000Z');

INSERT OR IGNORE INTO workspace (id, organization_id, name, created_at)
VALUES (
  '01FARM00000000000000000003',
  '01FARM00000000000000000001',
  'Farm',
  '2010-01-01T00:00:00.000Z'
);

INSERT OR IGNORE INTO stage (workspace_id, key, label, position)
VALUES
  ('01FARM00000000000000000003', 'backlog', 'Backlog', 0),
  ('01FARM00000000000000000003', 'doing', 'Doing', 1),
  ('01FARM00000000000000000003', 'done', 'Done', 2);

INSERT OR IGNORE INTO project (id, workspace_id, organization_id, parent_id, name, created_at)
VALUES (
  '01FARM00000000000000000004',
  '01FARM00000000000000000003',
  '01FARM00000000000000000001',
  NULL,
  'Farm',
  '2010-01-01T00:00:00.000Z'
);

INSERT OR IGNORE INTO membership (workspace_id, principal_id, role)
VALUES (
  '01FARM00000000000000000003',
  '01FARM00000000000000000002',
  'owner'
);
