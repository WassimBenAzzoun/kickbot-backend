import { HttpModule } from "@nestjs/axios";
import { Global, Module } from "@nestjs/common";
import { AuthController, BotController } from "./auth.controller.js";
import { DiscordApiService } from "./discord-api.service.js";
import { SessionGuard } from "./session.guard.js";
import { SessionService } from "./session.service.js";

@Global()
@Module({
  imports: [HttpModule],
  controllers: [AuthController, BotController],
  providers: [DiscordApiService, SessionService, SessionGuard],
  exports: [DiscordApiService, SessionService, SessionGuard]
})
export class AuthModule {}
