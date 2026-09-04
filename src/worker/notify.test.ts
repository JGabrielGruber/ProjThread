import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  enqueueIfMatch,
  memoryNotifyStore,
  type NotifyMessage,
} from "./notify.ts";

function farmSub(over: Record<string, unknown> = {}) {
  return {
    id: "sub1",
    workspace_id: "ws-farm",
    organization_id: "org-farm",
    url: "https://bot.example/hook",
    secret: "whsec_dGVzdA==",
    kinds: ["node.created"] as const,
    enabled: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    created_by: "p1",
    ...over,
  };
}

describe("NotifyStore", () => {
  it("lists public rows without secret; matches enabled kind", async () => {
    const notify = memoryNotifyStore();
    await notify.insertSubscription(farmSub());
    const listed = await notify.listSubscriptions("ws-farm");
    assert.equal(listed.length, 1);
    assert.equal("secret" in listed[0]!, false);
    assert.deepEqual(listed[0]?.kinds, ["node.created"]);
    assert.equal(await notify.hasEnabledKind("ws-farm", "node.created"), true);
    assert.equal(await notify.hasEnabledKind("ws-farm", "node.cited"), false);
    assert.equal(await notify.hasEnabledKind("ws-other", "node.created"), false);
  });

  it("disabled or missing kind does not match", async () => {
    const notify = memoryNotifyStore();
    await notify.insertSubscription(farmSub({ enabled: 0 }));
    assert.equal(await notify.hasEnabledKind("ws-farm", "node.created"), false);
  });
});

describe("enqueueIfMatch", () => {
  it("sends once when a subscription matches; otherwise zero", async () => {
    const sent: NotifyMessage[] = [];
    const queue = { async send(body: NotifyMessage) { sent.push(body); } };
    const notify = memoryNotifyStore();
    await notify.insertSubscription(farmSub());
    await enqueueIfMatch(queue, notify, "node.created", {
      id: "n1",
      workspace_id: "ws-farm",
    });
    await enqueueIfMatch(queue, notify, "node.cited", {
      id: "n1",
      workspace_id: "ws-farm",
    });
    await enqueueIfMatch(undefined, notify, "node.created", {
      id: "n1",
      workspace_id: "ws-farm",
    });
    assert.deepEqual(sent, [
      { kind: "node.created", node_id: "n1", workspace_id: "ws-farm" },
    ]);
  });
});
