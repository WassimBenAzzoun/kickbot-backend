export interface InstantSearchResult {
  id: string;
  title: string;
  pageUrl: string;
}

export interface ResolvedInstant extends InstantSearchResult {
  audioUrl: string;
}

export type InstantRequestSource = "DASHBOARD" | "DISCORD";
export type InstantQueueItemState = "QUEUED" | "PLAYING";

export interface InstantQueueItem {
  id: string;
  title: string;
  pageUrl: string;
  audioUrl: string;
  requestedByDiscordUserId: string;
  requestedVia: InstantRequestSource;
  voiceChannelId: string;
  state: InstantQueueItemState;
  enqueuedAt: Date;
}

export interface PublicInstantQueueItem extends Omit<InstantQueueItem, "audioUrl"> {
  position: number;
}

export interface InstantQueueFailure {
  code: string;
  message: string;
  occurredAt: Date;
}

export interface InstantQueueStatus {
  connectionState: "IDLE" | "CONNECTING" | "READY" | "PLAYING";
  voiceChannelId: string | null;
  current: PublicInstantQueueItem | null;
  items: PublicInstantQueueItem[];
  idleDisconnectAt: Date | null;
  lastError: InstantQueueFailure | null;
}

export interface InstantLimits {
  maxAudioBytes: number;
  maxDurationSeconds: number;
  maxQueueLength: number;
  userCooldownSeconds: number;
  maxActiveGuilds: number;
  idleDisconnectSeconds: number;
}
