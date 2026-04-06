import {
  NotificationHistory,
  NotificationStatus,
  PrismaClient,
  StreamPlatform
} from "@prisma/client";

export interface PaginatedNotifications {
  items: NotificationHistory[];
  total: number;
  page: number;
  pageSize: number;
}

export class NotificationHistoryRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public async createNotification(input: {
    guildId: string;
    streamerUsername: string;
    platform: StreamPlatform;
    status: NotificationStatus;
    messageId?: string | null;
  }): Promise<NotificationHistory> {
    return this.prisma.notificationHistory.create({
      data: {
        guildId: input.guildId,
        streamerUsername: input.streamerUsername,
        platform: input.platform,
        status: input.status,
        messageId: input.messageId ?? null
      }
    });
  }

  public async listByGuildPaginated(
    guildId: string,
    page: number,
    pageSize: number
  ): Promise<PaginatedNotifications> {
    const skip = (page - 1) * pageSize;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.notificationHistory.findMany({
        where: { guildId },
        orderBy: { sentAt: "desc" },
        skip,
        take: pageSize
      }),
      this.prisma.notificationHistory.count({
        where: { guildId }
      })
    ]);

    return {
      items,
      total,
      page,
      pageSize
    };
  }
}