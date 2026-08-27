import { defineStore } from "pinia";
import { ref } from "vue";

export type RoomStatus = "idle" | "loading" | "ready" | "error" | "no_session";

export type ChatLine = {
  seq: number;
  body: string;
  actor_id: string | null;
  created_at: string;
};

export type RoomItem = {
  id: string;
  title: string;
  stage_key: string;
};

type MessageFrame = {
  type: "message";
  seq: number;
  kind: string;
  body: string;
  actor_id: string | null;
  created_at: string;
};

export const useRoomStore = defineStore("room", () => {
  const status = ref<RoomStatus>("idle");
  const item = ref<RoomItem | null>(null);
  const lines = ref<ChatLine[]>([]);
  const itemId = ref<string | null>(null);
  const loading = ref(false);
  let socket: WebSocket | null = null;
  let reconnectScheduled = false;

  function lastSeq(): number {
    let max = 0;
    for (const line of lines.value) {
      if (line.seq > max) max = line.seq;
    }
    return max;
  }

  function connect(): void {
    const id = itemId.value;
    if (!id) return;
    const proto = globalThis.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${globalThis.location.host}/api/rooms/${id}?last_seq=${lastSeq()}`;
    const next = new WebSocket(url);
    socket = next;
    next.onmessage = (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!parsed || typeof parsed !== "object") return;
      const frame = parsed as { type?: unknown; kind?: unknown };
      if (frame.type === "message" && frame.kind === "chat") {
        const message = parsed as MessageFrame;
        if (lines.value.some((line) => line.seq === message.seq)) return;
        lines.value = [
          ...lines.value,
          {
            seq: message.seq,
            body: message.body,
            actor_id: message.actor_id,
            created_at: message.created_at,
          },
        ];
        return;
      }
      if (frame.type === "caught_up") {
        status.value = "ready";
        return;
      }
      if (frame.type === "error") {
        return;
      }
    };
    next.onclose = (event) => {
      if (socket !== next) return;
      socket = null;
      if (event.code === 4001) {
        status.value = "no_session";
        return;
      }
      if (status.value === "idle" || itemId.value !== id) return;
      if (reconnectScheduled) return;
      reconnectScheduled = true;
      connect();
    };
  }

  async function open(nextItemId: string): Promise<void> {
    if (loading.value) return;
    loading.value = true;
    status.value = "loading";
    reconnectScheduled = false;
    if (itemId.value !== nextItemId) {
      lines.value = [];
    }
    itemId.value = nextItemId;
    try {
      const res = await fetch(`/api/work-items/${nextItemId}`, {
        credentials: "include",
      });
      if (res.status === 401) {
        status.value = "no_session";
        return;
      }
      if (!res.ok) {
        status.value = "error";
        return;
      }
      const body = (await res.json()) as RoomItem;
      item.value = {
        id: body.id,
        title: body.title,
        stage_key: body.stage_key,
      };
      connect();
    } catch {
      status.value = "error";
    } finally {
      loading.value = false;
    }
  }

  function send(body: string): void {
    const trimmed = body.trim();
    if (!trimmed) return;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: "chat", body }));
  }

  function close(): void {
    status.value = "idle";
    const current = socket;
    socket = null;
    current?.close();
  }

  return { status, item, lines, open, send, close };
});
