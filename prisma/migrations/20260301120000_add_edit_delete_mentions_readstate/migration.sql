-- TASK-0014: Add editedAt and isDeleted to Message for edit/delete support
ALTER TABLE "Message" ADD COLUMN "editedAt" TIMESTAMP(3);
ALTER TABLE "Message" ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- TASK-0015: MessageMention join table for mention persistence
CREATE TABLE "MessageMention" (
    "id" VARCHAR(26) NOT NULL,
    "messageId" VARCHAR(26) NOT NULL,
    "userId" VARCHAR(26) NOT NULL,

    CONSTRAINT "MessageMention_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessageMention_messageId_userId_key" ON "MessageMention"("messageId", "userId");
CREATE INDEX "MessageMention_userId_idx" ON "MessageMention"("userId");

ALTER TABLE "MessageMention" ADD CONSTRAINT "MessageMention_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessageMention" ADD CONSTRAINT "MessageMention_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- TASK-0016: ChannelReadState for unread indicators
CREATE TABLE "ChannelReadState" (
    "id" VARCHAR(26) NOT NULL,
    "userId" VARCHAR(26) NOT NULL,
    "channelId" VARCHAR(26) NOT NULL,
    "lastReadSeq" BIGINT NOT NULL DEFAULT 0,
    "mentionCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelReadState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChannelReadState_userId_channelId_key" ON "ChannelReadState"("userId", "channelId");
CREATE INDEX "ChannelReadState_userId_idx" ON "ChannelReadState"("userId");

ALTER TABLE "ChannelReadState" ADD CONSTRAINT "ChannelReadState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelReadState" ADD CONSTRAINT "ChannelReadState_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
