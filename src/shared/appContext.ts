import { prisma } from "../config/database";
import { AppSettingRepository } from "../repositories/appSettingRepository";
import { BotGuildStateRepository } from "../repositories/botGuildStateRepository";
import { BotStatusMessageRepository } from "../repositories/botStatusMessageRepository";
import { GlobalAdminRepository } from "../repositories/globalAdminRepository";
import { GlobalBotConfigRepository } from "../repositories/globalBotConfigRepository";
import { GuildConfigRepository } from "../repositories/guildConfigRepository";
import { NotificationHistoryRepository } from "../repositories/notificationHistoryRepository";
import { TrackedStreamerRepository } from "../repositories/trackedStreamerRepository";
import { WhitelistedGuildRepository } from "../repositories/whitelistedGuildRepository";
import { BotGuildStateService } from "../services/botGuildStateService";
import { BotStatusMessageService } from "../services/botStatusMessageService";
import { GlobalAdminService } from "../services/globalAdminService";
import { GlobalBotConfigService } from "../services/globalBotConfigService";
import { GuildWhitelistSettingsService } from "../services/guildWhitelistSettingsService";
import { GuildConfigService } from "../services/guildConfigService";
import { NotificationHistoryService } from "../services/notificationHistoryService";
import { TrackedStreamerService } from "../services/trackedStreamerService";
import { WhitelistedGuildService } from "../services/whitelistedGuildService";

export interface AppContext {
  appSettingRepository: AppSettingRepository;
  guildConfigRepository: GuildConfigRepository;
  trackedStreamerRepository: TrackedStreamerRepository;
  notificationHistoryRepository: NotificationHistoryRepository;
  globalBotConfigRepository: GlobalBotConfigRepository;
  botStatusMessageRepository: BotStatusMessageRepository;
  globalAdminRepository: GlobalAdminRepository;
  botGuildStateRepository: BotGuildStateRepository;
  whitelistedGuildRepository: WhitelistedGuildRepository;

  guildWhitelistSettingsService: GuildWhitelistSettingsService;
  whitelistedGuildService: WhitelistedGuildService;
  guildConfigService: GuildConfigService;
  trackedStreamerService: TrackedStreamerService;
  notificationHistoryService: NotificationHistoryService;
  globalBotConfigService: GlobalBotConfigService;
  botStatusMessageService: BotStatusMessageService;
  globalAdminService: GlobalAdminService;
  botGuildStateService: BotGuildStateService;
}

export function createAppContext(): AppContext {
  const appSettingRepository = new AppSettingRepository(prisma);
  const guildConfigRepository = new GuildConfigRepository(prisma);
  const trackedStreamerRepository = new TrackedStreamerRepository(prisma);
  const notificationHistoryRepository = new NotificationHistoryRepository(prisma);
  const globalBotConfigRepository = new GlobalBotConfigRepository(prisma);
  const botStatusMessageRepository = new BotStatusMessageRepository(prisma);
  const globalAdminRepository = new GlobalAdminRepository(prisma);
  const botGuildStateRepository = new BotGuildStateRepository(prisma);
  const whitelistedGuildRepository = new WhitelistedGuildRepository(prisma);

  return {
    appSettingRepository,
    guildConfigRepository,
    trackedStreamerRepository,
    notificationHistoryRepository,
    globalBotConfigRepository,
    botStatusMessageRepository,
    globalAdminRepository,
    botGuildStateRepository,
    whitelistedGuildRepository,

    guildWhitelistSettingsService: new GuildWhitelistSettingsService(appSettingRepository),
    whitelistedGuildService: new WhitelistedGuildService(whitelistedGuildRepository),
    guildConfigService: new GuildConfigService(guildConfigRepository),
    trackedStreamerService: new TrackedStreamerService(trackedStreamerRepository),
    notificationHistoryService: new NotificationHistoryService(notificationHistoryRepository),
    globalBotConfigService: new GlobalBotConfigService(globalBotConfigRepository),
    botStatusMessageService: new BotStatusMessageService(botStatusMessageRepository),
    globalAdminService: new GlobalAdminService(globalAdminRepository),
    botGuildStateService: new BotGuildStateService(botGuildStateRepository)
  };
}
