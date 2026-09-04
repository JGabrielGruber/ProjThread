import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  newWebhookSecret,
  signStandardWebhook,
  verifyStandardWebhook,
} from "./standard-webhooks.ts";

describe("standard webhooks", () => {
  it("roundtrips and rejects a bad signature", async () => {
    const secret = newWebhookSecret();
    assert.match(secret, /^whsec_/);
    const body = '{"kind":"node.created","node_id":"n1","workspace_id":"ws"}';
    const signed = await signStandardWebhook({
      id: "msg_1",
      timestamp: 1_700_000_000,
      body,
      secret,
    });
    assert.equal(
      await verifyStandardWebhook({
        id: signed.headers["webhook-id"],
        timestamp: signed.headers["webhook-timestamp"],
        signature: signed.headers["webhook-signature"],
        body,
        secret,
      }),
      true,
    );
    assert.equal(
      await verifyStandardWebhook({
        id: signed.headers["webhook-id"],
        timestamp: signed.headers["webhook-timestamp"],
        signature: "v1,AAAA",
        body,
        secret,
      }),
      false,
    );
  });
});
