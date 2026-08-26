import { parseSessionId } from "../lib/cookies.ts";
import type { Env } from "./env.ts";
import { resolveSession, type SessionStore } from "./session.ts";

export async function handleMe(
  request: Request,
  _env: Env,
  store: SessionStore,
): Promise<Response> {
  if (request.method !== "GET") {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const sessionId = parseSessionId(request.headers.get("cookie"));
  if (!sessionId) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const principal = await resolveSession(store, sessionId);
  if (!principal) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  return Response.json({ principal });
}
