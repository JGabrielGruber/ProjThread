const CACHE = "pt-shell-v1";
const SHARE_CACHE = "pt-share";
const SHARE_PATH = "/capture";
const SHARE_FILES_FIELD = "media";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function parseShareId(raw) {
  if (!raw) return null;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(raw)) return null;
  return raw;
}

async function handleSharePost(request) {
  const form = await request.formData();
  const id = crypto.randomUUID();
  const title = typeof form.get("title") === "string" ? form.get("title").trim() : "";
  const text = typeof form.get("text") === "string" ? form.get("text").trim() : "";
  const url = typeof form.get("url") === "string" ? form.get("url").trim() : "";
  const files = [];
  for (const entry of form.getAll(SHARE_FILES_FIELD)) {
    if (!(entry instanceof File)) continue;
    if (!entry.type.startsWith("image/")) continue;
    files.push(entry);
  }
  const cache = await caches.open(SHARE_CACHE);
  const index = {
    title,
    text,
    url,
    files: files.map((file, i) => ({
      filename: file.name || "image",
      mime: file.type,
      i,
    })),
  };
  await cache.put(
    `/__share/${id}/index`,
    new Response(JSON.stringify(index), {
      headers: { "content-type": "application/json" },
    }),
  );
  for (let i = 0; i < files.length; i += 1) {
    await cache.put(
      `/__share/${id}/${i}`,
      new Response(files[i], {
        headers: { "content-type": files[i].type || "application/octet-stream" },
      }),
    );
  }
  return Response.redirect(new URL(`${SHARE_PATH}?share=${id}`, request.url), 303);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (
    url.pathname.startsWith("/api") ||
    req.headers.get("upgrade")?.toLowerCase() === "websocket"
  ) {
    event.respondWith(fetch(req));
    return;
  }
  if (req.method === "POST" && url.pathname === SHARE_PATH) {
    event.respondWith(handleSharePost(req));
    return;
  }
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) await cache.put(req, res.clone());
        return res;
      }),
    );
  }
});

