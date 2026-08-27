import { parseSessionId } from "../lib/cookies.ts";
import type { CatalogStore } from "./catalog.ts";
import type { Env } from "./env.ts";
import { resolveSession, type SessionStore } from "./session.ts";

export async function handleRoom(
  request: Request,
  env: Env,
  sessions: SessionStore,
  catalog: CatalogStore,
): Promise<Response> {
  const url = new URL(request.url);
  const id = matchRoomId(url.pathname);
  if (!id) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const sessionId = parseSessionId(request.headers.get("cookie"));
  if (!sessionId) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const principal = await resolveSession(sessions, sessionId);
  if (!principal) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const item = await catalog.getWorkItem(id);
  if (!item) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const membership = await catalog.getMembership(
    item.workspace_id,
    principal.id,
  );
  if (!membership) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const lastSeq = url.searchParams.get("last_seq");
  if (lastSeq !== null && !/^\d+$/.test(lastSeq)) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const headers = new Headers(request.headers);
  headers.set("X-Pt-Principal", principal.id);
  return env.Room.getByName(item.id).fetch(new Request(request, { headers }));
}

function matchRoomId(pathname: string): string | null {
  const prefix = "/api/rooms/";
  if (!pathname.startsWith(prefix)) return null;
  const id = pathname.slice(prefix.length);
  if (!id || id.includes("/")) return null;
  return id;
}
