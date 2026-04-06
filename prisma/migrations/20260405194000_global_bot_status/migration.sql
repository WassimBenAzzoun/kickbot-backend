-- CreateEnum
CREATE TYPE "BotActivityType" AS ENUM ('PLAYING', 'WATCHING', 'LISTENING', 'COMPETING', 'CUSTOM');

-- CreateTable
CREATE TABLE "GlobalBotConfig" (
    "id" TEXT NOT NULL,
    "rotationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "rotationIntervalSeconds" INTEGER NOT NULL DEFAULT 60,
    "defaultStatusEnabled" BOOLEAN NOT NULL DEFAULT true,
    "defaultStatusText" TEXT,
    "defaultActivityType" "BotActivityType",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlobalBotConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotStatusMessage" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "activityType" "BotActivityType" NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "usePlaceholders" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotStatusMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlobalAdmin" (
    "id" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GlobalAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BotStatusMessage_isEnabled_sortOrder_idx" ON "BotStatusMessage"("isEnabled", "sortOrder");

-- CreateIndex
CREATE INDEX "BotStatusMessage_sortOrder_idx" ON "BotStatusMessage"("sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "GlobalAdmin_discordId_key" ON "GlobalAdmin"("discordId");

-- CreateIndex
CREATE INDEX "GlobalAdmin_discordId_idx" ON "GlobalAdmin"("discordId");
