import { Global, Module } from "@nestjs/common";
import { DiscordVoiceService } from "./discord-voice.service.js";

@Global()
@Module({
  providers: [DiscordVoiceService],
  exports: [DiscordVoiceService]
})
export class VoiceModule {}
