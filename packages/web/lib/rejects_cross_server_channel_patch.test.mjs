import assert from "node:assert/strict";
import test from "node:test";

import { canMutateServerScopedResource } from "./api-safety.js";

test("rejects_cross_server_channel_patch", () => {
  assert.equal(
    canMutateServerScopedResource("server-A", "server-B"),
    false
  );
});
