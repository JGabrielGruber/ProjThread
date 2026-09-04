import {
  NODE_SUMMARY_MAX_BYTES,
  NODE_TITLE_MAX_BYTES,
  utf8Bytes,
} from "./wiki-text.ts";

export const SELECTION_MAX_CHARS = 8000;

export type CaptureHarvest = {
  url: string;
  page_title: string;
  selection: string | null;
  viewport: { width: number; height: number } | null;
};

export type CaptureMeta = CaptureHarvest & { captured_at: string };

export type CaptureApi = {
  createNode(
    workspaceId: string,
    body: Record<string, unknown>,
  ): Promise<{ node: { id: string } }>;
  includeNode(fromId: string, childId: string): Promise<void>;
  linkProject(nodeId: string, projectId: string): Promise<void>;
  refNode(fromId: string, toId: string): Promise<void>;
  createBlobNode?(
    workspaceId: string,
    form: FormData,
  ): Promise<{ node: { id: string } }>;
};

export type ReportInput = {
  workspaceId: string;
  projectId: string;
  sentence: string;
  type?: "note" | "research";
  harvest: CaptureHarvest;
  refId?: string | null;
  screenshot?: { bytes: Uint8Array; mime: string; filename: string } | null;
  files?: { bytes: Uint8Array; mime: string; filename: string }[] | null;
  now?: () => string;
};

export type ReportResult = {
  rootId: string;
  metadataId: string;
  screenshotId: string | null;
  fileIds: string[];
};

export function parseOrigin(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  if (url.search || url.hash) return null;
  return url.origin;
}

export function clipUtf8(text: string, maxBytes: number): string {
  let s = text;
  while (s.length > 0 && utf8Bytes(s) > maxBytes) s = s.slice(0, -1);
  return s;
}

export function rootTitle(pageTitle: string): string {
  const t = pageTitle.trim() || "Capture";
  return clipUtf8(t, NODE_TITLE_MAX_BYTES);
}

export function rootSummary(sentence: string): string {
  const line = sentence.trim().split("\n")[0] ?? "";
  return clipUtf8(line, NODE_SUMMARY_MAX_BYTES);
}

export function metadataPayload(
  harvest: CaptureHarvest,
  capturedAt: string,
): CaptureMeta {
  let selection = harvest.selection;
  if (selection === "") selection = null;
  if (selection && selection.length > SELECTION_MAX_CHARS) {
    selection = selection.slice(0, SELECTION_MAX_CHARS);
  }
  return {
    url: harvest.url,
    page_title: harvest.page_title,
    selection,
    viewport: harvest.viewport,
    captured_at: capturedAt,
  };
}

export function pngFromDataUrl(
  dataUrl: string,
): { bytes: Uint8Array; mime: string; filename: string } | null {
  const match = /^data:(image\/png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) return null;
  const bin = atob(match[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, mime: "image/png", filename: "capture.png" };
}

export async function fileReport(
  api: CaptureApi,
  input: ReportInput,
): Promise<ReportResult> {
  const sentence = input.sentence.trim();
  if (!sentence) throw new Error("sentence");
  if (!input.projectId) throw new Error("project");
  const capturedAt = (input.now ?? (() => new Date().toISOString()))();
  const type = input.type ?? "note";
  const root = await api.createNode(input.workspaceId, {
    title: rootTitle(input.harvest.page_title),
    type,
    payload_kind: "markdown",
    content: sentence,
    summary: rootSummary(sentence),
  });
  const metadata = await api.createNode(input.workspaceId, {
    title: "Capture metadata",
    type: "note",
    payload_kind: "json",
    content: JSON.stringify(metadataPayload(input.harvest, capturedAt)),
  });
  await api.includeNode(root.node.id, metadata.node.id);
  let screenshotId: string | null = null;
  if (input.screenshot && api.createBlobNode) {
    const form = new FormData();
    form.set("title", "Capture screenshot");
    form.set("type", "note");
    form.set("payload_kind", "blob");
    form.set(
      "file",
      new Blob([input.screenshot.bytes], { type: input.screenshot.mime }),
      input.screenshot.filename,
    );
    const shot = await api.createBlobNode(input.workspaceId, form);
    screenshotId = shot.node.id;
    await api.includeNode(root.node.id, shot.node.id);
  }
  const fileIds: string[] = [];
  for (const file of input.files ?? []) {
    if (!api.createBlobNode) throw new Error("blob");
    const title = file.filename.trim()
      ? rootTitle(file.filename)
      : "Capture file";
    const form = new FormData();
    form.set("title", title);
    form.set("type", "note");
    form.set("payload_kind", "blob");
    form.set(
      "file",
      new Blob([file.bytes], { type: file.mime }),
      file.filename.trim() || "file",
    );
    const node = await api.createBlobNode(input.workspaceId, form);
    fileIds.push(node.node.id);
    await api.includeNode(root.node.id, node.node.id);
  }
  await api.linkProject(root.node.id, input.projectId);
  const refId = input.refId?.trim();
  if (refId) await api.refNode(root.node.id, refId);
  return {
    rootId: root.node.id,
    metadataId: metadata.node.id,
    screenshotId,
    fileIds,
  };
}
