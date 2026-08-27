import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createPinia, setActivePinia } from "pinia";
import { useRoomStore } from "./room.ts";

type FakeSocket = {
  url: string;
  sent: string[];
  readyState: number;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  send(data: string): void;
  close(): void;
  emitMessage(data: unknown): void;
  emitClose(code: number): void;
};

function installFakeWebSocket(): {
  sockets: FakeSocket[];
  restore: () => void;
} {
  const sockets: FakeSocket[] = [];
  const Original = globalThis.WebSocket;
  const originalLocation = globalThis.location;

  class FakeWebSocket {
    url: string;
    sent: string[] = [];
    readyState = 1;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: ((event: { code: number }) => void) | null = null;
    static OPEN = 1;

    constructor(url: string) {
      this.url = url;
      sockets.push(this);
    }

    send(data: string) {
      this.sent.push(data);
    }

    close() {
      this.readyState = 3;
    }

    emitMessage(data: unknown) {
      this.onmessage?.({ data: JSON.stringify(data) });
    }

    emitClose(code: number) {
      this.readyState = 3;
      this.onclose?.({ code });
    }
  }

  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { protocol: "http:", host: "127.0.0.1:8787" },
  });

  return {
    sockets,
    restore() {
      globalThis.WebSocket = Original;
      Object.defineProperty(globalThis, "location", {
        configurable: true,
        value: originalLocation,
      });
    },
  };
}

const item = {
  id: "wi-1",
  title: "Card",
  stage_key: "backlog",
  project_id: "p1",
  workspace_id: "w1",
  organization_id: "o1",
  owner_id: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("room store", () => {
  const originalFetch = globalThis.fetch;
  let sockets: FakeSocket[] = [];
  let restoreWs: () => void = () => {};

  beforeEach(() => {
    setActivePinia(createPinia());
    const fake = installFakeWebSocket();
    sockets = fake.sockets;
    restoreWs = fake.restore;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    restoreWs();
  });

  function jsonFor(url: string, extra?: { events?: unknown[] }): Response {
    if (url.endsWith("/events")) {
      return Response.json({ events: extra?.events ?? [] });
    }
    return Response.json(item);
  }

  it("open GETs the work-item snapshot URL with credentials", async () => {
    const calls: { url: string; credentials: RequestCredentials | undefined }[] =
      [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      calls.push({
        url,
        credentials: init?.credentials,
      });
      return jsonFor(url);
    };
    const store = useRoomStore();
    await store.open("wi-1");
    assert.equal(calls.length, 2);
    const urls = calls.map((c) => c.url).sort();
    assert.deepEqual(urls, [
      "/api/work-items/wi-1",
      "/api/work-items/wi-1/events",
    ]);
    assert.equal(calls[0].credentials, "include");
    assert.equal(calls[1].credentials, "include");
  });

  it("second open while in-flight does not double-fetch", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    globalThis.fetch = async () => {
      calls += 1;
      await gate;
      return Response.json(item);
    };
    const store = useRoomStore();
    const first = store.open("wi-1");
    const second = store.open("wi-1");
    release();
    await Promise.all([first, second]);
    assert.equal(calls, 2);
  });

  it("401 => status no_session", async () => {
    globalThis.fetch = async () => new Response(null, { status: 401 });
    const store = useRoomStore();
    await store.open("wi-1");
    assert.equal(store.status, "no_session");
    assert.equal(sockets.length, 0);
  });

  it("fake WS receives a message then caught_up => line appears, status ready", async () => {
    globalThis.fetch = async () => Response.json(item);
    const store = useRoomStore();
    await store.open("wi-1");
    assert.equal(store.status, "loading");
    sockets[0]!.emitMessage({
      type: "message",
      seq: 1,
      kind: "chat",
      body: "hello",
      actor_id: "p1",
      event_id: null,
      created_at: "2026-01-01T00:00:00.000Z",
    });
    sockets[0]!.emitMessage({ type: "caught_up", last_seq: 1 });
    assert.equal(store.status, "ready");
    assert.equal(store.lines.length, 1);
    assert.equal(store.lines[0]!.body, "hello");
    assert.equal(store.lines[0]!.seq, 1);
  });

  it('send("hi") sends { type: "chat", body: "hi" }', async () => {
    globalThis.fetch = async () => Response.json(item);
    const store = useRoomStore();
    await store.open("wi-1");
    sockets[0]!.emitMessage({ type: "caught_up", last_seq: 0 });
    store.send("hi");
    assert.equal(sockets[0]!.sent.length, 1);
    assert.deepEqual(JSON.parse(sockets[0]!.sent[0]!), {
      type: "chat",
      body: "hi",
    });
  });

  it("after a chat seq 2, close code 1006 => new WebSocket URL contains last_seq=2", async () => {
    globalThis.fetch = async () => Response.json(item);
    const store = useRoomStore();
    await store.open("wi-1");
    sockets[0]!.emitMessage({
      type: "message",
      seq: 2,
      kind: "chat",
      body: "later",
      actor_id: "p1",
      event_id: null,
      created_at: "2026-01-01T00:00:00.000Z",
    });
    sockets[0]!.emitMessage({ type: "caught_up", last_seq: 2 });
    sockets[0]!.emitClose(1006);
    assert.equal(sockets.length, 2);
    assert.match(sockets[1]!.url, /last_seq=2/);
    assert.equal(
      sockets[1]!.url,
      "ws://127.0.0.1:8787/api/rooms/wi-1?last_seq=2",
    );
  });

  it("close 4001 => no second WebSocket", async () => {
    globalThis.fetch = async () => Response.json(item);
    const store = useRoomStore();
    await store.open("wi-1");
    sockets[0]!.emitMessage({ type: "caught_up", last_seq: 0 });
    sockets[0]!.emitClose(4001);
    assert.equal(store.status, "no_session");
    assert.equal(sockets.length, 1);
  });

  it("open fetches /api/work-items/wi-1/events", async () => {
    const urls: string[] = [];
    globalThis.fetch = async (input) => {
      const url = String(input);
      urls.push(url);
      return jsonFor(url);
    };
    const store = useRoomStore();
    await store.open("wi-1");
    assert.ok(urls.includes("/api/work-items/wi-1/events"));
  });

  it("activity message seq 2 sets last_seq=2 on reconnect with no chat", async () => {
    const event = {
      id: "ev-1",
      work_item_id: "wi-1",
      type: "note",
      from_value: null,
      to_value: null,
      body: "keep",
      actor_id: "p1",
      ref_node_id: null,
      created_at: "2026-01-01T00:00:01.000Z",
    };
    globalThis.fetch = async (input) => jsonFor(String(input), { events: [event] });
    const store = useRoomStore();
    await store.open("wi-1");
    sockets[0]!.emitMessage({
      type: "message",
      seq: 2,
      kind: "activity",
      body: "",
      actor_id: null,
      event_id: "ev-1",
      created_at: "2026-01-01T00:00:01.000Z",
    });
    sockets[0]!.emitMessage({ type: "caught_up", last_seq: 2 });
    assert.equal(store.lines.length, 1);
    assert.equal(store.lines[0]!.kind, "activity");
    sockets[0]!.emitClose(1006);
    assert.equal(sockets.length, 2);
    assert.match(sockets[1]!.url, /last_seq=2/);
  });

  it('postEvent({ type: "note", body: "x" }) POSTs /api/work-items/wi-1/events', async () => {
    const posts: { url: string; body: unknown }[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (init?.method === "POST") {
        posts.push({ url, body: JSON.parse(String(init.body)) });
        return Response.json(
          {
            event: {
              id: "ev-2",
              work_item_id: "wi-1",
              type: "note",
              from_value: null,
              to_value: null,
              body: "x",
              actor_id: "p1",
              ref_node_id: null,
              created_at: "2026-01-01T00:00:02.000Z",
            },
            work_item: { ...item, title: "Card" },
          },
          { status: 201 },
        );
      }
      return jsonFor(url);
    };
    const store = useRoomStore();
    await store.open("wi-1");
    await store.postEvent({ type: "note", body: "x" });
    assert.equal(posts.length, 1);
    assert.equal(posts[0]!.url, "/api/work-items/wi-1/events");
    assert.deepEqual(posts[0]!.body, { type: "note", body: "x" });
  });
});
