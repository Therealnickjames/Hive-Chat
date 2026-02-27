import assert from "node:assert/strict";
import test from "node:test";

import { parseAfterSequence, parseLimit } from "./validation.js";

test("parseLimit accepts valid values", () => {
  assert.equal(parseLimit("10"), 10);
  assert.equal(parseLimit(null), 50);
});

test("parseLimit rejects malformed values", () => {
  assert.throws(() => parseLimit("bad"), /limit must be a number between 1 and 100/);
  assert.throws(() => parseLimit("0"), /between 1 and 100/);
  assert.throws(() => parseLimit("101"), /between 1 and 100/);
});

test("parseAfterSequence accepts numeric strings", () => {
  assert.equal(parseAfterSequence("0"), "0");
  assert.equal(parseAfterSequence("123"), "123");
});

test("parseAfterSequence rejects malformed values", () => {
  assert.throws(() => parseAfterSequence(""), /afterSequence must be/);
  assert.throws(() => parseAfterSequence("abc"), /afterSequence must be/);
  assert.throws(() => parseAfterSequence("1.2"), /afterSequence must be/);
});
