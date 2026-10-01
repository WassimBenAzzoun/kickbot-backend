import type { ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

export type MusicProvider = "YOUTUBE" | "SPOTIFY";
export type MusicRequestSource = "DASHBOARD" | "DISCORD";
export type MusicQueueItemState = "QUEUED" | "PLAYING" | "PAUSED";

export interface ResolvedMusicTrack {
  sourceId: string;
  title: string;
  artist: string | null;
  provider: MusicProvider;
  originalUrl: string;
  resolvedYouTubeUrl: string;
  thumbnailUrl: string | null;
  durationSeconds: number;
}

export interface RejectedMusicTrack {
  sourceUrl: string;
  title?: string;
  code: string;
  message: string;
}

export interface ResolvedMusicSource {
  tracks: ResolvedMusicTrack[];
  rejected: RejectedMusicTrack[];
  truncated: boolean;
}

export interface MusicQueueItem extends ResolvedMusicTrack {
  id: string;
  requestedByDiscordUserId: string;
  requestedVia: MusicRequestSource;
  voiceChannelId: string;
  state: MusicQueueItemState;
  position: number;
  enqueuedAt: Date;
}

export interface MusicQueueFailure {
  code: string;
  message: string;
  occurredAt: Date;
}

export interface MusicQueueStatus {
  connectionState: "IDLE" | "CONNECTING" | "READY" | "PLAYING";
  voiceChannelId: string | null;
  current: MusicQueueItem | null;
  items: MusicQueueItem[];
  paused: boolean;
  interruptedByInstant: boolean;
  progressMs: number;
  idleDisconnectAt: Date | null;
  lastError: MusicQueueFailure | null;
}

export interface MusicLimits {
  maxDurationSeconds: number;
  maxPlaylistItems: number;
  maxQueueLength: number;
  maxActiveGuilds: number;
}

export interface MusicEnqueueResult {
  accepted: MusicQueueItem[];
  rejected: RejectedMusicTrack[];
  truncated: boolean;
}

export interface SpawnedMusicStream {
  process: ChildProcessByStdio<null, Readable, Readable>;
  stderr: () => string;
}
