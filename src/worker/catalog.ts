import { newId } from "../lib/id.ts";
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

export type WorkItemEventType =
  | "stage_changed"
  | "owner_changed"
  | "decision"
  | "occurrence"
  | "note";

export type WorkItemEventRow = {
  id: string;
  work_item_id: string;
  organization_id: string;
  type: WorkItemEventType;
  from_value: string | null;
  to_value: string | null;
  body: string | null;
  actor_id: string;
  ref_node_id: string | null;
  created_at: string;
};

export type WorkItemEventCommit = {
  event: WorkItemEventRow;
  stage_key?: string;
  owner_id?: string | null;
  updated_at?: string;
};

export type WorkspaceMemberRow = {
  workspace_id: string;
  principal_id: string;
  display_name: string;
  type: "human" | "agent" | "service";
  role: "owner" | "member";
};

export type MembershipWrite = {
  workspace_id: string;
  principal_id: string;
  role: "owner" | "member";
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
  listMembers(workspaceId: string): Promise<WorkspaceMemberRow[]>;
  insertMembership(row: MembershipWrite): Promise<"inserted" | "exists">;
  updateMembershipRole(
    workspaceId: string,
    principalId: string,
    role: "owner" | "member",
  ): Promise<boolean>;
  deleteMembership(workspaceId: string, principalId: string): Promise<boolean>;
  countOwners(workspaceId: string): Promise<number>;
  listProjects(workspaceId: string): Promise<ProjectRow[]>;
  getProject(id: string): Promise<(ProjectRow & { created_at: string }) | null>;
  insertProject(row: ProjectRow & { created_at: string }): Promise<void>;
  updateProjectName(id: string, name: string): Promise<boolean>;
  updateProjectParent(id: string, parentId: string | null): Promise<boolean>;
  listStages(workspaceId: string): Promise<StageRow[]>;
  replaceStages(workspaceId: string, stages: StageRow[]): Promise<boolean>;
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
  insertWorkspaceFor(
    principalId: string,
    name: string,
  ): Promise<{
    organization: { id: string; name: string };
    workspace: { id: string; name: string };
    project: { id: string; name: string; parent_id: null };
  }>;
  listOrganizations(): Promise<{ id: string; name: string }[]>;
  listWorkItemEvents(workItemId: string): Promise<WorkItemEventRow[]>;
  commitWorkItemEvent(commit: WorkItemEventCommit): Promise<void>;
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
    async listMembers(workspaceId) {
      const { results } = await db
        .prepare(
          `SELECT membership.workspace_id AS workspace_id,
       membership.principal_id AS principal_id,
       principal.display_name AS display_name,
       principal.type AS type,
       membership.role AS role
FROM membership
INNER JOIN principal ON principal.id = membership.principal_id
WHERE membership.workspace_id = ?`,
        )
        .bind(workspaceId)
        .all<WorkspaceMemberRow>();
      return results;
    },
    async insertMembership(row) {
      const result = (await db
        .prepare(
          "INSERT OR IGNORE INTO membership (workspace_id, principal_id, role) VALUES (?, ?, ?)",
        )
        .bind(row.workspace_id, row.principal_id, row.role)
        .run()) as { meta?: { changes?: number } };
      return result.meta?.changes === 0 ? "exists" : "inserted";
    },
    async updateMembershipRole(workspaceId, principalId, role) {
      const row = await db
        .prepare(
          "UPDATE membership SET role = ? WHERE workspace_id = ? AND principal_id = ? RETURNING principal_id",
        )
        .bind(role, workspaceId, principalId)
        .first<{ principal_id: string }>();
      return row != null;
    },
    async deleteMembership(workspaceId, principalId) {
      const row = await db
        .prepare(
          "DELETE FROM membership WHERE workspace_id = ? AND principal_id = ? RETURNING principal_id",
        )
        .bind(workspaceId, principalId)
        .first<{ principal_id: string }>();
      return row != null;
    },
    async countOwners(workspaceId) {
      const row = await db
        .prepare(
          "SELECT COUNT(*) AS n FROM membership WHERE workspace_id = ? AND role = 'owner'",
        )
        .bind(workspaceId)
        .first<{ n: number }>();
      return Number(row?.n ?? 0);
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
    async insertProject(row) {
      await db
        .prepare(
          "INSERT INTO project (id, workspace_id, organization_id, parent_id, name, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(
          row.id,
          row.workspace_id,
          row.organization_id,
          row.parent_id,
          row.name,
          row.created_at,
        )
        .run();
    },
    async updateProjectName(id, name) {
      const row = await db
        .prepare("UPDATE project SET name = ? WHERE id = ? RETURNING id")
        .bind(name, id)
        .first<{ id: string }>();
      return row != null;
    },
    async updateProjectParent(id, parentId) {
      const row = await db
        .prepare("UPDATE project SET parent_id = ? WHERE id = ? RETURNING id")
        .bind(parentId, id)
        .first<{ id: string }>();
      return row != null;
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
    async replaceStages(workspaceId, stages) {
      const existing = await this.listStages(workspaceId);
      const existingKeys = new Set(existing.map((s) => s.key));
      const incomingKeys = new Set(stages.map((s) => s.key));
      if (
        existingKeys.size !== incomingKeys.size ||
        [...existingKeys].some((key) => !incomingKeys.has(key))
      ) {
        return false;
      }
      const statements = stages.map((stage) =>
        db
          .prepare(
            "UPDATE stage SET label = ?, position = ? WHERE workspace_id = ? AND key = ?",
          )
          .bind(stage.label, stage.position, workspaceId, stage.key),
      );
      await db.batch(statements);
      return true;
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
    async insertWorkspaceFor(principalId, name) {
      const now = new Date().toISOString();
      const organizationId = newId();
      const workspaceId = newId();
      const projectId = newId();
      await db
        .prepare(
          "INSERT INTO organization (id, name, created_at) VALUES (?, ?, ?)",
        )
        .bind(organizationId, name, now)
        .run();
      await db
        .prepare(
          "INSERT INTO workspace (id, organization_id, name, created_at) VALUES (?, ?, ?, ?)",
        )
        .bind(workspaceId, organizationId, name, now)
        .run();
      for (const stage of DEFAULT_STAGES) {
        await db
          .prepare(
            "INSERT INTO stage (workspace_id, key, label, position) VALUES (?, ?, ?, ?)",
          )
          .bind(workspaceId, stage.key, stage.label, stage.position)
          .run();
      }
      await db
        .prepare(
          "INSERT INTO project (id, workspace_id, organization_id, parent_id, name, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(projectId, workspaceId, organizationId, null, name, now)
        .run();
      await db
        .prepare(
          "INSERT INTO membership (workspace_id, principal_id, role) VALUES (?, ?, ?)",
        )
        .bind(workspaceId, principalId, "owner")
        .run();
      return {
        organization: { id: organizationId, name },
        workspace: { id: workspaceId, name },
        project: { id: projectId, name, parent_id: null },
      };
    },
    async listOrganizations() {
      const { results } = await db
        .prepare("SELECT id, name FROM organization ORDER BY created_at")
        .all<{ id: string; name: string }>();
      return results;
    },
    async listWorkItemEvents(workItemId) {
      const { results } = await db
        .prepare(
          `SELECT id, work_item_id, organization_id, type, from_value, to_value, body, actor_id, ref_node_id, created_at
FROM work_item_event
WHERE work_item_id = ?
ORDER BY created_at ASC, id ASC`,
        )
        .bind(workItemId)
        .all<WorkItemEventRow>();
      return results;
    },
    async commitWorkItemEvent(commit) {
      const { event } = commit;
      const statements = [
        db
          .prepare(
            `INSERT INTO work_item_event (id, work_item_id, organization_id, type, from_value, to_value, body, actor_id, ref_node_id, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            event.id,
            event.work_item_id,
            event.organization_id,
            event.type,
            event.from_value,
            event.to_value,
            event.body,
            event.actor_id,
            event.ref_node_id,
            event.created_at,
          ),
      ];
      if (
        commit.stage_key !== undefined ||
        commit.owner_id !== undefined
      ) {
        const sets: string[] = [];
        const values: unknown[] = [];
        if (commit.stage_key !== undefined) {
          sets.push("stage_key = ?");
          values.push(commit.stage_key);
        }
        if (commit.owner_id !== undefined) {
          sets.push("owner_id = ?");
          values.push(commit.owner_id);
        }
        if (commit.updated_at !== undefined) {
          sets.push("updated_at = ?");
          values.push(commit.updated_at);
        }
        statements.push(
          db
            .prepare(
              `UPDATE work_item SET ${sets.join(", ")} WHERE id = ?`,
            )
            .bind(...values, event.work_item_id),
        );
      }
      await db.batch(statements);
    },
  };
}
