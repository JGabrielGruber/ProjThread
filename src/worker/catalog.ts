import type { D1Database } from "./env.ts";

export const DEFAULT_STAGES = [
  { key: "backlog", label: "Backlog", position: 0 },
  { key: "doing", label: "Doing", position: 1 },
  { key: "done", label: "Done", position: 2 },
] as const;

export type Membership = {
  organization_id: string;
  organization_name: string;
  workspace_id: string;
  workspace_name: string;
  role: "owner" | "member";
};

export type ProjectRow = {
  id: string;
  workspace_id: string;
  organization_id: string;
  parent_id: string | null;
  name: string;
};

export type StageRow = {
  workspace_id: string;
  key: string;
  label: string;
  position: number;
};

export type WorkItemRow = {
  id: string;
  project_id: string;
  workspace_id: string;
  organization_id: string;
  title: string;
  stage_key: string;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
};

export type TenantBundle = {
  organization: { id: string; name: string; created_at: string };
  workspace: {
    id: string;
    organization_id: string;
    name: string;
    created_at: string;
  };
  project: ProjectRow & { created_at: string };
  principal: {
    id: string;
    type: "human";
    display_name: string;
    created_at: string;
  };
  membership: { workspace_id: string; principal_id: string; role: "owner" };
};

export type CatalogStore = {
  listMemberships(principalId: string): Promise<Membership[]>;
  getMembership(
    workspaceId: string,
    principalId: string,
  ): Promise<Membership | null>;
  listProjects(workspaceId: string): Promise<ProjectRow[]>;
  getProject(id: string): Promise<(ProjectRow & { created_at: string }) | null>;
  listStages(workspaceId: string): Promise<StageRow[]>;
  listWorkItems(
    workspaceId: string,
    projectIds: string[],
  ): Promise<WorkItemRow[]>;
  getWorkItem(id: string): Promise<WorkItemRow | null>;
  insertWorkItem(row: WorkItemRow): Promise<void>;
  updateWorkItemTitle(
    id: string,
    title: string,
    updatedAt: string,
  ): Promise<boolean>;
  insertTenantBundle(b: TenantBundle): Promise<void>;
  listOrganizations(): Promise<{ id: string; name: string }[]>;
};

const MEMBERSHIP_SELECT = `SELECT workspace.organization_id AS organization_id,
       organization.name AS organization_name,
       membership.workspace_id AS workspace_id,
       workspace.name AS workspace_name,
       membership.role AS role
FROM membership
INNER JOIN workspace ON workspace.id = membership.workspace_id
INNER JOIN organization ON organization.id = workspace.organization_id`;

export function d1CatalogStore(db: D1Database): CatalogStore {
  return {
    async listMemberships(principalId) {
      const { results } = await db
        .prepare(`${MEMBERSHIP_SELECT} WHERE membership.principal_id = ?`)
        .bind(principalId)
        .all<Membership>();
      return results;
    },
    async getMembership(workspaceId, principalId) {
      return db
        .prepare(
          `${MEMBERSHIP_SELECT} WHERE membership.workspace_id = ? AND membership.principal_id = ?`,
        )
        .bind(workspaceId, principalId)
        .first<Membership>();
    },
    async listProjects(workspaceId) {
      const { results } = await db
        .prepare(
          "SELECT id, workspace_id, organization_id, parent_id, name FROM project WHERE workspace_id = ?",
        )
        .bind(workspaceId)
        .all<ProjectRow>();
      return results;
    },
    async getProject(id) {
      return db
        .prepare(
          "SELECT id, workspace_id, organization_id, parent_id, name, created_at FROM project WHERE id = ?",
        )
        .bind(id)
        .first<ProjectRow & { created_at: string }>();
    },
    async listStages(workspaceId) {
      const { results } = await db
        .prepare(
          "SELECT workspace_id, key, label, position FROM stage WHERE workspace_id = ? ORDER BY position",
        )
        .bind(workspaceId)
        .all<StageRow>();
      return results;
    },
    async listWorkItems(workspaceId, projectIds) {
      if (projectIds.length === 0) return [];
      const placeholders = projectIds.map(() => "?").join(", ");
      const { results } = await db
        .prepare(
          `SELECT id, project_id, workspace_id, organization_id, title, stage_key, owner_id, created_at, updated_at
FROM work_item
WHERE workspace_id = ? AND project_id IN (${placeholders})`,
        )
        .bind(workspaceId, ...projectIds)
        .all<WorkItemRow>();
      return results;
    },
    async getWorkItem(id) {
      return db
        .prepare(
          "SELECT id, project_id, workspace_id, organization_id, title, stage_key, owner_id, created_at, updated_at FROM work_item WHERE id = ?",
        )
        .bind(id)
        .first<WorkItemRow>();
    },
    async insertWorkItem(row) {
      await db
        .prepare(
          "INSERT INTO work_item (id, project_id, workspace_id, organization_id, title, stage_key, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          row.id,
          row.project_id,
          row.workspace_id,
          row.organization_id,
          row.title,
          row.stage_key,
          row.owner_id,
          row.created_at,
          row.updated_at,
        )
        .run();
    },
    async updateWorkItemTitle(id, title, updatedAt) {
      const row = await db
        .prepare(
          "UPDATE work_item SET title = ?, updated_at = ? WHERE id = ? RETURNING id",
        )
        .bind(title, updatedAt, id)
        .first<{ id: string }>();
      return row != null;
    },
    async insertTenantBundle(b) {
      await db
        .prepare(
          "INSERT INTO organization (id, name, created_at) VALUES (?, ?, ?)",
        )
        .bind(b.organization.id, b.organization.name, b.organization.created_at)
        .run();
      await db
        .prepare(
          "INSERT INTO principal (id, type, display_name, created_at) VALUES (?, ?, ?, ?)",
        )
        .bind(
          b.principal.id,
          b.principal.type,
          b.principal.display_name,
          b.principal.created_at,
        )
        .run();
      await db
        .prepare(
          "INSERT INTO workspace (id, organization_id, name, created_at) VALUES (?, ?, ?, ?)",
        )
        .bind(
          b.workspace.id,
          b.workspace.organization_id,
          b.workspace.name,
          b.workspace.created_at,
        )
        .run();
      for (const stage of DEFAULT_STAGES) {
        await db
          .prepare(
            "INSERT INTO stage (workspace_id, key, label, position) VALUES (?, ?, ?, ?)",
          )
          .bind(b.workspace.id, stage.key, stage.label, stage.position)
          .run();
      }
      await db
        .prepare(
          "INSERT INTO project (id, workspace_id, organization_id, parent_id, name, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(
          b.project.id,
          b.project.workspace_id,
          b.project.organization_id,
          b.project.parent_id,
          b.project.name,
          b.project.created_at,
        )
        .run();
      await db
        .prepare(
          "INSERT INTO membership (workspace_id, principal_id, role) VALUES (?, ?, ?)",
        )
        .bind(
          b.membership.workspace_id,
          b.membership.principal_id,
          b.membership.role,
        )
        .run();
    },
    async listOrganizations() {
      const { results } = await db
        .prepare("SELECT id, name FROM organization ORDER BY created_at")
        .all<{ id: string; name: string }>();
      return results;
    },
  };
}
