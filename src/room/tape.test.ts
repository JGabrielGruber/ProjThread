import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { memoryTape, rejectActivityBody, rejectChatBody } from "./tape.ts";

describe("rejectChatBody", () => {
  it("returns empty for empty and whitespace", () => {
    assert.equal(rejectChatBody(""), "empty");
    assert.equal(rejectChatBody("   "), "empty");
    assert.equal(rejectChatBody("\n\t"), "empty");
  });

  it("allows 8192 ascii bytes and rejects 8193", () => {
    assert.equal(rejectChatBody("a".repeat(8192)), null);
    assert.equal(rejectChatBody("a".repeat(8193)), "too_large");
  });

  it("rejects e-acute repeated 4097 times as too_large", () => {
    assert.equal(rejectChatBody("é".repeat(4097)), "too_large");
  });
});

describe("memoryTape", () => {
  it("assigns seq 1 then 2, lastSeq 2, kind chat, event_id null", () => {
    const tape = memoryTape();
    const first = tape.appendChat({
      body: "one",
      actor_id: "p1",
      created_at: "2026-08-26T00:00:00.000Z",
    });
    const second = tape.appendChat({
      body: "two",
      actor_id: "p1",
      created_at: "2026-08-26T00:00:01.000Z",
    });
    assert.equal(first.seq, 1);
    assert.equal(second.seq, 2);
    assert.equal(tape.lastSeq(), 2);
    assert.equal(first.kind, "chat");
    assert.equal(second.kind, "chat");
    assert.equal(first.event_id, null);
    assert.equal(second.event_id, null);
  });

  it("replays seq greater than lastSeq in order", () => {
    const tape = memoryTape();
    for (const body of ["a", "b", "c"]) {
      tape.appendChat({
        body,
        actor_id: "p1",
        created_at: "2026-08-26T00:00:00.000Z",
      });
    }
    assert.deepEqual(
      tape.replay(0).map((m) => m.body),
      ["a", "b", "c"],
    );
    assert.deepEqual(
      tape.replay(1).map((m) => m.body),
      ["b", "c"],
    );
    assert.deepEqual(tape.replay(3), []);
  });

  it("throws empty and does not advance lastSeq", () => {
    const tape = memoryTape();
    assert.throws(() => {
      tape.appendChat({
        body: "  ",
        actor_id: "p1",
        created_at: "2026-08-26T00:00:00.000Z",
      });
    }, { message: "empty" });
    assert.equal(tape.lastSeq(), 0);
  });

  it("chat then activity shares seq; replay and idempotent event_id", () => {
    const tape = memoryTape();
    const chat = tape.appendChat({
      body: "hi",
      actor_id: "p1",
      created_at: "2026-08-26T00:00:00.000Z",
    });
    const activity = tape.appendActivity({
      event_id: "ev-1",
      created_at: "2026-08-26T00:00:01.000Z",
    });
    assert.equal(chat.seq, 1);
    assert.equal(chat.kind, "chat");
    assert.equal(activity.seq, 2);
    assert.equal(activity.kind, "activity");
    assert.equal(activity.body, "");
    assert.equal(activity.event_id, "ev-1");
    assert.equal(activity.actor_id, null);
    assert.deepEqual(tape.replay(1), [activity]);
    const again = tape.appendActivity({
      event_id: "ev-1",
      created_at: "2026-08-26T00:00:02.000Z",
    });
    assert.equal(again.seq, 2);
    assert.equal(tape.lastSeq(), 2);
  });

  it("empty event_id throws and does not advance lastSeq", () => {
    const tape = memoryTape();
    assert.throws(() => {
      tape.appendActivity({
        event_id: "",
        created_at: "2026-08-26T00:00:00.000Z",
      });
    }, { message: "empty" });
    assert.equal(tape.lastSeq(), 0);
  });
});

describe("rejectActivityBody", () => {
  it("required empty/whitespace is empty; optional empty is null", () => {
    assert.equal(rejectActivityBody("", true), "empty");
    assert.equal(rejectActivityBody("  ", true), "empty");
    assert.equal(rejectActivityBody("", false), null);
  });

  it("allows 2048 ascii bytes and rejects 2049", () => {
    assert.equal(rejectActivityBody("a".repeat(2048), true), null);
    assert.equal(rejectActivityBody("a".repeat(2049), true), "too_large");
  });
});
