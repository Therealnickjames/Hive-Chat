-- AlterTable
ALTER TABLE "User" ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'online',
ADD COLUMN     "theme" TEXT NOT NULL DEFAULT 'dark';
