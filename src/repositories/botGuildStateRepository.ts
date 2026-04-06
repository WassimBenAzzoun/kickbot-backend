import { BotGuildState, PrismaClient } from "@prisma/client";

export interface UpsertBotGuildStateInput {
  guildId: string;
  guildName: string;
  iconHash: string | null;
}

export class BotGuildStateRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public async listInGuild(): Promise<BotGuildState[]> {
    return this.prisma.botGuildState.findMany({
      where: {
        isInGuild: true
      },
      orderBy: [{ guildName: "asc" }]
    });
  }

  public async listAll(): Promise<BotGuildState[]> {
    return this.prisma.botGuildState.findMany({
      orderBy: [{ guildName: "asc" }]
    });
  }

  public async upsertAsPresent(input: UpsertBotGuildStateInput): Promise<BotGuildState> {
    const now = new Date();

    return this.prisma.botGuildState.upsert({
      where: {
        guildId: input.guildId
      },
      create: {
        guildId: input.guildId,
        guildName: input.guildName,
        iconHash: input.iconHash,
        isInGuild: true,
        joinedAt: now,
        leftAt: null,
        lastSeenAt: now
      },
      update: {
        guildName: input.guildName,
        iconHash: input.iconHash,
        isInGuild: true,
        leftAt: null,
        lastSeenAt: now
      }
    });
  }

  public async markAsLeft(guildId: string): Promise<void> {
    await this.prisma.botGuildState.updateMany({
      where: {
        guildId,
        isInGuild: true
      },
      data: {
        isInGuild: false,
        leftAt: new Date()
      }
    });
  }

  public async markMissingAsLeft(activeGuildIds: string[]): Promise<number> {
    const updated = await this.prisma.botGuildState.updateMany({
      where: {
        isInGuild: true,
        guildId: {
          notIn: activeGuildIds
        }
      },
      data: {
        isInGuild: false,
        leftAt: new Date()
      }
    });

    return updated.count;
  }
}
