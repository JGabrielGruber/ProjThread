import type { Env } from "./env.ts";

export function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

export function handleAdminShell(request: Request, env: Env): Promise<Response> {
  return env.ASSETS.fetch(new URL("/admin/index.html", request.url));
}
