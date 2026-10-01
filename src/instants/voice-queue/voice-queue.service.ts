import { StreamType, createAudioResource } from "@discordjs/voice";
import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { ApiError } from "../../common/api-error.js";
import type { Environment } from "../../config/environment.js";
import { DiscordVoiceService } from "../../voice/discord-voice.service.js";
import { InstantAccessService } from "../instant-access/instant-access.service.js";
import type {
  InstantLimits,
  InstantQueueFailure,
  InstantQueueItem,
  InstantQueueStatus,
  InstantRequestSource,
  PublicInstantQueueItem,
  ResolvedInstant
} from "../instants.types.js";
import { MyinstantsService } from "../myinstants/myinstants.service.js";

interface InstantSession {
  guildId: string;
  channelId: string;
  queue: InstantQueueItem[];
  current: InstantQueueItem | null;
  processing: boolean;
  lastError: InstantQueueFailure | null;
  transcoder: ChildProcessWithoutNullStreams | null;
}

@Injectable()
export class VoiceQueueService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(VoiceQueueService.name);
  private readonly sessions = new Map<string, InstantSession>();
  private readonly cooldowns = new Map<string, number>();
  private readonly guildLocks = new Map<string, Promise<void>>();
  private ffprobeAvailable = false;

  public constructor(
    private readonly config: ConfigService<Environment, true>,
    private readonly provider: MyinstantsService,
    private readonly access: InstantAccessService,
    private readonly voice: DiscordVoiceService
  ) {}

  public async onModuleInit(): Promise<void> {
    this.ffprobeAvailable = await this.checkFfprobe();
    if (!this.ffprobeAvailable) {
      this.logger.warn("ffprobe is unavailable; instant voice playback will remain disabled");
    }
  }

  public onApplicationShutdown(): void {
    this.stopAll();
  }

  public limits(): InstantLimits {
    return {
      maxAudioBytes: this.config.get("INSTANT_AUDIO_MAX_BYTES", { infer: true }),
      maxDurationSeconds: this.config.get("INSTANT_MAX_DURATION_SECONDS", { infer: true }),
      maxQueueLength: this.config.get("INSTANT_MAX_QUEUE_LENGTH", { infer: true }),
      userCooldownSeconds: this.config.get("INSTANT_USER_COOLDOWN_SECONDS", { infer: true }),
      maxActiveGuilds: this.config.get("INSTANT_MAX_ACTIVE_GUILDS", { infer: true }),
      idleDisconnectSeconds: this.config.get("INSTANT_IDLE_DISCONNECT_SECONDS", { infer: true })
    };
  }

  public isRuntimeAvailable(): boolean {
    return this.ffprobeAvailable && this.voice.isReady();
  }

  public listVoiceChannels(guildId: string) {
    return this.voice.listVoiceChannels(guildId);
  }

  public async enqueue(input: {
    guildId: string;
    voiceChannelId: string;
    instant: ResolvedInstant;
    requestedByDiscordUserId: string;
    requestedVia: InstantRequestSource;
  }): Promise<{ item: PublicInstantQueueItem; position: number; startsImmediately: boolean }> {
    return this.withGuildLock(input.guildId, async () => {
      if (!this.isRuntimeAvailable()) {
        throw new ApiError(
          503,
          "VOICE_RUNTIME_UNAVAILABLE",
          "Discord voice playback is unavailable"
        );
      }
      await this.access.requireCanPlay(input.requestedByDiscordUserId, input.guildId);
      this.enforceCooldown(input.guildId, input.requestedByDiscordUserId);
      await this.voice.acquire(input.guildId, input.voiceChannelId);

      let session = this.sessions.get(input.guildId);
      if (!session) {
        session = {
          guildId: input.guildId,
          channelId: input.voiceChannelId,
          queue: [],
          current: null,
          processing: false,
          lastError: null,
          transcoder: null
        };
        this.sessions.set(input.guildId, session);
      }
      session.channelId = input.voiceChannelId;
      if (session.queue.length >= this.limits().maxQueueLength) {
        throw new ApiError(429, "INSTANT_QUEUE_FULL", "The instant queue is full");
      }

      const startsImmediately =
        !session.current && !session.processing && session.queue.length === 0;
      const item: InstantQueueItem = {
        id: randomUUID(),
        title: input.instant.title,
        pageUrl: input.instant.pageUrl,
        audioUrl: input.instant.audioUrl,
        requestedByDiscordUserId: input.requestedByDiscordUserId,
        requestedVia: input.requestedVia,
        voiceChannelId: input.voiceChannelId,
        state: "QUEUED",
        enqueuedAt: new Date()
      };
      session.queue.push(item);
      this.voice.markBusy(input.guildId, "instant", true);
      const position = startsImmediately ? 0 : session.queue.length;
      void this.processQueue(session);
      return { item: this.publicItem(item, position), position, startsImmediately };
    });
  }

  public status(guildId: string): InstantQueueStatus {
    const session = this.sessions.get(guildId);
    const voiceStatus = this.voice.status(guildId);
    if (!session) {
      return { ...voiceStatus, current: null, items: [], lastError: null };
    }
    if (session.lastError && Date.now() - session.lastError.occurredAt.getTime() > 60_000) {
      session.lastError = null;
    }
    return {
      ...voiceStatus,
      current: session.current ? this.publicItem(session.current, 0) : null,
      items: session.queue.map((item, index) => this.publicItem(item, index + 1)),
      lastError: session.lastError
    };
  }

  public stopGuild(guildId: string): void {
    const session = this.sessions.get(guildId);
    if (session) {
      session.queue.length = 0;
      session.current = null;
      this.stopTranscoder(session);
      this.sessions.delete(guildId);
    }
    this.voice.stopInstant(guildId);
    this.voice.markBusy(guildId, "instant", false);
    this.voice.scheduleDisconnectIfIdle(guildId);
  }

  public stopAll(): void {
    for (const guildId of this.sessions.keys()) this.stopGuild(guildId);
  }

  private async processQueue(session: InstantSession): Promise<void> {
    if (session.processing || !this.sessions.has(session.guildId)) return;
    session.processing = true;
    this.voice.beginInstantMode(session.guildId);
    try {
      while (session.queue.length > 0 && this.sessions.has(session.guildId)) {
        const item = session.queue.shift()!;
        if (!(await this.access.canPlay(item.requestedByDiscordUserId, session.guildId))) continue;
        try {
          item.state = "PLAYING";
          session.current = item;
          const audio = await this.provider.downloadAudio(item.audioUrl);
          await this.assertDuration(audio);
          const transcoder = spawn(
            "ffmpeg",
            [
              "-hide_banner",
              "-loglevel",
              "error",
              "-i",
              "pipe:0",
              "-vn",
              "-c:a",
              "libopus",
              "-b:a",
              "96k",
              "-f",
              "ogg",
              "pipe:1"
            ],
            { stdio: ["pipe", "pipe", "pipe"] }
          );
          session.transcoder = transcoder;
          transcoder.stderr.resume();
          transcoder.stdin.on("error", () => undefined);
          transcoder.stdin.end(audio);
          await this.voice.playInstant(
            session.guildId,
            createAudioResource(transcoder.stdout, {
              inputType: StreamType.OggOpus,
              metadata: item
            })
          );
        } catch (error) {
          const apiError = error instanceof ApiError ? error : undefined;
          session.lastError = {
            code: apiError?.code ?? "INSTANT_PLAYBACK_FAILED",
            message: apiError?.message ?? "The instant could not be played",
            occurredAt: new Date()
          };
          this.logger.warn(`Skipped instant ${item.id}: ${String(error)}`);
        } finally {
          this.stopTranscoder(session);
          session.current = null;
        }
      }
    } finally {
      session.processing = false;
      this.voice.endInstantMode(session.guildId);
      this.voice.markBusy(session.guildId, "instant", false);
      this.voice.scheduleDisconnectIfIdle(session.guildId);
    }
  }

  private stopTranscoder(session: InstantSession): void {
    if (session.transcoder && !session.transcoder.killed) session.transcoder.kill("SIGKILL");
    session.transcoder = null;
  }

  private enforceCooldown(guildId: string, discordId: string): void {
    const cooldownMs = this.limits().userCooldownSeconds * 1_000;
    const key = `${guildId}:${discordId}`;
    const previous = this.cooldowns.get(key) ?? 0;
    if (Date.now() - previous < cooldownMs) {
      throw new ApiError(429, "INSTANT_COOLDOWN", "Wait a moment before queueing another instant");
    }
    this.cooldowns.set(key, Date.now());
  }

  private async assertDuration(buffer: Buffer): Promise<void> {
    const duration = await new Promise<number>((resolve, reject) => {
      const process = spawn(
        "ffprobe",
        [
          "-v",
          "error",
          "-select_streams",
          "a:0",
          "-show_entries",
          "packet=duration_time",
          "-of",
          "csv=p=0",
          "pipe:0"
        ],
        { stdio: ["pipe", "pipe", "ignore"] }
      );
      let output = "";
      let settled = false;
      const finish = (error?: ApiError, value?: number): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(value!);
      };
      const timer = setTimeout(() => {
        process.kill("SIGKILL");
        finish(new ApiError(503, "VOICE_RUNTIME_UNAVAILABLE", "ffprobe timed out"));
      }, 8_000);
      process.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
      });
      process.once("error", () =>
        finish(new ApiError(503, "VOICE_RUNTIME_UNAVAILABLE", "ffprobe is unavailable"))
      );
      process.stdin.on("error", () =>
        finish(new ApiError(400, "INVALID_INSTANT_AUDIO", "Audio duration could not be read"))
      );
      process.once("close", (code) => {
        if (code !== 0)
          return finish(
            new ApiError(400, "INVALID_INSTANT_AUDIO", "Audio duration could not be read")
          );
        const value = totalPacketDuration(output);
        if (value === null)
          return finish(
            new ApiError(400, "INVALID_INSTANT_AUDIO", "Audio duration could not be read")
          );
        finish(undefined, value);
      });
      process.stdin.end(buffer);
    });
    if (duration > this.limits().maxDurationSeconds) {
      throw new ApiError(
        400,
        "INSTANT_TOO_LONG",
        `Instant exceeds the ${this.limits().maxDurationSeconds}-second limit`
      );
    }
  }

  private async checkFfprobe(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const process = spawn("ffprobe", ["-version"], { stdio: "ignore" });
      const timer = setTimeout(() => {
        process.kill("SIGKILL");
        resolve(false);
      }, 3_000);
      process.once("error", () => {
        clearTimeout(timer);
        resolve(false);
      });
      process.once("close", (code) => {
        clearTimeout(timer);
        resolve(code === 0);
      });
    });
  }

  private publicItem(item: InstantQueueItem, position: number): PublicInstantQueueItem {
    const { audioUrl: _audioUrl, ...safe } = item;
    return { ...safe, position };
  }

  private async withGuildLock<T>(guildId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.guildLocks.get(guildId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.guildLocks.set(
      guildId,
      previous.then(() => current)
    );
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

export function totalPacketDuration(output: string): number | null {
  let duration = 0;
  let packetCount = 0;
  for (const line of output.split(/\r?\n/u)) {
    const value = Number(line.trim());
    if (!Number.isFinite(value) || value <= 0) continue;
    duration += value;
    packetCount += 1;
  }
  return packetCount > 0 && Number.isFinite(duration) ? duration : null;
}
