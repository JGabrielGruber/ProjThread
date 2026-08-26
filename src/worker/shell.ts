import type { Env } from "./env.ts";

export const ADMIN_INDEX_PATH = "/admin/index.html";

export function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

export function isAdminAsset(pathname: string): boolean {
  return (
    pathname === ADMIN_INDEX_PATH ||
    pathname === "/admin/sw.js" ||
    pathname.startsWith("/admin/assets/")
  );
}

export async function handleAdminShell(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  if (isAdminAsset(url.pathname)) {
    return env.ASSETS.fetch(request);
  }
  return env.ASSETS.fetch(new Request(new URL(ADMIN_INDEX_PATH, request.url)));
}
