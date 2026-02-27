import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  canMutateServerScopedResource,
} from "@/lib/api-safety";
import { createServerChannelPatchHandler } from "@/lib/route-handlers";

/**
 * PATCH /api/servers/{serverId}/channels/{channelId}
 *
 * Update channel settings (e.g., assign default bot).
 * Requires server ownership.
 */
export const PATCH = createServerChannelPatchHandler({
  getServerSession,
  authOptions,
  prismaClient: prisma,
});
