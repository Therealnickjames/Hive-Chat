import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMonotonicLastSequenceUpdate,
  isJsonObjectBody,
  parseNonNegativeSequence,
} from "./api-safety.js";

test("invalid_json_body_is_rejected_by_shared_guard", () => {
  assert.equal(isJsonObjectBody(null), false);
  assert.equal(isJsonObjectBody([]), false);
  assert.equal(isJsonObjectBody("x"), false);
  assert.equal(isJsonObjectBody(123), false);
  assert.equal(isJsonObjectBody({}), true);
  assert.equal(isJsonObjectBody({ ok: true }), true);
});

test("invalid_sequence_is_rejected_by_shared_parser", () => {
  assert.equal(parseNonNegativeSequence(undefined), null);
  assert.equal(parseNonNegativeSequence(null), null);
  assert.equal(parseNonNegativeSequence({}), null);
  assert.equal(parseNonNegativeSequence("-1"), null);
  assert.equal(parseNonNegativeSequence("abc"), null);
  assert.equal(parseNonNegativeSequence(""), null);
});

test("valid_sequence_is_parsed_without_precision_loss", () => {
  assert.equal(
    parseNonNegativeSequence("9007199254740993"),
    BigInt("9007199254740993")
  );
  assert.equal(parseNonNegativeSequence(42), BigInt(42));
  assert.equal(parseNonNegativeSequence(BigInt(43)), BigInt(43));
});

test("monotonic_last_sequence_update_uses_lt_guard", () => {
  const channelId = "channel-1";
  const sequenceBigInt = BigInt("9007199254740993");

  const update = buildMonotonicLastSequenceUpdate(channelId, sequenceBigInt);

  assert.deepEqual(update, {
    where: {
      id: channelId,
      lastSequence: { lt: sequenceBigInt },
    },
    data: { lastSequence: sequenceBigInt },
  });
});
