import { GlobalBotConfig, PrismaClient, BotActivityType } from "@prisma/client";

export interface UpdateGlobalBotConfigInput {
  rotationEnabled: boolean;
  rotationIntervalSeconds: number;
  defaultStatusEnabled: boolean;
  defaultStatusText: string | null;
  defaultActivityType: BotActivityType | null;
}

export class GlobalBotConfigRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public async getOrCreate(): Promise<GlobalBotConfig> {
    const existing = await this.prisma.globalBotConfig.findFirst({
      orderBy: {
        createdAt: "asc"
      }
    });

    if (existing) {
      return existing;
    }

    return this.prisma.globalBotConfig.create({
      data: {}
    });
  }

  public async update(configId: string, input: UpdateGlobalBotConfigInput): Promise<GlobalBotConfig> {
    return this.prisma.globalBotConfig.update({
      where: { id: configId },
      data: {
        rotationEnabled: input.rotationEnabled,
        rotationIntervalSeconds: input.rotationIntervalSeconds,
        defaultStatusEnabled: input.defaultStatusEnabled,
        defaultStatusText: input.defaultStatusText,
        defaultActivityType: input.defaultActivityType
      }
    });
  }
}
