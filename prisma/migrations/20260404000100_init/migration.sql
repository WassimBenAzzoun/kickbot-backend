-- CreateEnum
CREATE TYPE "StreamPlatform" AS ENUM ('KICK');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('LIVE');

-- CreateTable
CREATE TABLE "GuildConfig" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "alertChannelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuildConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackedStreamer" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "platform" "StreamPlatform" NOT NULL DEFAULT 'KICK',
    "streamerUsername" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastKnownLiveState" BOOLEAN NOT NULL DEFAULT false,
    "lastNotifiedLiveAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackedStreamer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationHistory" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "streamerUsername" TEXT NOT NULL,
    "platform" "StreamPlatform" NOT NULL DEFAULT 'KICK',
    "status" "NotificationStatus" NOT NULL,
    "messageId" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GuildConfig_guildId_key" ON "GuildConfig"("guildId");

-- CreateIndex
CREATE INDEX "GuildConfig_guildId_idx" ON "GuildConfig"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "TrackedStreamer_guildId_platform_streamerUsername_key" ON "TrackedStreamer"("guildId", "platform", "streamerUsername");

-- CreateIndex
CREATE INDEX "TrackedStreamer_guildId_isActive_idx" ON "TrackedStreamer"("guildId", "isActive");

-- CreateIndex
CREATE INDEX "TrackedStreamer_platform_streamerUsername_idx" ON "TrackedStreamer"("platform", "streamerUsername");

-- CreateIndex
CREATE INDEX "NotificationHistory_guildId_sentAt_idx" ON "NotificationHistory"("guildId", "sentAt");

-- CreateIndex
CREATE INDEX "NotificationHistory_streamerUsername_sentAt_idx" ON "NotificationHistory"("streamerUsername", "sentAt");