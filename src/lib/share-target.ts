import type { CaptureHarvest } from "./capture.ts";

export const SHARE_PATH = "/capture";
export const SHARE_CACHE = "pt-share";
export const SHARE_FILES_FIELD = "media";
export const SHARE_ID_QUERY = "share";

export type ShareFields = { title: string; text: string; url: string };

export type ShareFile = {
  filename: string;
  mime: string;
  bytes: Uint8Array;
};

export type SharePark = ShareFields & { files: ShareFile[] };

export type CacheLike = {
  put(request: RequestInfo | URL, response: Response): Promise<void>;
  match(request: RequestInfo | URL): Promise<Response | undefined>;
  delete(request: RequestInfo | URL): Promise<boolean>;
};

export function parseShareFields(input: {
  title?: FormDataEntryValue | string | null;
  text?: FormDataEntryValue | string | null;
  url?: FormDataEntryValue | string | null;
}): ShareFields {
  const asText = (value: FormDataEntryValue | string | null | undefined) => {
    if (typeof value !== "string") return "";
    return value.trim();
  };
  return {
    title: asText(input.title),
    text: asText(input.text),
    url: asText(input.url),
  };
}

export function firstHttpUrl(text: string): string | null {
  const match = /https?:\/\/[^\s]+/i.exec(text);
  if (!match) return null;
  const raw = match[0].replace(/[),.;]+$/g, "");
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

export function harvestFromShare(fields: ShareFields): CaptureHarvest {
  const url = fields.url || firstHttpUrl(fields.text) || "";
  return {
    url,
    page_title: fields.title || "Capture",
    selection: fields.text || null,
    viewport: null,
  };
}

export function suggestedSentence(fields: ShareFields): string {
  return fields.text || fields.title || fields.url;
}

export function parseShareId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(raw)) return null;
  return raw;
}

export function shareLandingPath(id: string): string {
  return `${SHARE_PATH}?${SHARE_ID_QUERY}=${encodeURIComponent(id)}`;
}

export function shareIndexKey(id: string): string {
  return `/__share/${id}/index`;
}

export function shareFileKey(id: string, index: number): string {
  return `/__share/${id}/${index}`;
}

export async function writeSharePark(
  cache: CacheLike,
  id: string,
  park: SharePark,
): Promise<void> {
  const index = {
    title: park.title,
    text: park.text,
    url: park.url,
    files: park.files.map((file, i) => ({
      filename: file.filename,
      mime: file.mime,
      i,
    })),
  };
  await cache.put(
    shareIndexKey(id),
    new Response(JSON.stringify(index), {
      headers: { "content-type": "application/json" },
    }),
  );
  for (const [i, file] of park.files.entries()) {
    await cache.put(
      shareFileKey(id, i),
      new Response(file.bytes, {
        headers: {
          "content-type": file.mime || "application/octet-stream",
        },
      }),
    );
  }
}

export async function readSharePark(
  cache: CacheLike,
  id: string,
): Promise<SharePark | null> {
  const indexRes = await cache.match(shareIndexKey(id));
  if (!indexRes) return null;
  const index = (await indexRes.json()) as {
    title?: string;
    text?: string;
    url?: string;
    files?: { filename?: string; mime?: string; i?: number }[];
  };
  const files: ShareFile[] = [];
  for (const row of index.files ?? []) {
    const i = row.i;
    if (typeof i !== "number") continue;
    const fileRes = await cache.match(shareFileKey(id, i));
    if (!fileRes) continue;
    const buf = new Uint8Array(await fileRes.arrayBuffer());
    files.push({
      filename: typeof row.filename === "string" ? row.filename : "image",
      mime: typeof row.mime === "string" ? row.mime : "application/octet-stream",
      bytes: buf,
    });
    await cache.delete(shareFileKey(id, i));
  }
  await cache.delete(shareIndexKey(id));
  return {
    title: typeof index.title === "string" ? index.title : "",
    text: typeof index.text === "string" ? index.text : "",
    url: typeof index.url === "string" ? index.url : "",
    files,
  };
}
