import { GlobalAdmin, PrismaClient } from "@prisma/client";

export class GlobalAdminRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public async findByDiscordId(discordId: string): Promise<GlobalAdmin | null> {
    return this.prisma.globalAdmin.findUnique({
      where: {
        discordId
      }
    });
  }

  public async listAll(): Promise<GlobalAdmin[]> {
    return this.prisma.globalAdmin.findMany({
      orderBy: {
        createdAt: "asc"
      }
    });
  }

  public async upsert(discordId: string): Promise<GlobalAdmin> {
    return this.prisma.globalAdmin.upsert({
      where: {
        discordId
      },
      create: {
        discordId
      },
      update: {}
    });
  }

  public async removeByDiscordId(discordId: string): Promise<boolean> {
    const deleted = await this.prisma.globalAdmin.deleteMany({
      where: {
        discordId
      }
    });

    return deleted.count > 0;
  }
}
