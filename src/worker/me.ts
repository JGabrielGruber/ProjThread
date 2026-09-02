import type { CatalogStore } from "./catalog.ts";
import type { Env } from "./env.ts";
import { sessionIdFromRequest } from "../lib/session-id.ts";
import { resolveSession, type SessionStore } from "./session.ts";

export async function handleMe(
  request: Request,
  _env: Env,
  sessions: SessionStore,
  catalog: CatalogStore,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "PATCH") {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const sessionId = sessionIdFromRequest(request);
  if (!sessionId) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const principal = await resolveSession(sessions, sessionId);
  if (!principal) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const row = await sessions.getSession(sessionId);
  if (!row) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  if (request.method === "PATCH") {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "bad_request" }, { status: 400 });
    }
    const workspaceId =
      typeof body === "object" &&
      body !== null &&
      "workspace_id" in body &&
      typeof (body as { workspace_id: unknown }).workspace_id === "string"
        ? (body as { workspace_id: string }).workspace_id.trim()
        : "";
    if (!workspaceId) {
      return Response.json({ error: "bad_request" }, { status: 400 });
    }
    const memberships = await catalog.listMemberships(principal.id);
    if (!memberships.some((m) => m.workspace_id === workspaceId)) {
      return Response.json({ error: "bad_request" }, { status: 400 });
    }
    await sessions.updateSessionWorkspace(sessionId, workspaceId);
    return Response.json({
      principal,
      memberships,
      workspace_id: workspaceId,
    });
  }

  const memberships = await catalog.listMemberships(principal.id);
  return Response.json({
    principal,
    memberships,
    workspace_id: row.workspace_id ?? null,
  });
}
