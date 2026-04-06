-- CreateTable
CREATE TABLE "BotGuildState" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "guildName" TEXT NOT NULL,
    "iconHash" TEXT,
    "isInGuild" BOOLEAN NOT NULL DEFAULT true,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotGuildState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BotGuildState_guildId_key" ON "BotGuildState"("guildId");

-- CreateIndex
CREATE INDEX "BotGuildState_isInGuild_guildName_idx" ON "BotGuildState"("isInGuild", "guildName");

-- CreateIndex
CREATE INDEX "BotGuildState_lastSeenAt_idx" ON "BotGuildState"("lastSeenAt");
