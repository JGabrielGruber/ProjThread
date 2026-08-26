import { authorizeAdmin, adminForbidden } from "./access.ts";
import { handleAdmin } from "./admin.ts";
import { d1CatalogStore } from "./catalog.ts";
import type { Env } from "./env.ts";
import { handleMe } from "./me.ts";
import { d1SessionStore } from "./session.ts";
import { handleAdminShell, isAdminPath } from "./shell.ts";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const store = d1SessionStore(env.DB);
    const catalog = d1CatalogStore(env.DB);

    if (url.pathname.startsWith("/api/admin")) {
      if (!(await authorizeAdmin(request, env))) return adminForbidden(request);
      return handleAdmin(request, env, store);
    }

    if (url.pathname === "/api/me") {
      return handleMe(request, env, store, catalog);
    }

    if (url.pathname.startsWith("/api/")) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    if (isAdminPath(url.pathname)) {
      if (!(await authorizeAdmin(request, env))) return adminForbidden(request);
      return handleAdminShell(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
