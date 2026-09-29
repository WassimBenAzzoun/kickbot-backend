CREATE SCHEMA IF NOT EXISTS "public";

CREATE TYPE "StreamPlatform" AS ENUM ('KICK');
CREATE TYPE "NotificationStatus" AS ENUM ('LIVE');
CREATE TYPE "BotActivityType" AS ENUM ('PLAYING', 'WATCHING', 'LISTENING', 'COMPETING', 'CUSTOM');
CREATE TYPE "GuildMembershipState" AS ENUM ('UNKNOWN', 'CONNECTED', 'LEFT');

CREATE TABLE "DiscordGuild" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "iconHash" TEXT,
    "membershipState" "GuildMembershipState" NOT NULL DEFAULT 'UNKNOWN',
    "alertChannelId" TEXT,
    "isAllowed" BOOLEAN NOT NULL DEFAULT false,
    "allowlistNotes" TEXT,
    "allowedByDiscordUserId" TEXT,
    "allowedAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DiscordGuild_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrackedStreamer" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "platform" "StreamPlatform" NOT NULL DEFAULT 'KICK',
    "username" TEXT NOT NULL,
    "normalizedUsername" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastKnownLiveState" BOOLEAN NOT NULL DEFAULT false,
    "currentLiveStartedAt" TIMESTAMP(3),
    "lastNotifiedLiveAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TrackedStreamer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "streamerId" TEXT,
    "streamerUsername" TEXT NOT NULL,
    "normalizedUsername" TEXT NOT NULL,
    "platform" "StreamPlatform" NOT NULL,
    "status" "NotificationStatus" NOT NULL,
    "streamUrl" TEXT NOT NULL,
    "title" TEXT,
    "category" TEXT,
    "thumbnailUrl" TEXT,
    "viewerCount" INTEGER,
    "streamStartedAt" TIMESTAMP(3) NOT NULL,
    "discordMessageId" TEXT,
    "sentAt" TIMESTAMP(3),
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BotSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "allowlistEnforced" BOOLEAN NOT NULL DEFAULT false,
    "rotationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "rotationIntervalSeconds" INTEGER NOT NULL DEFAULT 60,
    "defaultStatusEnabled" BOOLEAN NOT NULL DEFAULT true,
    "defaultStatusText" TEXT,
    "defaultActivityType" "BotActivityType",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BotSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PresenceMessage" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "activityType" "BotActivityType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "usePlaceholders" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PresenceMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GlobalAdmin" (
    "discordId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GlobalAdmin_pkey" PRIMARY KEY ("discordId")
);

CREATE INDEX "DiscordGuild_membershipState_name_idx" ON "DiscordGuild"("membershipState", "name");
CREATE INDEX "DiscordGuild_isAllowed_name_idx" ON "DiscordGuild"("isAllowed", "name");
CREATE UNIQUE INDEX "TrackedStreamer_guildId_platform_normalizedUsername_key" ON "TrackedStreamer"("guildId", "platform", "normalizedUsername");
CREATE INDEX "TrackedStreamer_guildId_enabled_idx" ON "TrackedStreamer"("guildId", "enabled");
CREATE INDEX "TrackedStreamer_platform_normalizedUsername_idx" ON "TrackedStreamer"("platform", "normalizedUsername");
CREATE INDEX "Notification_guildId_sentAt_id_idx" ON "Notification"("guildId", "sentAt", "id");
CREATE INDEX "Notification_streamerId_sentAt_idx" ON "Notification"("streamerId", "sentAt");
CREATE UNIQUE INDEX "Notification_guildId_platform_normalizedUsername_streamStar_key" ON "Notification"("guildId", "platform", "normalizedUsername", "streamStartedAt");
CREATE INDEX "PresenceMessage_enabled_sortOrder_idx" ON "PresenceMessage"("enabled", "sortOrder");
CREATE INDEX "PresenceMessage_sortOrder_idx" ON "PresenceMessage"("sortOrder");

ALTER TABLE "TrackedStreamer" ADD CONSTRAINT "TrackedStreamer_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "DiscordGuild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "DiscordGuild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_streamerId_fkey" FOREIGN KEY ("streamerId") REFERENCES "TrackedStreamer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Supabase exposes the public schema through its Data API by default on some projects.
-- The backend connects with a trusted database role; no anonymous Data API policies are needed.
ALTER TABLE "DiscordGuild" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrackedStreamer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BotSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PresenceMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GlobalAdmin" ENABLE ROW LEVEL SECURITY;
