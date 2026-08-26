import {
  parseSessionId,
  serializeClearSessionCookie,
  serializeSessionCookie,
} from "../lib/cookies.ts";
import { newId } from "../lib/id.ts";
import type { CatalogStore, TenantBundle } from "./catalog.ts";
import type { Env } from "./env.ts";
import {
  mintSession,
  revokeSession,
  type Principal,
  type SessionStore,
} from "./session.ts";

const PRINCIPAL_TYPES = new Set<Principal["type"]>([
  "human",
  "agent",
  "service",
]);

export async function handleAdmin(
  request: Request,
  env: Env,
  store: SessionStore,
  catalog: CatalogStore,
): Promise<Response> {
  const { pathname } = new URL(request.url);
  const method = request.method;

  if (pathname === "/api/admin/organizations" && method === "GET") {
    return Response.json({ organizations: await catalog.listOrganizations() });
  }

  if (pathname === "/api/admin/organizations" && method === "POST") {
    return createOrganization(request, catalog);
  }

  if (pathname === "/api/admin/principals" && method === "GET") {
    return Response.json({ principals: await store.listPrincipals() });
  }

  if (pathname === "/api/admin/principals" && method === "POST") {
    return createPrincipal(request, store);
  }

  if (pathname === "/api/admin/sessions" && method === "POST") {
    return createSession(request, env, store);
  }

  const revokeId = matchSessionRevoke(pathname);
  if (revokeId && method === "POST") {
    return revokeAndMaybeClearCookie(request, env, store, revokeId);
  }

  return Response.json({ error: "not_found" }, { status: 404 });
}

async function createOrganization(
  request: Request,
  catalog: CatalogStore,
): Promise<Response> {
  const body = await readJson(request);
  if (!isRecord(body)) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const organizationId = newId();
  const workspaceId = newId();
  const projectId = newId();
  const principalId = newId();
  const bundle: TenantBundle = {
    organization: { id: organizationId, name, created_at: now },
    workspace: {
      id: workspaceId,
      organization_id: organizationId,
      name,
      created_at: now,
    },
    project: {
      id: projectId,
      workspace_id: workspaceId,
      organization_id: organizationId,
      parent_id: null,
      name,
      created_at: now,
    },
    principal: {
      id: principalId,
      type: "human",
      display_name: name,
      created_at: now,
    },
    membership: {
      workspace_id: workspaceId,
      principal_id: principalId,
      role: "owner",
    },
  };
  await catalog.insertTenantBundle(bundle);

  return Response.json(
    {
      organization: { id: organizationId, name },
      workspace: { id: workspaceId, name },
      project: { id: projectId, name, parent_id: null },
      principal: { id: principalId, type: "human", display_name: name },
    },
    { status: 201 },
  );
}

async function createPrincipal(
  request: Request,
  store: SessionStore,
): Promise<Response> {
  const body = await readJson(request);
  if (!isRecord(body)) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const type = body.type;
  const displayName =
    typeof body.display_name === "string" ? body.display_name.trim() : "";
  if (
    typeof type !== "string" ||
    !PRINCIPAL_TYPES.has(type as Principal["type"]) ||
    !displayName
  ) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const principal: Principal = {
    id: newId(),
    type: type as Principal["type"],
    display_name: displayName,
  };
  await store.insertPrincipal({
    ...principal,
    created_at: new Date().toISOString(),
  });
  return Response.json(principal, { status: 201 });
}

async function createSession(
  request: Request,
  env: Env,
  store: SessionStore,
): Promise<Response> {
  const body = await readJson(request);
  if (!isRecord(body) || typeof body.principal_id !== "string" || !body.principal_id) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  let session;
  try {
    session = await mintSession(store, body.principal_id);
  } catch {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  return Response.json(
    { session },
    {
      status: 201,
      headers: {
        "Set-Cookie": serializeSessionCookie(session.id, env.APP_ORIGIN, 30),
      },
    },
  );
}

async function revokeAndMaybeClearCookie(
  request: Request,
  env: Env,
  store: SessionStore,
  sessionId: string,
): Promise<Response> {
  await revokeSession(store, sessionId);
  const cookieId = parseSessionId(request.headers.get("cookie"));
  const headers = new Headers();
  if (cookieId && cookieId === sessionId) {
    headers.set("Set-Cookie", serializeClearSessionCookie(env.APP_ORIGIN));
  }
  return new Response(null, { status: 204, headers });
}

function matchSessionRevoke(pathname: string): string | null {
  const prefix = "/api/admin/sessions/";
  const suffix = "/revoke";
  if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) return null;
  const id = pathname.slice(prefix.length, pathname.length - suffix.length);
  if (!id || id.includes("/")) return null;
  return id;
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
