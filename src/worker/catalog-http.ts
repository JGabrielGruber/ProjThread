import { parseSessionId } from "../lib/cookies.ts";
import { newId } from "../lib/id.ts";
import { descendantIds } from "../lib/project-tree.ts";
import type { CatalogStore, WorkItemRow } from "./catalog.ts";
import type { Env } from "./env.ts";
import { resolveSession, type SessionStore } from "./session.ts";

const WORKSPACE_RESOURCES = new Set(["projects", "stages", "work-items"]);

export async function handleCatalog(
  request: Request,
  _env: Env,
  sessions: SessionStore,
  catalog: CatalogStore,
): Promise<Response> {
  const sessionId = parseSessionId(request.headers.get("cookie"));
  if (!sessionId) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const principal = await resolveSession(sessions, sessionId);
  if (!principal) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const workspaceRoute = matchWorkspaceResource(url.pathname);
  if (workspaceRoute) {
    const membership = await catalog.getMembership(
      workspaceRoute.workspaceId,
      principal.id,
    );
    if (!membership) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }

    if (workspaceRoute.resource === "projects" && request.method === "GET") {
      const projects = await catalog.listProjects(workspaceRoute.workspaceId);
      return Response.json({ projects });
    }

    if (workspaceRoute.resource === "stages" && request.method === "GET") {
      const stages = await catalog.listStages(workspaceRoute.workspaceId);
      return Response.json({ stages });
    }

    if (workspaceRoute.resource === "work-items" && request.method === "GET") {
      return listWorkItems(url, workspaceRoute.workspaceId, catalog);
    }

    if (workspaceRoute.resource === "work-items" && request.method === "POST") {
      return createWorkItem(request, workspaceRoute.workspaceId, catalog);
    }

    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const workItemId = matchWorkItemId(url.pathname);
  if (workItemId && request.method === "GET") {
    return getWorkItem(workItemId, principal.id, catalog);
  }
  if (workItemId && request.method === "PATCH") {
    return patchWorkItem(request, workItemId, principal.id, catalog);
  }

  return Response.json({ error: "not_found" }, { status: 404 });
}

async function getWorkItem(
  id: string,
  principalId: string,
  catalog: CatalogStore,
): Promise<Response> {
  const item = await catalog.getWorkItem(id);
  if (!item) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const membership = await catalog.getMembership(
    item.workspace_id,
    principalId,
  );
  if (!membership) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  return Response.json(item);
}

async function listWorkItems(
  url: URL,
  workspaceId: string,
  catalog: CatalogStore,
): Promise<Response> {
  const projectId = url.searchParams.get("project_id");
  if (!projectId) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const project = await catalog.getProject(projectId);
  if (!project || project.workspace_id !== workspaceId) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const projects = await catalog.listProjects(workspaceId);
  const ids = [...descendantIds(projectId, projects)];
  const work_items = await catalog.listWorkItems(workspaceId, ids);
  return Response.json({ work_items });
}

async function createWorkItem(
  request: Request,
  workspaceId: string,
  catalog: CatalogStore,
): Promise<Response> {
  const body = await readJson(request);
  if (!isRecord(body)) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  if (typeof body.project_id !== "string" || !body.project_id) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const project = await catalog.getProject(body.project_id);
  if (!project || project.workspace_id !== workspaceId) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const now = new Date().toISOString();
  const row: WorkItemRow = {
    id: newId(),
    project_id: project.id,
    workspace_id: workspaceId,
    organization_id: project.organization_id,
    title,
    stage_key: "backlog",
    owner_id: null,
    created_at: now,
    updated_at: now,
  };
  await catalog.insertWorkItem(row);
  return Response.json(row, { status: 201 });
}

async function patchWorkItem(
  request: Request,
  id: string,
  principalId: string,
  catalog: CatalogStore,
): Promise<Response> {
  const item = await catalog.getWorkItem(id);
  if (!item) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const membership = await catalog.getMembership(
    item.workspace_id,
    principalId,
  );
  if (!membership) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await readJson(request);
  if (!isRecord(body) || "stage_key" in body || "owner_id" in body) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  await catalog.updateWorkItemTitle(id, title, new Date().toISOString());
  const updated = await catalog.getWorkItem(id);
  return Response.json(updated);
}

function matchWorkspaceResource(
  pathname: string,
): { workspaceId: string; resource: string } | null {
  const prefix = "/api/workspaces/";
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  const workspaceId = rest.slice(0, slash);
  const resource = rest.slice(slash + 1);
  if (!workspaceId || workspaceId.includes("/") || !WORKSPACE_RESOURCES.has(resource)) {
    return null;
  }
  return { workspaceId, resource };
}

function matchWorkItemId(pathname: string): string | null {
  const prefix = "/api/work-items/";
  if (!pathname.startsWith(prefix)) return null;
  const id = pathname.slice(prefix.length);
  if (!id || id.includes("/")) return null;
  return id;
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
