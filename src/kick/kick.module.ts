import { Module } from "@nestjs/common";
import { KickService } from "./kick/kick.service.js";
import { HttpModule } from "@nestjs/axios";

@Module({
  imports: [HttpModule],
  providers: [KickService],
  exports: [KickService]
})
export class KickModule {}
