import assert from "node:assert/strict";
import test from "node:test";

import { serializeSequence } from "./api-safety.js";

test("returns_sequence_as_safe_string", () => {
  const unsafeSequence = BigInt(Number.MAX_SAFE_INTEGER) + 2n;
  assert.equal(serializeSequence(unsafeSequence), "9007199254740993");
});
