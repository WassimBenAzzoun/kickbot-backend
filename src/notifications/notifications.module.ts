import { Module } from "@nestjs/common";
import { NotificationsService } from "./notifications/notifications.service.js";

@Module({ providers: [NotificationsService], exports: [NotificationsService] })
export class NotificationsModule {}
