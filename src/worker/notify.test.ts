import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { verifyStandardWebhook } from "../lib/standard-webhooks.ts";
import {
  deliverNotifyBatch,
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

describe("deliverNotifyBatch", () => {
  it("consumer POSTs signed doorbell and acks 2xx; retries 5xx", async () => {
    const notify = memoryNotifyStore();
    await notify.insertSubscription(farmSub());
    const posts: { url: string; body: string; headers: Record<string, string> }[] = [];
    const post: typeof fetch = async (input, init) => {
      posts.push({
        url: String(input),
        body: String(init?.body ?? ""),
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
      });
      return new Response("ok", { status: 202 });
    };
    let acked = 0;
    let retried = 0;
    await deliverNotifyBatch(
      [
        {
          id: "q1",
          timestamp: new Date("2026-01-01T00:00:00.000Z"),
          body: { kind: "node.created", node_id: "n1", workspace_id: "ws-farm" },
          ack() { acked += 1; },
          retry() { retried += 1; },
        },
      ],
      notify,
      post,
    );
    assert.equal(acked, 1);
    assert.equal(retried, 0);
    assert.equal(posts.length, 1);
    assert.equal(posts[0]?.url, "https://bot.example/hook");
    assert.equal(
      posts[0]?.body,
      JSON.stringify({ kind: "node.created", node_id: "n1", workspace_id: "ws-farm" }),
    );
    assert.ok(posts[0]?.headers["webhook-signature"]?.startsWith("v1,"));
    assert.equal(
      await verifyStandardWebhook({
        id: posts[0]!.headers["webhook-id"]!,
        timestamp: posts[0]!.headers["webhook-timestamp"]!,
        signature: posts[0]!.headers["webhook-signature"]!,
        body: posts[0]!.body,
        secret: "whsec_dGVzdA==",
      }),
      true,
    );

    const post500: typeof fetch = async () => new Response("nope", { status: 500 });
    acked = 0;
    retried = 0;
    await deliverNotifyBatch(
      [
        {
          id: "q2",
          timestamp: new Date("2026-01-01T00:00:00.000Z"),
          body: { kind: "node.created", node_id: "n1", workspace_id: "ws-farm" },
          ack() { acked += 1; },
          retry() { retried += 1; },
        },
      ],
      notify,
      post500,
    );
    assert.equal(acked, 0);
    assert.equal(retried, 1);
  });

  it("consumer acks 4xx and does not retry", async () => {
    const notify = memoryNotifyStore();
    await notify.insertSubscription(farmSub());
    let acked = 0;
    let retried = 0;
    const post400: typeof fetch = async () => new Response("bad", { status: 400 });
    await deliverNotifyBatch(
      [
        {
          id: "q3",
          timestamp: new Date("2026-01-01T00:00:00.000Z"),
          body: { kind: "node.created", node_id: "n1", workspace_id: "ws-farm" },
          ack() { acked += 1; },
          retry() { retried += 1; },
        },
      ],
      notify,
      post400,
    );
    assert.equal(acked, 1);
    assert.equal(retried, 0);
  });
});
