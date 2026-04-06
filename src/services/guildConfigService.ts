import { GuildConfig } from "@prisma/client";
import { GuildConfigRepository } from "../repositories/guildConfigRepository";

export class GuildConfigService {
  public constructor(private readonly guildConfigRepository: GuildConfigRepository) {}

  public async setAlertChannel(
    guildId: string,
    alertChannelId: string | null
  ): Promise<GuildConfig> {
    return this.guildConfigRepository.upsertAlertChannel(guildId, alertChannelId);
  }

  public async getGuildConfig(guildId: string): Promise<GuildConfig | null> {
    return this.guildConfigRepository.findByGuildId(guildId);
  }

  public async ensureGuildConfig(guildId: string): Promise<GuildConfig> {
    return this.guildConfigRepository.ensureGuildConfig(guildId);
  }
}