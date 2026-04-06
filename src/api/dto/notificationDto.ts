import { NotificationHistory } from "@prisma/client";

export interface NotificationDto {
  id: string;
  guildId: string;
  streamerUsername: string;
  platform: string;
  status: string;
  messageId: string | null;
  sentAt: string;
}

export function toNotificationDto(notification: NotificationHistory): NotificationDto {
  return {
    id: notification.id,
    guildId: notification.guildId,
    streamerUsername: notification.streamerUsername,
    platform: notification.platform,
    status: notification.status,
    messageId: notification.messageId,
    sentAt: notification.sentAt.toISOString()
  };
}