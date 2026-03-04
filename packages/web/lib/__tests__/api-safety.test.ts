import { describe, it, expect } from "vitest";
import {
  canMutateServerScopedResource,
  isJsonObjectBody,
  getRedisHealthStatus,
  serializeSequence,
  parseNonNegativeSequence,
  buildMonotonicLastSequenceUpdate,
} from "../api-safety.js";

describe("canMutateServerScopedResource", () => {
  it("returns true when route and target server IDs match", () => {
    expect(canMutateServerScopedResource("server-1", "server-1")).toBe(true);
  });

  it("returns false when IDs differ", () => {
    expect(canMutateServerScopedResource("server-1", "server-2")).toBe(false);
  });

  it("returns false for non-string routeServerId", () => {
    expect(canMutateServerScopedResource(null, "server-1")).toBe(false);
    expect(canMutateServerScopedResource(undefined, "server-1")).toBe(false);
    expect(canMutateServerScopedResource(123, "server-1")).toBe(false);
  });

  it("returns false for non-string targetServerId", () => {
    expect(canMutateServerScopedResource("server-1", null)).toBe(false);
    expect(canMutateServerScopedResource("server-1", undefined)).toBe(false);
    expect(canMutateServerScopedResource("server-1", 123)).toBe(false);
  });

  it("prevents cross-server mutation (IDOR defense)", () => {
    // This is the key security property: route server must match resource server
    expect(canMutateServerScopedResource("attacker-server", "victim-server")).toBe(false);
  });
});

describe("isJsonObjectBody", () => {
  it("returns true for a plain object", () => {
    expect(isJsonObjectBody({ key: "value" })).toBe(true);
  });

  it("returns true for empty object", () => {
    expect(isJsonObjectBody({})).toBe(true);
  });

  it("returns false for null", () => {
    expect(isJsonObjectBody(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isJsonObjectBody(undefined)).toBe(false);
  });

  it("returns false for arrays (prevents array body injection)", () => {
    expect(isJsonObjectBody([])).toBe(false);
    expect(isJsonObjectBody([1, 2, 3])).toBe(false);
  });

  it("returns false for primitives", () => {
    expect(isJsonObjectBody("string")).toBe(false);
    expect(isJsonObjectBody(42)).toBe(false);
    expect(isJsonObjectBody(true)).toBe(false);
  });
});

describe("getRedisHealthStatus", () => {
  it("returns 'ok' when probe succeeds", async () => {
    const probe = async () => true;
    expect(await getRedisHealthStatus("redis://localhost:6379", probe)).toBe("ok");
  });

  it("returns 'unhealthy' when probe returns false", async () => {
    const probe = async () => false;
    expect(await getRedisHealthStatus("redis://localhost:6379", probe)).toBe("unhealthy");
  });

  it("returns 'unhealthy' when probe throws", async () => {
    const probe = async () => {
      throw new Error("connection refused");
    };
    expect(await getRedisHealthStatus("redis://localhost:6379", probe)).toBe("unhealthy");
  });

  it("returns 'unhealthy' when redisUrl is empty/falsy", async () => {
    const probe = async () => true;
    expect(await getRedisHealthStatus("", probe)).toBe("unhealthy");
    expect(await getRedisHealthStatus(null, probe)).toBe("unhealthy");
    expect(await getRedisHealthStatus(undefined, probe)).toBe("unhealthy");
  });
});

describe("serializeSequence", () => {
  it("serializes a BigInt to string", () => {
    expect(serializeSequence(BigInt(42))).toBe("42");
  });

  it("serializes zero", () => {
    expect(serializeSequence(BigInt(0))).toBe("0");
  });

  it("handles large values beyond Number.MAX_SAFE_INTEGER", () => {
    const big = BigInt("9007199254740993");
    expect(serializeSequence(big)).toBe("9007199254740993");
  });
});

describe("parseNonNegativeSequence", () => {
  it("parses a valid string number", () => {
    expect(parseNonNegativeSequence("42")).toBe(BigInt(42));
  });

  it("parses zero", () => {
    expect(parseNonNegativeSequence("0")).toBe(BigInt(0));
  });

  it("parses a number type input", () => {
    expect(parseNonNegativeSequence(42)).toBe(BigInt(42));
  });

  it("parses a BigInt type input", () => {
    expect(parseNonNegativeSequence(BigInt(42))).toBe(BigInt(42));
  });

  it("returns null for negative values", () => {
    expect(parseNonNegativeSequence("-1")).toBeNull();
  });

  it("returns null for non-numeric strings", () => {
    expect(parseNonNegativeSequence("abc")).toBeNull();
    expect(parseNonNegativeSequence("12abc")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseNonNegativeSequence("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(parseNonNegativeSequence("   ")).toBeNull();
  });

  it("returns null for null/undefined/boolean", () => {
    expect(parseNonNegativeSequence(null)).toBeNull();
    expect(parseNonNegativeSequence(undefined)).toBeNull();
    expect(parseNonNegativeSequence(true)).toBeNull();
  });

  it("trims whitespace from valid string input", () => {
    expect(parseNonNegativeSequence("  42  ")).toBe(BigInt(42));
  });

  it("handles values beyond Number.MAX_SAFE_INTEGER", () => {
    const big = "9007199254740993";
    expect(parseNonNegativeSequence(big)).toBe(BigInt(big));
  });
});

describe("buildMonotonicLastSequenceUpdate", () => {
  it("builds a Prisma updateMany query with lt guard", () => {
    const result = buildMonotonicLastSequenceUpdate("ch-1", BigInt(100));
    expect(result).toEqual({
      where: {
        id: "ch-1",
        lastSequence: { lt: BigInt(100) },
      },
      data: { lastSequence: BigInt(100) },
    });
  });

  it("prevents out-of-order sequence updates (monotonic guard)", () => {
    const result = buildMonotonicLastSequenceUpdate("ch-1", BigInt(50));
    // The lt guard ensures only updates where current < new
    expect(result.where.lastSequence.lt).toBe(BigInt(50));
  });
});
