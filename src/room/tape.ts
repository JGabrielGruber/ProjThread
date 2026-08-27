export const CHAT_BODY_MAX_BYTES = 8192;
export const ACTIVITY_BODY_MAX_BYTES = 2048;

export type TapeKind = "chat" | "activity";

export type TapeMessage = {
  seq: number;
  kind: TapeKind;
  body: string;
  actor_id: string | null;
  event_id: string | null;
  created_at: string;
};

export type Tape = {
  ensureSchema(): void;
  appendChat(input: {
    body: string;
    actor_id: string | null;
    created_at: string;
  }): TapeMessage;
  appendActivity(input: {
    event_id: string;
    created_at: string;
  }): TapeMessage;
  replay(lastSeq: number): TapeMessage[];
  lastSeq(): number;
};

export const TAPE_EVENT_ID_INDEX = `CREATE UNIQUE INDEX IF NOT EXISTS message_event_id
  ON message (event_id) WHERE event_id IS NOT NULL`;

export const TAPE_SCHEMA = `CREATE TABLE IF NOT EXISTS message (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('chat', 'activity')),
  body TEXT NOT NULL,
  actor_id TEXT,
  event_id TEXT,
  created_at TEXT NOT NULL
)`;

export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export function rejectChatBody(body: string): "empty" | "too_large" | null {
  if (body.trim() === "") return "empty";
  if (utf8Bytes(body) > CHAT_BODY_MAX_BYTES) return "too_large";
  return null;
}

export function rejectActivityBody(
  body: string | null | undefined,
  required: boolean,
): "empty" | "too_large" | null {
  const text = body ?? "";
  if (text.trim() === "") return required ? "empty" : null;
  if (utf8Bytes(text) > ACTIVITY_BODY_MAX_BYTES) return "too_large";
  return null;
}

export function memoryTape(): Tape {
  const messages: TapeMessage[] = [];

  return {
    ensureSchema() {},
    appendChat({ body, actor_id, created_at }) {
      const rejected = rejectChatBody(body);
      if (rejected) throw new Error(rejected);
      const row: TapeMessage = {
        seq: messages.length + 1,
        kind: "chat",
        body,
        actor_id,
        event_id: null,
        created_at,
      };
      messages.push(row);
      return row;
    },
    appendActivity({ event_id, created_at }) {
      const eventId = event_id.trim();
      if (eventId === "") throw new Error("empty");
      const existing = messages.find((m) => m.event_id === eventId);
      if (existing) return existing;
      const row: TapeMessage = {
        seq: messages.length + 1,
        kind: "activity",
        body: "",
        actor_id: null,
        event_id: eventId,
        created_at,
      };
      messages.push(row);
      return row;
    },
    replay(lastSeq) {
      return messages.filter((m) => m.seq > lastSeq);
    },
    lastSeq() {
      return messages.length === 0 ? 0 : messages[messages.length - 1].seq;
    },
  };
}
