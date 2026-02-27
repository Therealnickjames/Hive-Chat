import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateId } from "@/lib/ulid";

const UPLOADS_DIR = process.env.UPLOADS_DIR || "/app/uploads";
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = [
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

export const runtime = "nodejs";

/**
 * POST /api/uploads — Upload a file
 * Multipart form data with field "file"
 * Returns: { fileId, url, filename, mimeType, size }
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File too large (max 10MB)" },
        { status: 400 }
      );
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: `File type not allowed: ${file.type || "unknown"}` },
        { status: 400 }
      );
    }

    const fileId = generateId();
    const sanitized = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
    const safeName = sanitized || "file";

    const now = new Date();
    const subdir = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}`;
    const dirPath = join(UPLOADS_DIR, subdir);
    await mkdir(dirPath, { recursive: true });

    const storagePath = `${subdir}/${fileId}_${safeName}`;
    const fullPath = join(UPLOADS_DIR, storagePath);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(fullPath, buffer);

    const attachment = await prisma.attachment.create({
      data: {
        id: fileId,
        userId: session.user.id,
        filename: safeName,
        mimeType: file.type,
        size: file.size,
        storagePath,
      },
      select: {
        id: true,
        filename: true,
        mimeType: true,
        size: true,
      },
    });

    return NextResponse.json(
      {
        fileId: attachment.id,
        url: `/api/uploads/${attachment.id}`,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        size: attachment.size,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to upload file:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
