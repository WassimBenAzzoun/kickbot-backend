import { BotStatusMessage, BotActivityType, PrismaClient } from "@prisma/client";

export interface CreateBotStatusMessageInput {
  text: string;
  activityType: BotActivityType;
  isEnabled: boolean;
  usePlaceholders: boolean;
}

export interface UpdateBotStatusMessageInput {
  text: string;
  activityType: BotActivityType;
  isEnabled: boolean;
  usePlaceholders: boolean;
}

export interface ReorderBotStatusMessageInput {
  id: string;
  sortOrder: number;
}

export class BotStatusMessageRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public async listAll(): Promise<BotStatusMessage[]> {
    return this.prisma.botStatusMessage.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
    });
  }

  public async listEnabled(): Promise<BotStatusMessage[]> {
    return this.prisma.botStatusMessage.findMany({
      where: {
        isEnabled: true
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
    });
  }

  public async findById(id: string): Promise<BotStatusMessage | null> {
    return this.prisma.botStatusMessage.findUnique({
      where: { id }
    });
  }

  public async getNextSortOrder(): Promise<number> {
    const result = await this.prisma.botStatusMessage.aggregate({
      _max: {
        sortOrder: true
      }
    });

    return (result._max.sortOrder ?? -1) + 1;
  }

  public async create(input: CreateBotStatusMessageInput): Promise<BotStatusMessage> {
    const sortOrder = await this.getNextSortOrder();

    return this.prisma.botStatusMessage.create({
      data: {
        text: input.text,
        activityType: input.activityType,
        isEnabled: input.isEnabled,
        usePlaceholders: input.usePlaceholders,
        sortOrder
      }
    });
  }

  public async update(id: string, input: UpdateBotStatusMessageInput): Promise<BotStatusMessage> {
    return this.prisma.botStatusMessage.update({
      where: { id },
      data: {
        text: input.text,
        activityType: input.activityType,
        isEnabled: input.isEnabled,
        usePlaceholders: input.usePlaceholders
      }
    });
  }

  public async setEnabled(id: string, isEnabled: boolean): Promise<BotStatusMessage | null> {
    const existing = await this.findById(id);
    if (!existing) {
      return null;
    }

    return this.prisma.botStatusMessage.update({
      where: { id },
      data: {
        isEnabled
      }
    });
  }

  public async delete(id: string): Promise<boolean> {
    const deleted = await this.prisma.botStatusMessage.deleteMany({
      where: { id }
    });

    return deleted.count > 0;
  }

  public async reorder(updates: ReorderBotStatusMessageInput[]): Promise<void> {
    if (updates.length === 0) {
      return;
    }

    await this.prisma.$transaction(
      updates.map((entry) =>
        this.prisma.botStatusMessage.update({
          where: { id: entry.id },
          data: { sortOrder: entry.sortOrder }
        })
      )
    );
  }
}
