import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { readFile } from "fs/promises";
import { join } from "path";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

const UPLOADS_DIR = process.env.UPLOADS_DIR || "/app/uploads";

export const runtime = "nodejs";

/**
 * GET /api/uploads/[fileId] — Serve an uploaded file
 * Auth: any logged-in user
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const { fileId } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const attachment = await prisma.attachment.findUnique({
      where: { id: fileId },
      select: {
        filename: true,
        mimeType: true,
        storagePath: true,
      },
    });

    if (!attachment) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const fullPath = join(UPLOADS_DIR, attachment.storagePath);
    const buffer = await readFile(fullPath);
    const disposition = attachment.mimeType.startsWith("image/")
      ? "inline"
      : "attachment";

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": attachment.mimeType,
        "Content-Disposition": `${disposition}; filename="${attachment.filename}"`,
        "Content-Security-Policy": "default-src 'none'",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("Failed to serve file:", error);
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
