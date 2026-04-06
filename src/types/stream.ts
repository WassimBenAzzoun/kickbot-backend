import { StreamPlatform } from "@prisma/client";

export interface NormalizedStreamStatus {
  platform: StreamPlatform;
  streamerUsername: string;
  isLive: boolean;
  streamUrl: string;
  title: string | null;
  category: string | null;
  thumbnailUrl: string | null;
  profileImageUrl: string | null;
  viewerCount: number | null;
  startedAt: Date | null;
}
