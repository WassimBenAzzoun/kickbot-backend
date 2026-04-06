import { GuildConfig, PrismaClient } from "@prisma/client";

export class GuildConfigRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public async upsertAlertChannel(guildId: string, alertChannelId: string | null): Promise<GuildConfig> {
    return this.prisma.guildConfig.upsert({
      where: { guildId },
      create: { guildId, alertChannelId },
      update: { alertChannelId }
    });
  }

  public async findByGuildId(guildId: string): Promise<GuildConfig | null> {
    return this.prisma.guildConfig.findUnique({
      where: { guildId }
    });
  }

  public async ensureGuildConfig(guildId: string): Promise<GuildConfig> {
    return this.prisma.guildConfig.upsert({
      where: { guildId },
      create: { guildId },
      update: {}
    });
  }

  public async findManyByGuildIds(guildIds: string[]): Promise<GuildConfig[]> {
    if (guildIds.length === 0) {
      return [];
    }

    return this.prisma.guildConfig.findMany({
      where: {
        guildId: {
          in: guildIds
        }
      }
    });
  }
}