import { StreamPlatform, TrackedStreamer } from "@prisma/client";

export interface StreamerDto {
  id: string;
  guildId: string;
  platform: StreamPlatform;
  streamerUsername: string;
  isActive: boolean;
  lastKnownLiveState: boolean;
  lastNotifiedLiveAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toStreamerDto(streamer: TrackedStreamer): StreamerDto {
  return {
    id: streamer.id,
    guildId: streamer.guildId,
    platform: streamer.platform,
    streamerUsername: streamer.streamerUsername,
    isActive: streamer.isActive,
    lastKnownLiveState: streamer.lastKnownLiveState,
    lastNotifiedLiveAt: streamer.lastNotifiedLiveAt?.toISOString() ?? null,
    createdAt: streamer.createdAt.toISOString(),
    updatedAt: streamer.updatedAt.toISOString()
  };
}