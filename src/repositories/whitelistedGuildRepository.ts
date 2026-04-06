import { PrismaClient, WhitelistedGuild } from "@prisma/client";

export interface CreateWhitelistedGuildInput {
  guildId: string;
  guildName: string | null;
  addedByUserId: string | null;
  notes: string | null;
}

export class WhitelistedGuildRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public async listAll(): Promise<WhitelistedGuild[]> {
    return this.prisma.whitelistedGuild.findMany({
      orderBy: [{ guildName: "asc" }, { guildId: "asc" }]
    });
  }

  public async findByGuildId(guildId: string): Promise<WhitelistedGuild | null> {
    return this.prisma.whitelistedGuild.findUnique({
      where: {
        guildId
      }
    });
  }

  public async create(input: CreateWhitelistedGuildInput): Promise<WhitelistedGuild> {
    return this.prisma.whitelistedGuild.create({
      data: {
        guildId: input.guildId,
        guildName: input.guildName,
        addedByUserId: input.addedByUserId,
        notes: input.notes
      }
    });
  }

  public async deleteByGuildId(guildId: string): Promise<WhitelistedGuild | null> {
    const existing = await this.findByGuildId(guildId);

    if (!existing) {
      return null;
    }

    return this.prisma.whitelistedGuild.delete({
      where: {
        guildId
      }
    });
  }
}
