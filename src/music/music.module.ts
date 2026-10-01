import { Module } from "@nestjs/common";
import { GuildsModule } from "../guilds/guilds.module.js";
import { InstantsModule } from "../instants/instants.module.js";
import { MusicCommands, PlayMusicCommand } from "./music-commands/music-commands.js";
import { MusicQueueService } from "./music-queue/music-queue.service.js";
import { MusicSourceService } from "./music-source/music-source.service.js";
import { MusicController } from "./music/music.controller.js";

@Module({
  imports: [GuildsModule, InstantsModule],
  controllers: [MusicController],
  providers: [MusicSourceService, MusicQueueService, PlayMusicCommand, MusicCommands],
  exports: [MusicSourceService, MusicQueueService]
})
export class MusicModule {}
