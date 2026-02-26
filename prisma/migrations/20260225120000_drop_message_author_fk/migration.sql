-- BREAK-0001: authorId is polymorphic (User or Bot), so Message cannot enforce a User FK.
ALTER TABLE "Message" DROP CONSTRAINT "Message_authorId_fkey";
