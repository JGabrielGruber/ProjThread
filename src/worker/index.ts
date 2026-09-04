import { authorizeAdmin, adminForbidden } from "./access.ts";
import { handleAdmin } from "./admin.ts";
import { handleCatalog } from "./catalog-http.ts";
import { d1CatalogStore } from "./catalog.ts";
import type { Env } from "./env.ts";
import { handleMe } from "./me.ts";
import { handleMcp, type WorkerContext } from "./mcp.ts";
import {
  d1NotifyStore,
  deliverNotifyBatch,
  type NotifyMessage,
} from "./notify.ts";
import { handleNotify } from "./notify-http.ts";
import { handleRoom } from "./room-http.ts";
import { d1SessionStore } from "./session.ts";
import {
  handleAdminShell,
  handleAppShell,
  isAdminPath,
  isAppHistoryPath,
} from "./shell.ts";
import { r2BlobStore } from "./blobs.ts";
import { handleWiki } from "./wiki-http.ts";
import { d1WikiStore } from "./wiki.ts";

export { Room } from "../room/room.ts";

export default {
  async fetch(request: Request, env: Env, ctx: WorkerContext): Promise<Response> {
    const url = new URL(request.url);
    const store = d1SessionStore(env.DB);
    const catalog = d1CatalogStore(env.DB);
    const wiki = d1WikiStore(env.DB);
    const notify = d1NotifyStore(env.DB);
    const blobs = env.BLOBS ? r2BlobStore(env.BLOBS) : null;

    if (url.pathname === "/mcp") {
      return handleMcp(
        request,
        env,
        store,
        catalog,
        wiki,
        ctx,
        notify,
        blobs ?? undefined,
      );
    }

    if (url.pathname.startsWith("/api/admin")) {
      if (!(await authorizeAdmin(request, env))) return adminForbidden(request);
      return handleAdmin(request, env, store, catalog);
    }

    if (url.pathname === "/api/me") {
      return handleMe(request, env, store, catalog);
    }

    if (url.pathname.startsWith("/api/rooms/")) {
      return handleRoom(request, env, store, catalog);
    }

    if (
      url.pathname.startsWith("/api/nodes") ||
      /^\/api\/workspaces\/[^/]+\/nodes$/.test(url.pathname) ||
      /^\/api\/work-items\/[^/]+\/nodes$/.test(url.pathname)
    ) {
      return handleWiki(request, env, store, catalog, wiki, notify, blobs);
    }

    if (/^\/api\/workspaces\/[^/]+\/notify-subscriptions(?:\/[^/]+)?$/.test(url.pathname)) {
      return handleNotify(request, env, store, catalog, notify);
    }

    if (
      url.pathname.startsWith("/api/workspaces") ||
      url.pathname.startsWith("/api/work-items") ||
      url.pathname.startsWith("/api/projects") ||
      url.pathname === "/api/organizations"
    ) {
      return handleCatalog(request, env, store, catalog);
    }

    if (url.pathname.startsWith("/api/")) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    if (isAdminPath(url.pathname)) {
      if (!(await authorizeAdmin(request, env))) return adminForbidden(request);
      return handleAdminShell(request, env);
    }

    if (isAppHistoryPath(url.pathname)) {
      return handleAppShell(request, env);
    }

    return env.ASSETS.fetch(request);
  },
  async queue(
    batch: {
      messages: {
        id: string;
        timestamp: Date;
        body: NotifyMessage;
        ack(): void;
        retry(): void;
      }[];
    },
    env: Env,
  ) {
    await deliverNotifyBatch(batch.messages, d1NotifyStore(env.DB));
  },
};
