import { defineStore } from "pinia";
import { ref } from "vue";
import type {
  ActivityEvent,
  RoomItem,
  RoomStatus,
  TapeLine,
} from "../models/room.ts";
import { ApiError } from "../services/http.ts";
import {
  getWorkItem,
  listEvents,
  postEvent as postEventRequest,
} from "../services/room.ts";

export type {
  ActivityEvent,
  RoomItem,
  RoomStatus,
  TapeLine,
} from "../models/room.ts";

type MessageFrame = {
  type: "message";
  seq: number;
  kind: "chat" | "activity";
  body: string;
  actor_id: string | null;
  event_id: string | null;
  created_at: string;
};

export const useRoomStore = defineStore("room", () => {
  const status = ref<RoomStatus>("idle");
  const item = ref<RoomItem | null>(null);
  const lines = ref<TapeLine[]>([]);
  const events = ref<ActivityEvent[]>([]);
  const activityOnly = ref(false);
  const itemId = ref<string | null>(null);
  const loading = ref(false);
  let eventsLoading = false;
  let socket: WebSocket | null = null;
  let reconnectScheduled = false;

  function lastSeq(): number {
    let max = 0;
    for (const line of lines.value) {
      if (line.seq > max) max = line.seq;
    }
    return max;
  }

  function asRoomItem(body: RoomItem): RoomItem {
    return {
      id: body.id,
      title: body.title,
      stage_key: body.stage_key,
      owner_id: body.owner_id ?? null,
    };
  }

  async function refreshEvents(): Promise<void> {
    const id = itemId.value;
    if (!id || eventsLoading) return;
    eventsLoading = true;
    try {
      const payload = await listEvents(id);
      if (Array.isArray(payload.events)) {
        events.value = payload.events;
      }
    } catch {
      // ignore
    } finally {
      eventsLoading = false;
    }
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
      if (
        frame.type === "message" &&
        (frame.kind === "chat" || frame.kind === "activity")
      ) {
        const message = parsed as MessageFrame;
        if (lines.value.some((line) => line.seq === message.seq)) return;
        lines.value = [
          ...lines.value,
          {
            seq: message.seq,
            kind: message.kind,
            body: message.body,
            actor_id: message.actor_id,
            event_id: message.event_id,
            created_at: message.created_at,
          },
        ];
        if (
          message.kind === "activity" &&
          message.event_id &&
          !events.value.some((row) => row.id === message.event_id)
        ) {
          void refreshEvents();
        }
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
      status.value = "loading";
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
      events.value = [];
    }
    itemId.value = nextItemId;
    try {
      const [body, payload] = await Promise.all([
        getWorkItem(nextItemId),
        listEvents(nextItemId),
      ]);
      item.value = asRoomItem(body);
      events.value = Array.isArray(payload.events) ? payload.events : [];
      connect();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        status.value = "no_session";
      } else {
        status.value = "error";
      }
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

  async function postEvent(payload: {
    type: string;
    from?: string | null;
    to?: string | null;
    body?: string;
  }): Promise<void> {
    const id = itemId.value;
    if (!id) return;
    try {
      const data = await postEventRequest(id, payload);
      const idx = events.value.findIndex((row) => row.id === data.event.id);
      if (idx === -1) {
        events.value = [...events.value, data.event];
      } else {
        events.value = events.value.map((row) =>
          row.id === data.event.id ? data.event : row,
        );
      }
      if (data.work_item) {
        item.value = asRoomItem(data.work_item);
      }
    } catch {
      return;
    }
  }

  function close(): void {
    status.value = "idle";
    const current = socket;
    socket = null;
    current?.close();
  }

  return {
    status,
    item,
    lines,
    events,
    activityOnly,
    open,
    send,
    postEvent,
    close,
  };
});
