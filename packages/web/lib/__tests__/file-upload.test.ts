import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for the file upload API route handler.
 *
 * The route (packages/web/app/api/uploads/route.ts) uses top-level imports
 * for prisma, next-auth, fs, and the image-dimensions helper. We mock all
 * external dependencies so we can test the validation logic in isolation.
 */

// ---------- mocks ----------
// vi.hoisted ensures these are available when vi.mock factories run (hoisted above imports).

const { mockPrisma, mockSessionRef, mockGetServerSession, mockGetImageDimensions } = vi.hoisted(() => {
  const _mockPrisma = {
    attachment: {
      create: vi.fn(),
    },
  };
  const _mockSessionRef = { current: { user: { id: "user-1" } } as any };
  const _mockGetServerSession = vi.fn(() => Promise.resolve(_mockSessionRef.current));
  const _mockGetImageDimensions = vi.fn();
  return {
    mockPrisma: _mockPrisma,
    mockSessionRef: _mockSessionRef,
    mockGetServerSession: _mockGetServerSession,
    mockGetImageDimensions: _mockGetImageDimensions,
  };
});

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({
  getServerSession: mockGetServerSession,
}));
vi.mock("@/lib/ulid", () => ({ generateId: () => "test-file-id-001" }));
vi.mock("@/lib/image-dimensions", () => ({
  getImageDimensions: (...args: any[]) => mockGetImageDimensions(...args),
}));
vi.mock("fs/promises", () => ({
  writeFile: vi.fn(() => Promise.resolve()),
  mkdir: vi.fn(() => Promise.resolve()),
}));

import { POST } from "@/app/api/uploads/route";

/**
 * Build a fake NextRequest with multipart form data containing one file.
 */
function makeUploadRequest(
  fileName: string,
  mimeType: string,
  sizeBytes: number,
  content?: Buffer
) {
  const buf = content ?? Buffer.alloc(sizeBytes, 0x41); // fill with 'A'
  const fileBytes = new Uint8Array(buf);
  const file = new File([fileBytes], fileName, { type: mimeType });

  // Override the size getter for tests that need to exceed limits
  // without actually allocating huge buffers
  if (sizeBytes !== fileBytes.byteLength) {
    Object.defineProperty(file, "size", { value: sizeBytes });
  }

  const formData = new FormData();
  formData.append("file", file);

  return new Request("http://localhost/api/uploads", {
    method: "POST",
    body: formData,
  }) as any;
}

/**
 * Build a fake NextRequest with no file field in the form data.
 */
function makeEmptyUploadRequest() {
  const formData = new FormData();
  formData.append("other", "not-a-file");

  return new Request("http://localhost/api/uploads", {
    method: "POST",
    body: formData,
  }) as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSessionRef.current = { user: { id: "user-1" } };

  mockPrisma.attachment.create.mockImplementation(async ({ data, select }: any) => ({
    id: data.id,
    filename: data.filename,
    mimeType: data.mimeType,
    size: data.size,
    width: data.width ?? null,
    height: data.height ?? null,
  }));

  mockGetImageDimensions.mockReturnValue(null);
});

// ===========================================================
// Authentication
// ===========================================================
describe("Upload API — authentication", () => {
  it("returns 401 when not authenticated", async () => {
    mockSessionRef.current = null;
    const req = makeUploadRequest("test.png", "image/png", 100);
    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  });
});

// ===========================================================
// MIME type validation
// ===========================================================
describe("Upload API — MIME type validation", () => {
  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "application/pdf",
    "text/plain",
    "text/markdown",
    "application/json",
    "application/zip",
  ];

  for (const mimeType of allowedTypes) {
    it(`allows ${mimeType}`, async () => {
      const req = makeUploadRequest("file.bin", mimeType, 100);
      const res = await POST(req);
      expect(res.status).toBe(201);
    });
  }

  const disallowedTypes = [
    "application/x-executable",
    "application/x-msdownload",
    "text/html",
    "application/javascript",
    "video/mp4",
    "audio/mpeg",
  ];

  for (const mimeType of disallowedTypes) {
    it(`rejects ${mimeType}`, async () => {
      const req = makeUploadRequest("file.bin", mimeType, 100);
      const res = await POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("File type not allowed");
    });
  }
});

// ===========================================================
// File size limits
// ===========================================================
describe("Upload API — file size limits", () => {
  it("rejects files exceeding 10MB", async () => {
    const overLimit = 10 * 1024 * 1024 + 1; // 10MB + 1 byte
    const req = makeUploadRequest("big.png", "image/png", overLimit);
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("File too large");
  });

  it("accepts a file at exactly 10MB", async () => {
    const exact = 10 * 1024 * 1024;
    const req = makeUploadRequest("big.png", "image/png", exact);
    const res = await POST(req);
    expect(res.status).toBe(201);
  });

  it("accepts a small file", async () => {
    const req = makeUploadRequest("small.txt", "text/plain", 256);
    const res = await POST(req);
    expect(res.status).toBe(201);
  });
});

// ===========================================================
// No file provided
// ===========================================================
describe("Upload API — missing file", () => {
  it("returns 400 when no file field is in form data", async () => {
    const req = makeEmptyUploadRequest();
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("No file provided");
  });
});

// ===========================================================
// Image dimension extraction
// ===========================================================
describe("Upload API — image dimension extraction", () => {
  it("returns width and height for an image upload", async () => {
    mockGetImageDimensions.mockReturnValue({ width: 1920, height: 1080 });

    const req = makeUploadRequest("photo.png", "image/png", 500);
    const res = await POST(req);
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.width).toBe(1920);
    expect(json.height).toBe(1080);
  });

  it("calls getImageDimensions with buffer and mime type for images", async () => {
    mockGetImageDimensions.mockReturnValue({ width: 800, height: 600 });

    const req = makeUploadRequest("photo.jpeg", "image/jpeg", 200);
    await POST(req);

    expect(mockGetImageDimensions).toHaveBeenCalledTimes(1);
    const [bufArg, mimeArg] = mockGetImageDimensions.mock.calls[0];
    expect(Buffer.isBuffer(bufArg)).toBe(true);
    expect(mimeArg).toBe("image/jpeg");
  });

  it("does not extract dimensions for non-image files", async () => {
    const req = makeUploadRequest("doc.pdf", "application/pdf", 300);
    const res = await POST(req);
    expect(res.status).toBe(201);

    expect(mockGetImageDimensions).not.toHaveBeenCalled();

    const json = await res.json();
    expect(json.width).toBeNull();
    expect(json.height).toBeNull();
  });

  it("returns null dimensions when getImageDimensions returns null", async () => {
    mockGetImageDimensions.mockReturnValue(null);

    const req = makeUploadRequest("broken.png", "image/png", 100);
    const res = await POST(req);
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.width).toBeNull();
    expect(json.height).toBeNull();
  });
});

// ===========================================================
// Response shape
// ===========================================================
describe("Upload API — response shape", () => {
  it("returns expected fields on success", async () => {
    const req = makeUploadRequest("doc.json", "application/json", 42);
    const res = await POST(req);
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.fileId).toBe("test-file-id-001");
    expect(json.url).toBe("/api/uploads/test-file-id-001");
    expect(json.filename).toBeDefined();
    expect(json.mimeType).toBe("application/json");
    expect(json.size).toBeDefined();
  });
});
