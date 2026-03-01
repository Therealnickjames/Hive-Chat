import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { validateInternalSecret, unauthorizedResponse } from "../internal-auth";

// Mock NextRequest since we're running in Node, not Next.js runtime
function createMockRequest(headers: Record<string, string> = {}): any {
  return {
    headers: {
      get(name: string) {
        return headers[name] ?? null;
      },
    },
  };
}

const TEST_SECRET = "my-super-secret-internal-api-key-2024";

describe("validateInternalSecret", () => {
  beforeEach(() => {
    process.env.INTERNAL_API_SECRET = TEST_SECRET;
    // Suppress console.error for the "not set" test
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.INTERNAL_API_SECRET;
    vi.restoreAllMocks();
  });

  it("returns true for valid matching secret", () => {
    const req = createMockRequest({ "x-internal-secret": TEST_SECRET });
    expect(validateInternalSecret(req)).toBe(true);
  });

  it("returns false for wrong secret", () => {
    const req = createMockRequest({ "x-internal-secret": "wrong-secret" });
    expect(validateInternalSecret(req)).toBe(false);
  });

  it("returns false when header is missing", () => {
    const req = createMockRequest({});
    expect(validateInternalSecret(req)).toBe(false);
  });

  it("returns false when INTERNAL_API_SECRET env var is not set (fails closed)", () => {
    delete process.env.INTERNAL_API_SECRET;
    const req = createMockRequest({ "x-internal-secret": "anything" });
    expect(validateInternalSecret(req)).toBe(false);
  });

  it("returns false when INTERNAL_API_SECRET is empty string (fails closed)", () => {
    process.env.INTERNAL_API_SECRET = "";
    const req = createMockRequest({ "x-internal-secret": "" });
    expect(validateInternalSecret(req)).toBe(false);
  });

  it("returns false for wrong-length secret (timing-safe length check)", () => {
    const req = createMockRequest({ "x-internal-secret": "short" });
    expect(validateInternalSecret(req)).toBe(false);
  });

  it("returns false for secret with extra whitespace", () => {
    const req = createMockRequest({
      "x-internal-secret": ` ${TEST_SECRET} `,
    });
    expect(validateInternalSecret(req)).toBe(false);
  });

  it("returns false for secret that is a prefix of the real one", () => {
    const req = createMockRequest({
      "x-internal-secret": TEST_SECRET.slice(0, -1),
    });
    expect(validateInternalSecret(req)).toBe(false);
  });

  it("returns false for secret that is a suffix of the real one", () => {
    const req = createMockRequest({
      "x-internal-secret": TEST_SECRET.slice(1),
    });
    expect(validateInternalSecret(req)).toBe(false);
  });
});

describe("unauthorizedResponse", () => {
  it("returns a response with 401 status and error message", async () => {
    const response = unauthorizedResponse();
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ error: "Unauthorized" });
  });
});
