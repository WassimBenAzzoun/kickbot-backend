CREATE TYPE "InstantAccessMode" AS ENUM ('EVERYONE', 'ALLOWLIST_ONLY');

ALTER TABLE "BotSettings"
ADD COLUMN "instantsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "instantAccessMode" "InstantAccessMode" NOT NULL DEFAULT 'EVERYONE';

CREATE TABLE "InstantAllowedUser" (
    "discordId" TEXT NOT NULL,
    "username" TEXT,
    "globalName" TEXT,
    "avatarHash" TEXT,
    "addedByDiscordUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InstantAllowedUser_pkey" PRIMARY KEY ("discordId")
);

CREATE INDEX "InstantAllowedUser_createdAt_idx" ON "InstantAllowedUser"("createdAt");
ALTER TABLE "InstantAllowedUser" ENABLE ROW LEVEL SECURITY;
