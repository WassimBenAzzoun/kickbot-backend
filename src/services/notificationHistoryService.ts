import { NotificationHistory } from "@prisma/client";
import { NotificationHistoryRepository } from "../repositories/notificationHistoryRepository";

export interface PaginatedNotificationResult {
  items: NotificationHistory[];
  total: number;
  page: number;
  pageSize: number;
}

export class NotificationHistoryService {
  public constructor(private readonly notificationHistoryRepository: NotificationHistoryRepository) {}

  public async listGuildNotifications(
    guildId: string,
    page: number,
    pageSize: number
  ): Promise<PaginatedNotificationResult> {
    return this.notificationHistoryRepository.listByGuildPaginated(guildId, page, pageSize);
  }
}