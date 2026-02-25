import assert from "node:assert/strict";
import test from "node:test";

import { getRedisHealthStatus } from "./api-safety.js";

test("health_marks_redis_unhealthy_when_url_missing", async () => {
  let probeCalled = false;

  const status = await getRedisHealthStatus(undefined, async () => {
    probeCalled = true;
    return true;
  });

  assert.equal(status, "unhealthy");
  assert.equal(probeCalled, false);
});

test("health_marks_redis_unhealthy_when_probe_throws", async () => {
  const status = await getRedisHealthStatus("redis://localhost:6379", async () => {
    throw new Error("probe failed");
  });

  assert.equal(status, "unhealthy");
});
