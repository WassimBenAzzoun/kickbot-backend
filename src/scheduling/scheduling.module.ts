import { Module } from "@nestjs/common";
import { SchedulingService } from "./scheduling/scheduling.service.js";
import { DiscordModule } from "../discord/discord.module.js";
import { KickModule } from "../kick/kick.module.js";

@Module({
  imports: [DiscordModule, KickModule],
  providers: [SchedulingService],
  exports: [SchedulingService]
})
export class SchedulingModule {}
