-- CreateTable: ChannelBot join table for multi-bot channel assignment (TASK-0012)
CREATE TABLE "ChannelBot" (
    "id" VARCHAR(26) NOT NULL,
    "channelId" VARCHAR(26) NOT NULL,
    "botId" VARCHAR(26) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelBot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChannelBot_channelId_idx" ON "ChannelBot"("channelId");

-- CreateIndex (unique constraint on channelId + botId)
CREATE UNIQUE INDEX "ChannelBot_channelId_botId_key" ON "ChannelBot"("channelId", "botId");

-- AddForeignKey
ALTER TABLE "ChannelBot" ADD CONSTRAINT "ChannelBot_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelBot" ADD CONSTRAINT "ChannelBot_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: populate ChannelBot from existing defaultBotId values
-- Uses ULID format (26 chars) based on channel ID for deterministic IDs
INSERT INTO "ChannelBot" ("id", "channelId", "botId", "createdAt")
SELECT
    -- Generate a pseudo-ULID: use left 10 chars of channelId + right 16 chars of botId
    LEFT("id", 10) || RIGHT("defaultBotId", 16) AS "id",
    "id" AS "channelId",
    "defaultBotId" AS "botId",
    NOW() AS "createdAt"
FROM "Channel"
WHERE "defaultBotId" IS NOT NULL;
