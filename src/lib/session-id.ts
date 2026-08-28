import { parseSessionId } from "./cookies.ts";

export function parseBearerSessionId(
  authorization: string | null,
): string | null {
  if (authorization == null) return null;
  const trimmed = authorization.trim();
  if (!/^Bearer\b/i.test(trimmed)) return null;
  const match = /^Bearer\s+(\S+)/i.exec(trimmed);
  return match?.[1] ?? "";
}

export function sessionIdFromRequest(request: Request): string | null {
  const bearer = parseBearerSessionId(request.headers.get("authorization"));
  if (bearer !== null) return bearer;
  return parseSessionId(request.headers.get("cookie"));
}
