-- V1 Schema Catch-Up Migration
-- Adds all models, columns, enums, and indexes that were added to schema.prisma
-- during V1 development but never had corresponding migrations generated.

-- ============================================================
-- 1. CREATE MISSING ENUMS
-- ============================================================

-- Agent approval status (DEC-0047)
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- Agent connection method (DEC-0043)
CREATE TYPE "ConnectionMethod" AS ENUM ('WEBSOCKET', 'WEBHOOK', 'INBOUND_WEBHOOK', 'REST_POLL', 'SSE', 'OPENAI_COMPAT');

-- Swarm collaboration mode (TASK-0020, DEC-0050)
CREATE TYPE "SwarmMode" AS ENUM ('HUMAN_IN_THE_LOOP', 'LEAD_AGENT', 'ROUND_ROBIN', 'STRUCTURED_DEBATE', 'CODE_REVIEW_SPRINT', 'FREEFORM', 'CUSTOM');

-- Charter session status (TASK-0020)
CREATE TYPE "CharterStatus" AS ENUM ('INACTIVE', 'ACTIVE', 'PAUSED', 'COMPLETED');

-- ============================================================
-- 2. ADD MISSING ENUM VALUES TO EXISTING ENUMS
-- ============================================================

-- MessageType: add typed message variants (TASK-0039)
ALTER TYPE "MessageType" ADD VALUE 'TOOL_CALL';
ALTER TYPE "MessageType" ADD VALUE 'TOOL_RESULT';
ALTER TYPE "MessageType" ADD VALUE 'CODE_BLOCK';
ALTER TYPE "MessageType" ADD VALUE 'ARTIFACT';
ALTER TYPE "MessageType" ADD VALUE 'STATUS';

-- ============================================================
-- 3. ALTER EXISTING TABLES — ADD MISSING COLUMNS
-- ============================================================

-- Server: agent registration settings (DEC-0047)
ALTER TABLE "Server" ADD COLUMN "allowAgentRegistration" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Server" ADD COLUMN "registrationApprovalRequired" BOOLEAN NOT NULL DEFAULT true;

-- Channel: swarm/charter fields (TASK-0020, DEC-0050)
ALTER TABLE "Channel" ADD COLUMN "swarmMode" "SwarmMode" NOT NULL DEFAULT 'HUMAN_IN_THE_LOOP';
ALTER TABLE "Channel" ADD COLUMN "charterGoal" TEXT;
ALTER TABLE "Channel" ADD COLUMN "charterRules" TEXT;
ALTER TABLE "Channel" ADD COLUMN "charterAgentOrder" TEXT;
ALTER TABLE "Channel" ADD COLUMN "charterMaxTurns" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Channel" ADD COLUMN "charterCurrentTurn" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Channel" ADD COLUMN "charterStatus" "CharterStatus" NOT NULL DEFAULT 'INACTIVE';

-- Message: agent metadata + stream rewind (TASK-0039, TASK-0021)
ALTER TABLE "Message" ADD COLUMN "metadata" JSONB;
ALTER TABLE "Message" ADD COLUMN "tokenHistory" TEXT;
ALTER TABLE "Message" ADD COLUMN "checkpoints" TEXT;

-- Attachment: image dimensions (TASK-0025)
ALTER TABLE "Attachment" ADD COLUMN "width" INTEGER;
ALTER TABLE "Attachment" ADD COLUMN "height" INTEGER;

-- Bot: agent connection + tool config (DEC-0043, TASK-0018)
ALTER TABLE "Bot" ADD COLUMN "enabledTools" TEXT;
ALTER TABLE "Bot" ADD COLUMN "connectionMethod" "ConnectionMethod";

-- ============================================================
-- 4. CREATE MISSING TABLES
-- ============================================================

-- AgentRegistration: self-registration for SDK agents (DEC-0040)
CREATE TABLE "AgentRegistration" (
    "id" VARCHAR(26) NOT NULL,
    "botId" VARCHAR(26) NOT NULL,
    "apiKeyHash" VARCHAR(64) NOT NULL,
    "capabilities" JSONB NOT NULL DEFAULT '[]',
    "healthUrl" TEXT,
    "webhookUrl" TEXT,
    "maxTokensSec" INTEGER NOT NULL DEFAULT 100,
    "lastHealthCheck" TIMESTAMP(3),
    "lastHealthOk" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "connectionMethod" "ConnectionMethod" NOT NULL DEFAULT 'WEBSOCKET',
    "webhookSecret" VARCHAR(64),
    "webhookTimeout" INTEGER NOT NULL DEFAULT 30000,
    "inboundWebhookToken" VARCHAR(64),
    "sseEnabled" BOOLEAN NOT NULL DEFAULT false,
    "openaiSystemPrompt" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'APPROVED',
    "reviewedBy" VARCHAR(26),
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "AgentRegistration_pkey" PRIMARY KEY ("id")
);

-- InboundWebhook: Discord-style incoming webhooks (DEC-0045)
CREATE TABLE "InboundWebhook" (
    "id" VARCHAR(26) NOT NULL,
    "channelId" VARCHAR(26) NOT NULL,
    "botId" VARCHAR(26) NOT NULL,
    "token" VARCHAR(64) NOT NULL,
    "name" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundWebhook_pkey" PRIMARY KEY ("id")
);

-- AgentMessage: message queue for REST polling agents (DEC-0043)
CREATE TABLE "AgentMessage" (
    "id" VARCHAR(26) NOT NULL,
    "botId" VARCHAR(26) NOT NULL,
    "channelId" VARCHAR(26) NOT NULL,
    "messageId" VARCHAR(26) NOT NULL,
    "content" TEXT NOT NULL,
    "authorId" VARCHAR(26) NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorType" TEXT NOT NULL,
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentMessage_pkey" PRIMARY KEY ("id")
);

-- DirectMessageChannel (TASK-0019)
CREATE TABLE "DirectMessageChannel" (
    "id" VARCHAR(26) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DirectMessageChannel_pkey" PRIMARY KEY ("id")
);

-- DmParticipant (TASK-0019)
CREATE TABLE "DmParticipant" (
    "id" VARCHAR(26) NOT NULL,
    "dmId" VARCHAR(26) NOT NULL,
    "userId" VARCHAR(26) NOT NULL,

    CONSTRAINT "DmParticipant_pkey" PRIMARY KEY ("id")
);

-- DirectMessage (TASK-0019)
CREATE TABLE "DirectMessage" (
    "id" VARCHAR(26) NOT NULL,
    "dmId" VARCHAR(26) NOT NULL,
    "authorId" VARCHAR(26) NOT NULL,
    "content" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "sequence" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DirectMessage_pkey" PRIMARY KEY ("id")
);

-- DmReaction (TASK-0030)
CREATE TABLE "DmReaction" (
    "id" VARCHAR(26) NOT NULL,
    "dmMessageId" VARCHAR(26) NOT NULL,
    "userId" VARCHAR(26) NOT NULL,
    "emoji" VARCHAR(32) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DmReaction_pkey" PRIMARY KEY ("id")
);

-- ============================================================
-- 5. CREATE INDEXES
-- ============================================================

-- AgentRegistration
CREATE UNIQUE INDEX "AgentRegistration_botId_key" ON "AgentRegistration"("botId");
CREATE INDEX "AgentRegistration_apiKeyHash_idx" ON "AgentRegistration"("apiKeyHash");

-- InboundWebhook
CREATE UNIQUE INDEX "InboundWebhook_token_key" ON "InboundWebhook"("token");
CREATE INDEX "InboundWebhook_token_idx" ON "InboundWebhook"("token");
CREATE INDEX "InboundWebhook_channelId_idx" ON "InboundWebhook"("channelId");

-- AgentMessage
CREATE INDEX "AgentMessage_botId_delivered_createdAt_idx" ON "AgentMessage"("botId", "delivered", "createdAt");
CREATE INDEX "AgentMessage_botId_channelId_idx" ON "AgentMessage"("botId", "channelId");

-- DmParticipant
CREATE UNIQUE INDEX "DmParticipant_dmId_userId_key" ON "DmParticipant"("dmId", "userId");
CREATE INDEX "DmParticipant_userId_idx" ON "DmParticipant"("userId");

-- DirectMessage
CREATE INDEX "DirectMessage_dmId_sequence_idx" ON "DirectMessage"("dmId", "sequence");
CREATE INDEX "DirectMessage_dmId_id_idx" ON "DirectMessage"("dmId", "id");

-- DmReaction
CREATE UNIQUE INDEX "DmReaction_dmMessageId_userId_emoji_key" ON "DmReaction"("dmMessageId", "userId", "emoji");

-- ============================================================
-- 6. ADD FOREIGN KEYS
-- ============================================================

-- AgentRegistration -> Bot
ALTER TABLE "AgentRegistration" ADD CONSTRAINT "AgentRegistration_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- InboundWebhook -> Channel, Bot
ALTER TABLE "InboundWebhook" ADD CONSTRAINT "InboundWebhook_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InboundWebhook" ADD CONSTRAINT "InboundWebhook_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DmParticipant -> DirectMessageChannel, User
ALTER TABLE "DmParticipant" ADD CONSTRAINT "DmParticipant_dmId_fkey" FOREIGN KEY ("dmId") REFERENCES "DirectMessageChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DmParticipant" ADD CONSTRAINT "DmParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DirectMessage -> DirectMessageChannel, User
ALTER TABLE "DirectMessage" ADD CONSTRAINT "DirectMessage_dmId_fkey" FOREIGN KEY ("dmId") REFERENCES "DirectMessageChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DirectMessage" ADD CONSTRAINT "DirectMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DmReaction -> DirectMessage, User
ALTER TABLE "DmReaction" ADD CONSTRAINT "DmReaction_dmMessageId_fkey" FOREIGN KEY ("dmMessageId") REFERENCES "DirectMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DmReaction" ADD CONSTRAINT "DmReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
