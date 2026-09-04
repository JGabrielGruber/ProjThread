import { BLOB_MAX_BYTES, parseMime, sanitizeFilename } from "../lib/blob.ts";
import { newId } from "../lib/id.ts";
import { sessionIdFromRequest } from "../lib/session-id.ts";
import { descendantIds } from "../lib/project-tree.ts";
import { wouldCycleIncludes } from "../lib/node-rel.ts";
import { canonicalizeJson } from "../lib/wiki-json.ts";
import {
  rejectContent,
  rejectSummary,
  rejectTitle,
  stripRawHtml,
} from "../lib/wiki-text.ts";
import type { BlobStore } from "./blobs.ts";
import type { CatalogStore } from "./catalog.ts";
import type { Env } from "./env.ts";
import { enqueueIfMatch, type NotifyStore } from "./notify.ts";
import { resolveSession, type SessionStore } from "./session.ts";
import type { NodeListRow, NodeRow, NodeType, WikiStore } from "./wiki.ts";

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
  notify: NotifyStore | null = null,
  blobs: BlobStore | null = null,
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
  const workItemNodes = matchWorkItemNodes(url.pathname);
  if (workItemNodes) {
    return handleWorkItemNodes(
      request,
      workItemNodes.id,
      principal.id,
      catalog,
      wiki,
    );
  }

  const workspaceId = matchWorkspaceNodes(url.pathname);
  if (workspaceId) {
    const membership = await catalog.getMembership(workspaceId, principal.id);
    if (!membership) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    if (request.method === "GET") {
      const projectId = url.searchParams.get("project_id");
      let projectIds: string[] | undefined;
      if (projectId) {
        const forest = await catalog.listProjects(workspaceId);
        projectIds = [...descendantIds(projectId, forest)];
      }
      let nodes = await wiki.listNodes(workspaceId, projectIds);
      if (projectIds) {
        nodes = await filterNodesByProjects(nodes, projectIds, wiki, catalog);
      }
      return Response.json({ nodes });
    }
    if (request.method === "POST") {
      return createNode(
        request,
        env,
        workspaceId,
        membership.organization_id,
        catalog,
        wiki,
        notify,
        blobs,
      );
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
    if (!nodePath.tail && request.method === "GET") {
      return nodeResponse(wiki, node);
    }
    if (!nodePath.tail && request.method === "PATCH") {
      return patchNode(request, env, wiki, node, notify);
    }
    if (nodePath.tail === "blob" && request.method === "GET") {
      return getBlobBytes(node, blobs);
    }
    if (nodePath.tail === "blob" && request.method === "PUT") {
      return putBlobBytes(request, env, wiki, node, notify, blobs);
    }
    if (nodePath.tail === "work-items" && request.method === "POST") {
      return linkWorkItem(request, catalog, wiki, node);
    }
    if (nodePath.tail === "projects" && request.method === "POST") {
      return linkProject(request, catalog, wiki, node);
    }
    if (nodePath.tail === "includes" && request.method === "POST") {
      return includeChild(request, env, wiki, node, notify);
    }
    if (nodePath.tail === "refs" && request.method === "POST") {
      return refNode(request, env, wiki, node, notify);
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  return Response.json({ error: "not_found" }, { status: 404 });
}

async function createNode(
  request: Request,
  env: Env,
  workspaceId: string,
  organizationId: string,
  catalog: CatalogStore,
  wiki: WikiStore,
  notify: NotifyStore | null,
  blobs: BlobStore | null,
): Promise<Response> {
  if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    return createBlobNode(
      request,
      env,
      workspaceId,
      organizationId,
      catalog,
      wiki,
      notify,
      blobs,
    );
  }
  const body = await readJson(request);
  if (!isRecord(body)) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const payloadKind = parseCreatePayloadKind(body);
  if (payloadKind === null) {
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
  const content = parseOptionalText(body, "content", payloadKind !== "json");
  if (content === false) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  let storedContent = content;
  if (payloadKind === "json" && content !== null) {
    const canonical = canonicalizeJson(content);
    if (canonical === null) {
      return Response.json({ error: "bad_request" }, { status: 400 });
    }
    storedContent = canonical;
  }
  if (rejectContent(storedContent)) {
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
    payload_kind: payloadKind,
    title,
    summary,
    content: storedContent,
    blob_key: null,
    mime_type: null,
    byte_size: null,
    filename: null,
    created_at: now,
    updated_at: now,
    pinned: 0,
  };
  await wiki.insertNode(row);
  if (workItemId) {
    await wiki.linkNodeWorkItem(row.id, workItemId);
  }
  await enqueueIfMatch(env.NOTIFY, notify, "node.created", row);
  return nodeResponse(wiki, row, 201);
}

async function createBlobNode(
  request: Request,
  env: Env,
  workspaceId: string,
  organizationId: string,
  catalog: CatalogStore,
  wiki: WikiStore,
  notify: NotifyStore | null,
  blobs: BlobStore | null,
): Promise<Response> {
  if (!blobs) {
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
  const form = await request.formData();
  if (form.get("payload_kind") !== "blob") {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const body = formFields(form);
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
  const file = form.get("file");
  if (!(file instanceof Blob) || file.size === 0) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const mime = parseMime(file.type);
  if (!mime) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  if (file.size > BLOB_MAX_BYTES) {
    return Response.json({ error: "too_large" }, { status: 413 });
  }
  const id = newId();
  const key = `${workspaceId}/${id}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > BLOB_MAX_BYTES) {
    return Response.json({ error: "too_large" }, { status: 413 });
  }
  const filename = sanitizeFilename(file instanceof File ? file.name : "blob");
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
  await blobs.put(key, bytes, mime);
  const now = new Date().toISOString();
  const row: NodeRow = {
    id,
    workspace_id: workspaceId,
    organization_id: organizationId,
    type,
    payload_kind: "blob",
    title,
    summary,
    content,
    blob_key: key,
    mime_type: mime,
    byte_size: bytes.byteLength,
    filename,
    created_at: now,
    updated_at: now,
    pinned: 0,
  };
  await wiki.insertNode(row);
  if (workItemId) {
    await wiki.linkNodeWorkItem(row.id, workItemId);
  }
  await enqueueIfMatch(env.NOTIFY, notify, "node.created", row);
  return nodeResponse(wiki, row, 201);
}

async function getBlobBytes(
  node: NodeRow,
  blobs: BlobStore | null,
): Promise<Response> {
  if (node.payload_kind !== "blob" || !node.blob_key || !blobs) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const bytes = await blobs.get(node.blob_key);
  if (!bytes) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const filename = sanitizeFilename(node.filename);
  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": node.mime_type ?? "application/octet-stream",
      "content-disposition": `inline; filename="${filename}"`,
      "cache-control": "private, max-age=300",
    },
  });
}

async function putBlobBytes(
  request: Request,
  env: Env,
  wiki: WikiStore,
  node: NodeRow,
  notify: NotifyStore | null,
  blobs: BlobStore | null,
): Promise<Response> {
  if (node.payload_kind !== "blob") {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  if (!blobs) {
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
  if (!node.blob_key) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader != null && lengthHeader !== "") {
    const declared = Number.parseInt(lengthHeader, 10);
    if (Number.isFinite(declared) && declared > BLOB_MAX_BYTES) {
      return Response.json({ error: "too_large" }, { status: 413 });
    }
  }
  const buf = await request.arrayBuffer();
  if (buf.byteLength === 0) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  if (buf.byteLength > BLOB_MAX_BYTES) {
    return Response.json({ error: "too_large" }, { status: 413 });
  }
  const mime = parseMime(request.headers.get("content-type"));
  if (!mime) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const filename = sanitizeFilename(
    request.headers.get("x-filename") ?? node.filename ?? "blob",
  );
  const bytes = new Uint8Array(buf);
  await blobs.put(node.blob_key, bytes, mime);
  const updated_at = new Date().toISOString();
  await wiki.updateNode(node.id, {
    mime_type: mime,
    byte_size: bytes.byteLength,
    filename,
    updated_at,
  });
  const updated = await wiki.getNode(node.id);
  if (!updated) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  await enqueueIfMatch(env.NOTIFY, notify, "node.updated", updated);
  return nodeResponse(wiki, updated, 200);
}

function formFields(form: FormData): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    if (key === "file") continue;
    if (typeof value === "string") body[key] = value;
  }
  return body;
}

async function patchNode(
  request: Request,
  env: Env,
  wiki: WikiStore,
  node: NodeRow,
  notify: NotifyStore | null,
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
    pinned?: number;
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
    const content = parseOptionalText(
      body,
      "content",
      node.payload_kind !== "json",
    );
    if (content === false) {
      return Response.json({ error: "bad_request" }, { status: 400 });
    }
    if (node.payload_kind === "json" && content !== null) {
      const canonical = canonicalizeJson(content);
      if (canonical === null) {
        return Response.json({ error: "bad_request" }, { status: 400 });
      }
      if (rejectContent(canonical)) {
        return Response.json({ error: "bad_request" }, { status: 400 });
      }
      patch.content = canonical;
    } else {
      if (rejectContent(content)) {
        return Response.json({ error: "bad_request" }, { status: 400 });
      }
      patch.content = content;
    }
  }
  if ("pinned" in body) {
    if (typeof body.pinned !== "boolean") {
      return Response.json({ error: "bad_request" }, { status: 400 });
    }
    patch.pinned = body.pinned ? 1 : 0;
  }

  await wiki.updateNode(node.id, patch);
  const updated = await wiki.getNode(node.id);
  if (!updated) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  await enqueueIfMatch(env.NOTIFY, notify, "node.updated", updated);
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

async function linkProject(
  request: Request,
  catalog: CatalogStore,
  wiki: WikiStore,
  node: NodeRow,
): Promise<Response> {
  const body = await readJson(request);
  if (!isRecord(body) || typeof body.project_id !== "string" || body.project_id === "") {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const project = await catalog.getProject(body.project_id);
  if (!project || project.workspace_id !== node.workspace_id) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const result = await wiki.linkNodeProject(node.id, body.project_id);
  return nodeResponse(wiki, node, result === "inserted" ? 201 : 200);
}

async function includeChild(
  request: Request,
  env: Env,
  wiki: WikiStore,
  node: NodeRow,
  notify: NotifyStore | null,
): Promise<Response> {
  const body = await readJson(request);
  if (!isRecord(body) || typeof body.child_id !== "string" || body.child_id === "") {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const child = await wiki.getNode(body.child_id);
  if (!child || child.workspace_id !== node.workspace_id) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const edges = await wiki.listIncludeEdges(node.workspace_id);
  if (wouldCycleIncludes(node.id, child.id, edges)) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  let position: number;
  if ("position" in body) {
    if (typeof body.position !== "number" || !Number.isInteger(body.position)) {
      return Response.json({ error: "bad_request" }, { status: 400 });
    }
    position = body.position;
  } else {
    const existing = await wiki.listIncludes(node.id);
    const max = existing.reduce((m, row) => Math.max(m, row.position), -1);
    position = max + 1;
  }
  const result = await wiki.includeNode(node.id, child.id, position);
  if (result === "inserted") {
    await enqueueIfMatch(env.NOTIFY, notify, "node.included", node);
  }
  return nodeResponse(wiki, node, result === "inserted" ? 201 : 200);
}

async function refNode(
  request: Request,
  env: Env,
  wiki: WikiStore,
  node: NodeRow,
  notify: NotifyStore | null,
): Promise<Response> {
  const body = await readJson(request);
  if (!isRecord(body) || typeof body.to_id !== "string" || body.to_id === "") {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  if ("position" in body) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  if (body.to_id === node.id) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const target = await wiki.getNode(body.to_id);
  if (!target || target.workspace_id !== node.workspace_id) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const result = await wiki.refNode(node.id, target.id);
  if (result === "inserted") {
    await enqueueIfMatch(env.NOTIFY, notify, "node.cited", node);
  }
  return nodeResponse(wiki, node, result === "inserted" ? 201 : 200);
}

async function nodeResponse(
  wiki: WikiStore,
  node: NodeRow,
  status = 200,
): Promise<Response> {
  const [work_item_ids, project_ids, includes, refs] = await Promise.all([
    wiki.listNodeWorkItemIds(node.id),
    wiki.listNodeProjectIds(node.id),
    wiki.listIncludes(node.id),
    wiki.listRefs(node.id),
  ]);
  return Response.json(
    { node, work_item_ids, project_ids, includes, refs },
    { status },
  );
}

function parseType(value: unknown, optional: boolean): NodeType | null {
  if (value === undefined) return optional ? "note" : null;
  if (typeof value !== "string" || !NODE_TYPES.has(value as NodeType)) {
    return null;
  }
  return value as NodeType;
}

function parseCreatePayloadKind(
  body: Record<string, unknown>,
): "markdown" | "json" | null {
  if (!("payload_kind" in body) || body.payload_kind === undefined) {
    return "markdown";
  }
  if (body.payload_kind === "markdown" || body.payload_kind === "json") {
    return body.payload_kind;
  }
  return null;
}

function parseOptionalText(
  body: Record<string, unknown>,
  key: string,
  strip = true,
): string | null | false {
  if (!(key in body) || body[key] === null) return null;
  if (typeof body[key] !== "string") return false;
  return strip ? stripRawHtml(body[key]) : body[key];
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

async function filterNodesByProjects(
  nodes: NodeListRow[],
  projectIds: string[],
  wiki: WikiStore,
  catalog: CatalogStore,
): Promise<NodeListRow[]> {
  const allowed = new Set(projectIds);
  const out: NodeListRow[] = [];
  for (const node of nodes) {
    const linkedProjects = await wiki.listNodeProjectIds(node.id);
    if (linkedProjects.some((id) => allowed.has(id))) {
      out.push(node);
      continue;
    }
    const workItemIds = await wiki.listNodeWorkItemIds(node.id);
    let hit = false;
    for (const workItemId of workItemIds) {
      const item = await catalog.getWorkItem(workItemId);
      if (item && allowed.has(item.project_id)) {
        hit = true;
        break;
      }
    }
    if (hit) out.push(node);
  }
  return out;
}

async function handleWorkItemNodes(
  request: Request,
  workItemId: string,
  principalId: string,
  catalog: CatalogStore,
  wiki: WikiStore,
): Promise<Response> {
  const item = await catalog.getWorkItem(workItemId);
  if (!item) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const membership = await catalog.getMembership(
    item.workspace_id,
    principalId,
  );
  if (!membership) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  if (request.method === "GET") {
    const nodes = await wiki.listNodesForWorkItem(workItemId);
    return Response.json({ nodes });
  }
  if (request.method !== "POST") {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const body = await readJson(request);
  if (!isRecord(body) || typeof body.node_id !== "string" || !body.node_id) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const node = await wiki.getNode(body.node_id);
  if (!node || node.workspace_id !== item.workspace_id) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const result = await wiki.linkNodeWorkItem(node.id, workItemId);
  return Response.json(
    { nodes: await wiki.listNodesForWorkItem(workItemId) },
    { status: result === "inserted" ? 201 : 200 },
  );
}

function matchWorkItemNodes(pathname: string): { id: string } | null {
  const match = /^\/api\/work-items\/([^/]+)\/nodes$/.exec(pathname);
  if (!match?.[1]) return null;
  return { id: match[1] };
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
): {
  id: string;
  tail: "work-items" | "includes" | "refs" | "projects" | "blob" | null;
} | null {
  const prefix = "/api/nodes/";
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  const slash = rest.indexOf("/");
  if (slash === -1) {
    return rest && !rest.includes("/") ? { id: rest, tail: null } : null;
  }
  const id = rest.slice(0, slash);
  const tail = rest.slice(slash + 1);
  if (
    !id ||
    (tail !== "work-items" &&
      tail !== "includes" &&
      tail !== "refs" &&
      tail !== "projects" &&
      tail !== "blob")
  ) {
    return null;
  }
  return { id, tail };
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
