import { HttpModule } from "@nestjs/axios";
import { Module } from "@nestjs/common";
import { AdminModule } from "../admin/admin.module.js";
import { GuildsModule } from "../guilds/guilds.module.js";
import { InstantsController } from "./instants/instants.controller.js";
import { AdminInstantsController } from "./admin-instants/admin-instants.controller.js";
import { InstantAccessService } from "./instant-access/instant-access.service.js";
import { MyinstantsService } from "./myinstants/myinstants.service.js";
import { VoiceQueueService } from "./voice-queue/voice-queue.service.js";

@Module({
  imports: [HttpModule, AdminModule, GuildsModule],
  controllers: [InstantsController, AdminInstantsController],
  providers: [InstantAccessService, MyinstantsService, VoiceQueueService],
  exports: [InstantAccessService, MyinstantsService, VoiceQueueService]
})
export class InstantsModule {}
