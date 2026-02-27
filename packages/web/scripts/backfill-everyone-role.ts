/**
 * Backfill script: creates @everyone role for servers that do not have one,
 * and assigns it to all existing members.
 *
 * Run with:
 *   npx tsx packages/web/scripts/backfill-everyone-role.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// SEND_MESSAGES | CREATE_INVITE
const DEFAULT_PERMISSIONS = (BigInt(1) << BigInt(0)) | (BigInt(1) << BigInt(4));
const ULID_CHARS = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function generateBackfillId(): string {
  let result = "";
  for (let i = 0; i < 26; i += 1) {
    result += ULID_CHARS[Math.floor(Math.random() * ULID_CHARS.length)];
  }
  return result;
}

async function main() {
  const servers = await prisma.server.findMany({
    select: { id: true },
  });

  for (const server of servers) {
    const existing = await prisma.role.findFirst({
      where: { serverId: server.id, name: "@everyone" },
      select: { id: true },
    });

    if (existing) {
      console.log(`Server ${server.id}: @everyone already exists, skipping`);
      continue;
    }

    const role = await prisma.role.create({
      data: {
        id: generateBackfillId(),
        serverId: server.id,
        name: "@everyone",
        permissions: DEFAULT_PERMISSIONS,
        position: 0,
      },
    });

    const members = await prisma.member.findMany({
      where: { serverId: server.id },
      select: { id: true },
    });

    for (const member of members) {
      await prisma.member.update({
        where: { id: member.id },
        data: {
          roles: { connect: { id: role.id } },
        },
      });
    }

    console.log(
      `Server ${server.id}: created @everyone, assigned to ${members.length} members`
    );
  }

  console.log("Done!");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
