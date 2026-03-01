-- AlterTable: Add thinking timeline to Message (TASK-0011)
ALTER TABLE "Message" ADD COLUMN "thinkingTimeline" TEXT;

-- AlterTable: Add thinking steps to Bot (TASK-0011)
ALTER TABLE "Bot" ADD COLUMN "thinkingSteps" TEXT;
