import { parseSessionId } from "../lib/cookies.ts";
import { newId } from "../lib/id.ts";
import {
  rejectContent,
  rejectSummary,
  rejectTitle,
  stripRawHtml,
} from "../lib/wiki-text.ts";
import type { CatalogStore } from "./catalog.ts";
import type { Env } from "./env.ts";
import { resolveSession, type SessionStore } from "./session.ts";
import type { NodeRow, NodeType, WikiStore } from "./wiki.ts";

const NODE_TYPES = new Set<NodeType>([
  "note",
  "decision",
  "process",
  "research",
]);

export async function handleWiki(
  request: Request,
  env: Env,
  sessions: SessionStore,
  catalog: CatalogStore,
  wiki: WikiStore,
): Promise<Response> {
  const sessionId = parseSessionId(request.headers.get("cookie"));
  if (!sessionId) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const principal = await resolveSession(sessions, sessionId);
  if (!principal) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const workspaceId = matchWorkspaceNodes(url.pathname);
  if (workspaceId) {
    const membership = await catalog.getMembership(workspaceId, principal.id);
    if (!membership) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    if (request.method === "GET") {
      const nodes = await wiki.listNodes(workspaceId);
      return Response.json({ nodes });
    }
    if (request.method === "POST") {
      return createNode(request, workspaceId, membership.organization_id, catalog, wiki);
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const nodePath = matchNodePath(url.pathname);
  if (nodePath) {
    const node = await wiki.getNode(nodePath.id);
    if (!node) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    const membership = await catalog.getMembership(
      node.workspace_id,
      principal.id,
    );
    if (!membership) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    if (!nodePath.workItems && request.method === "GET") {
      return nodeResponse(wiki, node);
    }
    if (!nodePath.workItems && request.method === "PATCH") {
      return patchNode(request, wiki, node);
    }
    if (nodePath.workItems && request.method === "POST") {
      return linkWorkItem(request, catalog, wiki, node);
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  return Response.json({ error: "not_found" }, { status: 404 });
}

async function createNode(
  request: Request,
  workspaceId: string,
  organizationId: string,
  catalog: CatalogStore,
  wiki: WikiStore,
): Promise<Response> {
  const body = await readJson(request);
  if (!isRecord(body)) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  if ("payload_kind" in body && body.payload_kind !== "markdown") {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const type = parseType(body.type, true);
  if (type === null) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  if (typeof body.title !== "string") {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const title = stripRawHtml(body.title).trim();
  if (rejectTitle(title)) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const summary = parseOptionalText(body, "summary");
  if (summary === false || rejectSummary(summary)) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const content = parseOptionalText(body, "content");
  if (content === false || rejectContent(content)) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const workItemId = parseOptionalId(body, "work_item_id");
  if (workItemId === false) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  if (workItemId) {
    const item = await catalog.getWorkItem(workItemId);
    if (!item || item.workspace_id !== workspaceId) {
      return Response.json({ error: "bad_request" }, { status: 400 });
    }
  }

  const now = new Date().toISOString();
  const row: NodeRow = {
    id: newId(),
    workspace_id: workspaceId,
    organization_id: organizationId,
    type,
    payload_kind: "markdown",
    title,
    summary,
    content,
    blob_key: null,
    mime_type: null,
    byte_size: null,
    filename: null,
    created_at: now,
    updated_at: now,
  };
  await wiki.insertNode(row);
  if (workItemId) {
    await wiki.linkNodeWorkItem(row.id, workItemId);
  }
  return nodeResponse(wiki, row, 201);
}

async function patchNode(
  request: Request,
  wiki: WikiStore,
  node: NodeRow,
): Promise<Response> {
  const body = await readJson(request);
  if (!isRecord(body)) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  if ("payload_kind" in body) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const patch: {
    type?: NodeType;
    title?: string;
    summary?: string | null;
    content?: string | null;
    updated_at: string;
  } = { updated_at: new Date().toISOString() };

  if ("type" in body) {
    const type = parseType(body.type, false);
    if (type === null) {
      return Response.json({ error: "bad_request" }, { status: 400 });
    }
    patch.type = type;
  }
  if ("title" in body) {
    if (typeof body.title !== "string") {
      return Response.json({ error: "bad_request" }, { status: 400 });
    }
    const title = stripRawHtml(body.title).trim();
    if (rejectTitle(title)) {
      return Response.json({ error: "bad_request" }, { status: 400 });
    }
    patch.title = title;
  }
  if ("summary" in body) {
    const summary = parseOptionalText(body, "summary");
    if (summary === false || rejectSummary(summary)) {
      return Response.json({ error: "bad_request" }, { status: 400 });
    }
    patch.summary = summary;
  }
  if ("content" in body) {
    const content = parseOptionalText(body, "content");
    if (content === false || rejectContent(content)) {
      return Response.json({ error: "bad_request" }, { status: 400 });
    }
    patch.content = content;
  }

  await wiki.updateNode(node.id, patch);
  const updated = await wiki.getNode(node.id);
  if (!updated) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  return nodeResponse(wiki, updated);
}

async function linkWorkItem(
  request: Request,
  catalog: CatalogStore,
  wiki: WikiStore,
  node: NodeRow,
): Promise<Response> {
  const body = await readJson(request);
  if (!isRecord(body) || typeof body.work_item_id !== "string") {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const item = await catalog.getWorkItem(body.work_item_id);
  if (!item || item.workspace_id !== node.workspace_id) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const result = await wiki.linkNodeWorkItem(node.id, body.work_item_id);
  return nodeResponse(wiki, node, result === "inserted" ? 201 : 200);
}

async function nodeResponse(
  wiki: WikiStore,
  node: NodeRow,
  status = 200,
): Promise<Response> {
  const work_item_ids = await wiki.listNodeWorkItemIds(node.id);
  return Response.json({ node, work_item_ids }, { status });
}

function parseType(value: unknown, optional: boolean): NodeType | null {
  if (value === undefined) return optional ? "note" : null;
  if (typeof value !== "string" || !NODE_TYPES.has(value as NodeType)) {
    return null;
  }
  return value as NodeType;
}

function parseOptionalText(
  body: Record<string, unknown>,
  key: string,
): string | null | false {
  if (!(key in body) || body[key] === null) return null;
  if (typeof body[key] !== "string") return false;
  return stripRawHtml(body[key]);
}

function parseOptionalId(
  body: Record<string, unknown>,
  key: string,
): string | null | false {
  if (!(key in body) || body[key] === null || body[key] === undefined) {
    return null;
  }
  if (typeof body[key] !== "string" || body[key] === "") return false;
  return body[key];
}

function matchWorkspaceNodes(pathname: string): string | null {
  const prefix = "/api/workspaces/";
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  const workspaceId = rest.slice(0, slash);
  const resource = rest.slice(slash + 1);
  if (!workspaceId || workspaceId.includes("/") || resource !== "nodes") {
    return null;
  }
  return workspaceId;
}

function matchNodePath(
  pathname: string,
): { id: string; workItems: boolean } | null {
  const prefix = "/api/nodes/";
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  const slash = rest.indexOf("/");
  if (slash === -1) {
    return rest && !rest.includes("/") ? { id: rest, workItems: false } : null;
  }
  const id = rest.slice(0, slash);
  const tail = rest.slice(slash + 1);
  if (!id || tail !== "work-items") return null;
  return { id, workItems: true };
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
