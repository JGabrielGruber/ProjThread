import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_STAGES,
  type CatalogStore,
  type Membership,
  type ProjectRow,
  type StageRow,
  type TenantBundle,
  type WorkItemRow,
} from "./catalog.ts";

function memoryCatalog(): CatalogStore {
  const organizations = new Map<string, { id: string; name: string; created_at: string }>();
  const principals = new Map<
    string,
    { id: string; type: "human"; display_name: string; created_at: string }
  >();
  const workspaces = new Map<
    string,
    { id: string; organization_id: string; name: string; created_at: string }
  >();
  const memberships = new Map<string, { workspace_id: string; principal_id: string; role: "owner" | "member" }>();
  const stages = new Map<string, StageRow>();
  const projects = new Map<string, ProjectRow & { created_at: string }>();
  const workItems = new Map<string, WorkItemRow>();

  function membershipKey(workspaceId: string, principalId: string): string {
    return `${workspaceId}:${principalId}`;
  }

  function toMembership(
    workspaceId: string,
    principalId: string,
  ): Membership | null {
    const row = memberships.get(membershipKey(workspaceId, principalId));
    if (!row) return null;
    const workspace = workspaces.get(workspaceId);
    if (!workspace) return null;
    const organization = organizations.get(workspace.organization_id);
    if (!organization) return null;
    return {
      organization_id: organization.id,
      organization_name: organization.name,
      workspace_id: workspace.id,
      workspace_name: workspace.name,
      role: row.role,
    };
  }

  return {
    async listMemberships(principalId) {
      const out: Membership[] = [];
      for (const row of memberships.values()) {
        if (row.principal_id !== principalId) continue;
        const m = toMembership(row.workspace_id, principalId);
        if (m) out.push(m);
      }
      return out;
    },
    async getMembership(workspaceId, principalId) {
      return toMembership(workspaceId, principalId);
    },
    async listProjects(workspaceId) {
      return [...projects.values()]
        .filter((p) => p.workspace_id === workspaceId)
        .map(({ created_at: _createdAt, ...row }) => ({ ...row }));
    },
    async getProject(id) {
      const row = projects.get(id);
      return row ? { ...row } : null;
    },
    async listStages(workspaceId) {
      return [...stages.values()]
        .filter((s) => s.workspace_id === workspaceId)
        .sort((a, b) => a.position - b.position)
        .map((s) => ({ ...s }));
    },
    async listWorkItems(workspaceId, projectIds) {
      if (projectIds.length === 0) return [];
      const allowed = new Set(projectIds);
      return [...workItems.values()]
        .filter(
          (item) =>
            item.workspace_id === workspaceId && allowed.has(item.project_id),
        )
        .map((item) => ({ ...item }));
    },
    async getWorkItem(id) {
      const row = workItems.get(id);
      return row ? { ...row } : null;
    },
    async insertWorkItem(row) {
      workItems.set(row.id, { ...row });
    },
    async updateWorkItemTitle(id, title, updatedAt) {
      const row = workItems.get(id);
      if (!row) return false;
      workItems.set(id, { ...row, title, updated_at: updatedAt });
      return true;
    },
    async insertTenantBundle(b) {
      organizations.set(b.organization.id, { ...b.organization });
      principals.set(b.principal.id, { ...b.principal });
      workspaces.set(b.workspace.id, { ...b.workspace });
      for (const stage of DEFAULT_STAGES) {
        const row: StageRow = {
          workspace_id: b.workspace.id,
          key: stage.key,
          label: stage.label,
          position: stage.position,
        };
        stages.set(`${row.workspace_id}:${row.key}`, row);
      }
      projects.set(b.project.id, { ...b.project });
      memberships.set(membershipKey(b.membership.workspace_id, b.membership.principal_id), {
        ...b.membership,
      });
    },
    async listOrganizations() {
      return [...organizations.values()].map((o) => ({ id: o.id, name: o.name }));
    },
  };
}

function sampleBundle(): TenantBundle {
  const now = "2026-01-01T00:00:00.000Z";
  const organization = { id: "org-1", name: "Acme", created_at: now };
  const workspace = {
    id: "ws-1",
    organization_id: organization.id,
    name: "HQ",
    created_at: now,
  };
  const project: TenantBundle["project"] = {
    id: "proj-1",
    workspace_id: workspace.id,
    organization_id: organization.id,
    parent_id: null,
    name: organization.name,
    created_at: now,
  };
  const principal = {
    id: "prin-1",
    type: "human" as const,
    display_name: "José",
    created_at: now,
  };
  return {
    organization,
    workspace,
    project,
    principal,
    membership: {
      workspace_id: workspace.id,
      principal_id: principal.id,
      role: "owner",
    },
  };
}

describe("insertTenantBundle", () => {
  it("listMemberships returns one owner row with org and workspace names", async () => {
    const store = memoryCatalog();
    const bundle = sampleBundle();
    await store.insertTenantBundle(bundle);

    const memberships = await store.listMemberships(bundle.principal.id);
    assert.deepEqual(memberships, [
      {
        organization_id: "org-1",
        organization_name: "Acme",
        workspace_id: "ws-1",
        workspace_name: "HQ",
        role: "owner",
      },
    ]);
  });

  it("listProjects is the one root named after the org", async () => {
    const store = memoryCatalog();
    const bundle = sampleBundle();
    await store.insertTenantBundle(bundle);

    const projects = await store.listProjects(bundle.workspace.id);
    assert.deepEqual(projects, [
      {
        id: "proj-1",
        workspace_id: "ws-1",
        organization_id: "org-1",
        parent_id: null,
        name: "Acme",
      },
    ]);
  });

  it("listStages is backlog, doing, done in position order", async () => {
    const store = memoryCatalog();
    const bundle = sampleBundle();
    await store.insertTenantBundle(bundle);

    const stages = await store.listStages(bundle.workspace.id);
    assert.deepEqual(
      stages.map((s) => ({ key: s.key, label: s.label, position: s.position })),
      DEFAULT_STAGES.map((s) => ({
        key: s.key,
        label: s.label,
        position: s.position,
      })),
    );
    assert.deepEqual(
      stages.map((s) => s.key),
      ["backlog", "doing", "done"],
    );
  });

  it("getMembership for another workspace is null", async () => {
    const store = memoryCatalog();
    const bundle = sampleBundle();
    await store.insertTenantBundle(bundle);

    assert.equal(
      await store.getMembership("ws-other", bundle.principal.id),
      null,
    );
    const own = await store.getMembership(
      bundle.workspace.id,
      bundle.principal.id,
    );
    assert.equal(own?.role, "owner");
  });
});

describe("work items", () => {
  it("insertWorkItem then listWorkItems by project id returns it", async () => {
    const store = memoryCatalog();
    const bundle = sampleBundle();
    await store.insertTenantBundle(bundle);

    const row: WorkItemRow = {
      id: "wi-1",
      project_id: bundle.project.id,
      workspace_id: bundle.workspace.id,
      organization_id: bundle.organization.id,
      title: "First card",
      stage_key: "backlog",
      owner_id: null,
      created_at: "2026-01-02T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    };
    await store.insertWorkItem(row);

    const listed = await store.listWorkItems(bundle.workspace.id, [
      bundle.project.id,
    ]);
    assert.deepEqual(listed, [row]);
    assert.equal(listed[0]?.owner_id, null);
    assert.equal(listed[0]?.stage_key, "backlog");
    assert.deepEqual(
      await store.listWorkItems(bundle.workspace.id, []),
      [],
    );
  });

  it("updateWorkItemTitle changes title; missing id returns false", async () => {
    const store = memoryCatalog();
    const bundle = sampleBundle();
    await store.insertTenantBundle(bundle);
    await store.insertWorkItem({
      id: "wi-1",
      project_id: bundle.project.id,
      workspace_id: bundle.workspace.id,
      organization_id: bundle.organization.id,
      title: "Old title",
      stage_key: "backlog",
      owner_id: null,
      created_at: "2026-01-02T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    });

    const updated = await store.updateWorkItemTitle(
      "wi-1",
      "New title",
      "2026-01-03T00:00:00.000Z",
    );
    assert.equal(updated, true);
    const item = await store.getWorkItem("wi-1");
    assert.equal(item?.title, "New title");
    assert.equal(item?.updated_at, "2026-01-03T00:00:00.000Z");

    assert.equal(
      await store.updateWorkItemTitle(
        "missing",
        "Nope",
        "2026-01-04T00:00:00.000Z",
      ),
      false,
    );
  });
});
