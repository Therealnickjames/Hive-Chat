import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import bcrypt from "bcryptjs";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * GET /api/users/me — Return current user's profile
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      username: true,
      displayName: true,
      avatarUrl: true,
      status: true,
      theme: true,
      createdAt: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json(user);
}

/**
 * PATCH /api/users/me — Update current user's profile
 * Body: { displayName?, email?, avatarUrl?, currentPassword?, newPassword? }
 */
export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  const errors: string[] = [];

  // Display name
  if (body.displayName !== undefined) {
    const name =
      typeof body.displayName === "string" ? body.displayName.trim() : "";
    if (name.length < 1 || name.length > 50) {
      errors.push("Display name must be 1-50 characters");
    } else {
      updates.displayName = name;
    }
  }

  // Email
  if (body.email !== undefined) {
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push("Invalid email format");
    } else {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing && existing.id !== session.user.id) {
        errors.push("Email already in use");
      } else {
        updates.email = email;
      }
    }
  }

  // Avatar URL — allow /api/uploads/ paths or external https:// URLs
  if (body.avatarUrl !== undefined) {
    if (body.avatarUrl === null) {
      updates.avatarUrl = null;
    } else if (typeof body.avatarUrl !== "string") {
      errors.push("Invalid avatar URL");
    } else if (
      !body.avatarUrl.startsWith("/api/uploads/") &&
      !body.avatarUrl.startsWith("https://")
    ) {
      errors.push("Avatar URL must be an upload or https:// URL");
    } else {
      updates.avatarUrl = body.avatarUrl;
    }
  }

  // Status
  if (body.status !== undefined) {
    const validStatuses = ["online", "away", "busy", "invisible"];
    if (
      typeof body.status !== "string" ||
      !validStatuses.includes(body.status)
    ) {
      errors.push("Status must be one of: online, away, busy, invisible");
    } else {
      updates.status = body.status;
    }
  }

  // Theme
  if (body.theme !== undefined) {
    const validThemes = ["dark", "light"];
    if (typeof body.theme !== "string" || !validThemes.includes(body.theme)) {
      errors.push("Theme must be dark or light");
    } else {
      updates.theme = body.theme;
    }
  }

  // Password change
  if (body.newPassword !== undefined) {
    if (!body.currentPassword) {
      errors.push("Current password is required to change password");
    } else {
      const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { password: true },
      });
      if (!user) {
        errors.push("User not found");
      } else {
        const isValid = await bcrypt.compare(
          String(body.currentPassword),
          user.password,
        );
        if (!isValid) {
          errors.push("Current password is incorrect");
        } else if (
          typeof body.newPassword !== "string" ||
          body.newPassword.length < 8
        ) {
          errors.push("New password must be at least 8 characters");
        } else {
          updates.password = await bcrypt.hash(body.newPassword, 12);
        }
      }
    }
  }

  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join("; ") }, { status: 400 });
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "No valid fields to update" },
      { status: 400 },
    );
  }

  const updated = await prisma.user.update({
    where: { id: session.user.id },
    data: updates,
    select: {
      id: true,
      email: true,
      username: true,
      displayName: true,
      avatarUrl: true,
      status: true,
      theme: true,
    },
  });

  return NextResponse.json(updated);
}
