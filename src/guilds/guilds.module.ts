import { Module } from "@nestjs/common";
import { GuildsService } from "./guilds/guilds.service.js";
import { GuildsController } from "./guilds/guilds.controller.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { StreamersModule } from "../streamers/streamers.module.js";

@Module({
  imports: [StreamersModule, NotificationsModule],
  providers: [GuildsService],
  controllers: [GuildsController],
  exports: [GuildsService]
})
export class GuildsModule {}
