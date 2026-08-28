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
  if (request.method !== "GET") {
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

  const memberships = await catalog.listMemberships(principal.id);
  return Response.json({ principal, memberships });
}
