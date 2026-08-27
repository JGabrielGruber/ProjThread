import { DurableObject } from "cloudflare:workers";
import type { Env } from "../worker/env.ts";
import {
  rejectChatBody,
  TAPE_EVENT_ID_INDEX,
  TAPE_SCHEMA,
  type Tape,
  type TapeMessage,
} from "./tape.ts";

type SqlCursor = { toArray(): Record<string, unknown>[] };

type DurableObjectState = {
  acceptWebSocket(ws: HibernatableWebSocket): void;
  getWebSockets(): HibernatableWebSocket[];
  storage: {
    sql: {
      exec(query: string, ...binds: unknown[]): SqlCursor;
    };
  };
};

type HibernatableWebSocket = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
};

declare const WebSocketPair: {
  new (): { 0: HibernatableWebSocket; 1: HibernatableWebSocket };
};

type Attachment = { principalId: string };

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

function asTapeMessage(row: Record<string, unknown>): TapeMessage {
  return {
    seq: Number(row.seq),
    kind: row.kind === "activity" ? "activity" : "chat",
    body: String(row.body),
    actor_id: row.actor_id == null ? null : String(row.actor_id),
    event_id: row.event_id == null ? null : String(row.event_id),
    created_at: String(row.created_at),
  };
}

function sqlTape(sql: DurableObjectState["storage"]["sql"]): Tape {
  return {
    ensureSchema() {
      sql.exec(TAPE_SCHEMA);
      sql.exec(TAPE_EVENT_ID_INDEX);
    },
    appendChat({ body, actor_id, created_at }) {
      const rejected = rejectChatBody(body);
      if (rejected) throw new Error(rejected);
      const rows = sql
        .exec(
          `INSERT INTO message (kind, body, actor_id, event_id, created_at)
           VALUES ('chat', ?, ?, NULL, ?)
           RETURNING seq, kind, body, actor_id, event_id, created_at`,
          body,
          actor_id,
          created_at,
        )
        .toArray();
      return asTapeMessage(rows[0]!);
    },
    appendActivity({ event_id, created_at }) {
      const eventId = event_id.trim();
      if (eventId === "") throw new Error("empty");
      const existing = sql
        .exec(
          `SELECT seq, kind, body, actor_id, event_id, created_at
           FROM message WHERE event_id = ?`,
          eventId,
        )
        .toArray();
      if (existing[0]) return asTapeMessage(existing[0]);
      const rows = sql
        .exec(
          `INSERT INTO message (kind, body, actor_id, event_id, created_at)
           VALUES ('activity', '', NULL, ?, ?)
           RETURNING seq, kind, body, actor_id, event_id, created_at`,
          eventId,
          created_at,
        )
        .toArray();
      return asTapeMessage(rows[0]!);
    },
    replay(lastSeq) {
      return sql
        .exec(
          `SELECT seq, kind, body, actor_id, event_id, created_at
           FROM message WHERE seq > ? ORDER BY seq ASC`,
          lastSeq,
        )
        .toArray()
        .map(asTapeMessage);
    },
    lastSeq() {
      const rows = sql
        .exec(`SELECT COALESCE(MAX(seq), 0) AS last_seq FROM message`)
        .toArray();
      return Number(rows[0]?.last_seq ?? 0);
    },
  };
}

function messageFrame(row: TapeMessage): string {
  return JSON.stringify({
    type: "message",
    seq: row.seq,
    kind: row.kind,
    body: row.body,
    actor_id: row.actor_id,
    event_id: row.event_id,
    created_at: row.created_at,
  });
}

function errorFrame(): string {
  return JSON.stringify({ type: "error", error: "bad_request" });
}

function parseLastSeq(raw: string | null): number | null {
  if (raw === null) return 0;
  if (!/^\d+$/.test(raw)) return null;
  return Number(raw);
}

function isChatPayload(
  value: unknown,
): value is { type: "chat"; body: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "chat" &&
    typeof (value as { body?: unknown }).body === "string"
  );
}

export class Room extends DurableObject<Env> {
  readonly tape: Tape;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.tape = sqlTape(ctx.storage.sql);
    this.tape.ensureSchema();
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return jsonError(400, "bad_request");
    }

    const principalId = request.headers.get("X-Pt-Principal");
    if (!principalId) {
      return jsonError(401, "unauthorized");
    }

    const lastSeq = parseLastSeq(new URL(request.url).searchParams.get("last_seq"));
    if (lastSeq === null) {
      return jsonError(400, "bad_request");
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment({ principalId } satisfies Attachment);
    this.ctx.acceptWebSocket(server);

    for (const row of this.tape.replay(lastSeq)) {
      server.send(messageFrame(row));
    }
    server.send(
      JSON.stringify({ type: "caught_up", last_seq: this.tape.lastSeq() }),
    );

    return new Response(null, {
      status: 101,
      webSocket: client,
    } as ResponseInit);
  }

  async appendSystem(input: { event_id: string }) {
    const eventId = input.event_id?.trim() ?? "";
    if (!eventId) throw new Error("empty");
    const row = this.tape.appendActivity({
      event_id: eventId,
      created_at: new Date().toISOString(),
    });
    const frame = messageFrame(row);
    for (const socket of this.ctx.getWebSockets()) {
      socket.send(frame);
    }
    return row;
  }

  async webSocketMessage(
    ws: HibernatableWebSocket,
    data: string | ArrayBuffer,
  ): Promise<void> {
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (!attachment?.principalId) {
      ws.close(4001);
      return;
    }

    if (typeof data !== "string") {
      ws.send(errorFrame());
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      ws.send(errorFrame());
      return;
    }

    if (!isChatPayload(parsed)) {
      ws.send(errorFrame());
      return;
    }

    if (rejectChatBody(parsed.body)) {
      ws.send(errorFrame());
      return;
    }

    const row = this.tape.appendChat({
      body: parsed.body,
      actor_id: attachment.principalId,
      created_at: new Date().toISOString(),
    });
    const frame = messageFrame(row);
    for (const socket of this.ctx.getWebSockets()) {
      socket.send(frame);
    }
  }

  async webSocketClose(
    ws: HibernatableWebSocket,
    code: number,
    reason: string,
  ): Promise<void> {
    const reply = code === 1005 || code === 1006 ? 1000 : code;
    ws.close(reply, reason);
  }
}
