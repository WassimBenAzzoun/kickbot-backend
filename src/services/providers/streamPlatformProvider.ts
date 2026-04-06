import { StreamPlatform } from "@prisma/client";
import { NormalizedStreamStatus } from "../../types/stream";

export interface StreamPlatformProvider {
  readonly platform: StreamPlatform;
  getStreamStatus(streamerUsername: string): Promise<NormalizedStreamStatus>;
}