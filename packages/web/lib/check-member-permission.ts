import { prisma } from "@/lib/db";
import { computeMemberPermissions, hasPermission } from "@/lib/permissions";

interface PermissionCheckResult {
  allowed: boolean;
  memberId?: string;
  effectivePermissions?: bigint;
}

/**
 * Check if a user has a specific permission in a server.
 *
 * Returns { allowed: true, memberId, effectivePermissions } on success,
 * or { allowed: false } if not a member or missing permission.
 */
export async function checkMemberPermission(
  userId: string,
  serverId: string,
  requiredPermission: bigint,
): Promise<PermissionCheckResult> {
  const member = await prisma.member.findUnique({
    where: {
      userId_serverId: { userId, serverId },
    },
    include: {
      roles: { select: { permissions: true } },
      server: { select: { ownerId: true } },
    },
  });

  if (!member) {
    return { allowed: false };
  }

  const effectivePermissions = computeMemberPermissions(
    userId,
    member.server.ownerId,
    member.roles,
  );

  if (!hasPermission(effectivePermissions, requiredPermission)) {
    return { allowed: false };
  }

  return {
    allowed: true,
    memberId: member.id,
    effectivePermissions,
  };
}

/**
 * Check if a user is a member of a server (no permission check).
 * Use for read-only routes that just need membership verification.
 */
export async function checkMembership(
  userId: string,
  serverId: string,
): Promise<{ isMember: boolean; memberId?: string }> {
  const member = await prisma.member.findUnique({
    where: {
      userId_serverId: { userId, serverId },
    },
    select: { id: true },
  });

  return {
    isMember: !!member,
    memberId: member?.id,
  };
}
