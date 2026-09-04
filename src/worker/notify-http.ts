import { newId } from "../lib/id.ts";
import { parseKinds } from "../lib/notify-kind.ts";
import { sessionIdFromRequest } from "../lib/session-id.ts";
import { newWebhookSecret } from "../lib/standard-webhooks.ts";
import type { CatalogStore } from "./catalog.ts";
import type { Env } from "./env.ts";
import type {
  NotifyStore,
  NotifySubscriptionPublic,
  NotifySubscriptionRow,
} from "./notify.ts";
import { resolveSession, type SessionStore } from "./session.ts";

const SUB_PATH =
  /^\/api\/workspaces\/([^/]+)\/notify-subscriptions(?:\/([^/]+))?$/;

export async function handleNotify(
  request: Request,
  _env: Env,
  sessions: SessionStore,
  catalog: CatalogStore,
  notify: NotifyStore,
): Promise<Response> {
  const sessionId = sessionIdFromRequest(request);
  if (!sessionId) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const principal = await resolveSession(sessions, sessionId);
  if (!principal) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const match = SUB_PATH.exec(url.pathname);
  if (!match) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const workspaceId = match[1]!;
  const subscriptionId = match[2];

  const membership = await catalog.getMembership(workspaceId, principal.id);
  if (!membership) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  if (!subscriptionId && request.method === "GET") {
    const subscriptions = (await notify.listSubscriptions(workspaceId)).map(
      toJson,
    );
    return Response.json({ subscriptions });
  }

  if (!subscriptionId && request.method === "POST") {
    if (membership.role !== "owner") {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    return createSubscription(
      request,
      workspaceId,
      membership.organization_id,
      principal.id,
      notify,
    );
  }

  if (subscriptionId && (request.method === "PATCH" || request.method === "DELETE")) {
    const row = await notify.getSubscription(subscriptionId);
    if (!row || row.workspace_id !== workspaceId) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    if (membership.role !== "owner") {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    if (request.method === "DELETE") {
      await notify.deleteSubscription(subscriptionId);
      return new Response(null, { status: 204 });
    }
    return patchSubscription(request, row, notify);
  }

  return Response.json({ error: "not_found" }, { status: 404 });
}

async function createSubscription(
  request: Request,
  workspaceId: string,
  organizationId: string,
  principalId: string,
  notify: NotifyStore,
): Promise<Response> {
  const body = await readJson(request);
  if (!isRecord(body)) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const url = parseUrl(body.url);
  const kinds = parseKinds(body.kinds);
  if (!url || !kinds) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  let enabled = 1;
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") {
      return Response.json({ error: "bad_request" }, { status: 400 });
    }
    enabled = body.enabled ? 1 : 0;
  }
  const secret = newWebhookSecret();
  const row: NotifySubscriptionRow = {
    id: newId(),
    workspace_id: workspaceId,
    organization_id: organizationId,
    url,
    secret,
    kinds,
    enabled,
    created_at: new Date().toISOString(),
    created_by: principalId,
  };
  await notify.insertSubscription(row);
  return Response.json({ subscription: toJson(row), secret }, { status: 201 });
}

async function patchSubscription(
  request: Request,
  row: NotifySubscriptionRow,
  notify: NotifyStore,
): Promise<Response> {
  const body = await readJson(request);
  if (!isRecord(body)) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const patch: { kinds?: NotifySubscriptionRow["kinds"]; enabled?: number } = {};
  if (body.kinds !== undefined) {
    const kinds = parseKinds(body.kinds);
    if (!kinds) {
      return Response.json({ error: "bad_request" }, { status: 400 });
    }
    patch.kinds = kinds;
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") {
      return Response.json({ error: "bad_request" }, { status: 400 });
    }
    patch.enabled = body.enabled ? 1 : 0;
  }
  await notify.updateSubscription(row.id, patch);
  const updated = await notify.getSubscription(row.id);
  if (!updated) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  return Response.json({ subscription: toJson(updated) });
}

function toJson(row: NotifySubscriptionPublic) {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    organization_id: row.organization_id,
    url: row.url,
    kinds: row.kinds,
    enabled: row.enabled === 1,
    created_at: row.created_at,
    created_by: row.created_by,
  };
}

function parseUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!parsed.hostname) return null;
    return value;
  } catch {
    return null;
  }
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
