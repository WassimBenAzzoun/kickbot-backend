import { Module } from "@nestjs/common";
import { StreamersService } from "./streamers/streamers.service.js";

@Module({ providers: [StreamersService], exports: [StreamersService] })
export class StreamersModule {}
