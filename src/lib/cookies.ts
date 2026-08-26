export const COOKIE_NAME = "pt_session";

function isHttps(origin: string): boolean {
  return origin.startsWith("https:");
}

function attrs(origin: string, maxAge: number): string {
  const parts = [
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
  ];
  if (isHttps(origin)) parts.push("Secure");
  return parts.join("; ");
}

export function parseSessionId(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name === COOKIE_NAME) return part.slice(eq + 1).trim();
  }
  return null;
}

export function serializeSessionCookie(
  sessionId: string,
  origin: string,
  days: number,
): string {
  return `${COOKIE_NAME}=${sessionId}; ${attrs(origin, days * 86400)}`;
}

export function serializeClearSessionCookie(origin: string): string {
  return `${COOKIE_NAME}=; ${attrs(origin, 0)}`;
}
