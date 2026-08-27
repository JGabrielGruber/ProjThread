import { parseSessionId } from "../lib/cookies.ts";
import { newId } from "../lib/id.ts";
import { descendantIds } from "../lib/project-tree.ts";
import { rejectActivityBody } from "../room/tape.ts";
import type {
  CatalogStore,
  WorkItemEventRow,
  WorkItemEventType,
  WorkItemRow,
} from "./catalog.ts";
import type { Env } from "./env.ts";
import { resolveSession, type Principal, type SessionStore } from "./session.ts";

const EVENT_TYPES = new Set<WorkItemEventType>([
  "stage_changed",
  "owner_changed",
  "decision",
  "occurrence",
  "note",
]);

const WORKSPACE_RESOURCES = new Set(["projects", "stages", "work-items"]);

export async function handleCatalog(
  request: Request,
  env: Env,
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

  const workItemPath = matchWorkItemPath(url.pathname);
  if (workItemPath && !workItemPath.events && request.method === "GET") {
    return getWorkItem(workItemPath.id, principal.id, catalog);
  }
  if (workItemPath && !workItemPath.events && request.method === "PATCH") {
    return patchWorkItem(request, workItemPath.id, principal.id, catalog);
  }
  if (workItemPath?.events && request.method === "GET") {
    return listWorkItemEvents(workItemPath.id, principal.id, catalog);
  }
  if (workItemPath?.events && request.method === "POST") {
    return postWorkItemEvent(
      request,
      env,
      workItemPath.id,
      principal,
      catalog,
    );
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

async function loadWorkItem(
  id: string,
  principalId: string,
  catalog: CatalogStore,
): Promise<{ item: WorkItemRow } | Response> {
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
  return { item };
}

async function listWorkItemEvents(
  id: string,
  principalId: string,
  catalog: CatalogStore,
): Promise<Response> {
  const loaded = await loadWorkItem(id, principalId, catalog);
  if (loaded instanceof Response) return loaded;
  const events = await catalog.listWorkItemEvents(loaded.item.id);
  return Response.json({ events });
}

async function postWorkItemEvent(
  request: Request,
  env: Env,
  id: string,
  principal: Principal,
  catalog: CatalogStore,
): Promise<Response> {
  const loaded = await loadWorkItem(id, principal.id, catalog);
  if (loaded instanceof Response) return loaded;
  const item = loaded.item;

  const body = await readJson(request);
  if (!isRecord(body)) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const type = body.type;
  if (typeof type !== "string" || !EVENT_TYPES.has(type as WorkItemEventType)) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const eventType = type as WorkItemEventType;
  const requiredBody = eventType !== "owner_changed";
  const eventBody =
    body.body === undefined || body.body === null
      ? eventType === "owner_changed"
        ? null
        : ""
      : typeof body.body === "string"
        ? body.body
        : null;
  if (eventBody === null && body.body !== undefined && body.body !== null) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  if (rejectActivityBody(eventBody, requiredBody)) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  if (body.ref_node_id !== undefined && typeof body.ref_node_id !== "string") {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const ref_node_id =
    typeof body.ref_node_id === "string" && body.ref_node_id !== ""
      ? body.ref_node_id
      : null;

  let from_value: string | null = null;
  let to_value: string | null = null;
  let stage_key: string | undefined;
  let owner_id: string | null | undefined;
  const now = new Date().toISOString();

  if (eventType === "stage_changed") {
    if (typeof body.from !== "string" || typeof body.to !== "string") {
      return Response.json({ error: "bad_request" }, { status: 400 });
    }
    if (body.from !== item.stage_key) {
      return Response.json({ error: "bad_request" }, { status: 400 });
    }
    const stages = await catalog.listStages(item.workspace_id);
    if (!stages.some((s) => s.key === body.to)) {
      return Response.json({ error: "bad_request" }, { status: 400 });
    }
    from_value = body.from;
    to_value = body.to;
    stage_key = body.to;
  } else if (eventType === "owner_changed") {
    if (!isStringOrNull(body.from) || !isStringOrNull(body.to)) {
      return Response.json({ error: "bad_request" }, { status: 400 });
    }
    if (body.from !== item.owner_id) {
      return Response.json({ error: "bad_request" }, { status: 400 });
    }
    if (typeof body.to === "string") {
      const membership = await catalog.getMembership(
        item.workspace_id,
        body.to,
      );
      if (!membership) {
        return Response.json({ error: "bad_request" }, { status: 400 });
      }
    }
    from_value = body.from;
    to_value = body.to;
    owner_id = body.to;
  }

  const event: WorkItemEventRow = {
    id: newId(),
    work_item_id: item.id,
    organization_id: item.organization_id,
    type: eventType,
    from_value,
    to_value,
    body: eventBody,
    actor_id: principal.id,
    ref_node_id,
    created_at: now,
  };

  await catalog.commitWorkItemEvent({
    event,
    ...(stage_key !== undefined ? { stage_key, updated_at: now } : {}),
    ...(owner_id !== undefined ? { owner_id, updated_at: now } : {}),
  });

  const stub = env.Room.getByName(item.id);
  try {
    await stub.appendSystem({ event_id: event.id });
  } catch {
    try {
      await stub.appendSystem({ event_id: event.id });
    } catch {
      // keep D1
    }
  }

  const work_item = await catalog.getWorkItem(item.id);
  return Response.json({ event, work_item }, { status: 201 });
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
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

function matchWorkItemPath(
  pathname: string,
): { id: string; events: boolean } | null {
  const prefix = "/api/work-items/";
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  const slash = rest.indexOf("/");
  if (slash === -1) {
    return rest && !rest.includes("/") ? { id: rest, events: false } : null;
  }
  const id = rest.slice(0, slash);
  const tail = rest.slice(slash + 1);
  if (!id || tail !== "events") return null;
  return { id, events: true };
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
