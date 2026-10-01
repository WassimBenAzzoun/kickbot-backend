import { StreamType, createAudioResource } from "@discordjs/voice";
import { Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { platform } from "node:os";
import { ApiError } from "../../common/api-error.js";
import type { Environment } from "../../config/environment.js";
import { InstantAccessService } from "../../instants/instant-access/instant-access.service.js";
import { DiscordVoiceService } from "../../voice/discord-voice.service.js";
import type {
  MusicEnqueueResult,
  MusicLimits,
  MusicQueueFailure,
  MusicQueueItem,
  MusicQueueStatus,
  MusicRequestSource
} from "../music.types.js";
import { MusicSourceService } from "../music-source/music-source.service.js";

interface GuildMusicSession {
  guildId: string;
  channelId: string;
  queue: MusicQueueItem[];
  current: MusicQueueItem | null;
  processing: boolean;
  extractor: ChildProcess | null;
  transcoder: ChildProcess | null;
  lastError: MusicQueueFailure | null;
  generation: number;
}

@Injectable()
export class MusicQueueService implements OnApplicationShutdown {
  private readonly logger = new Logger(MusicQueueService.name);
  private readonly sessions = new Map<string, GuildMusicSession>();
  private readonly guildLocks = new Map<string, Promise<void>>();

  public constructor(
    private readonly config: ConfigService<Environment, true>,
    private readonly sources: MusicSourceService,
    private readonly access: InstantAccessService,
    private readonly voice: DiscordVoiceService
  ) {}

  public onApplicationShutdown(): void {
    this.stopAll();
  }

  public stopAll(): void {
    for (const guildId of this.sessions.keys()) this.stop(guildId);
  }

  public limits(): MusicLimits {
    return {
      maxDurationSeconds: this.config.get("MUSIC_MAX_DURATION_SECONDS", { infer: true }),
      maxPlaylistItems: this.config.get("MUSIC_MAX_PLAYLIST_ITEMS", { infer: true }),
      maxQueueLength: this.config.get("MUSIC_MAX_QUEUE_LENGTH", { infer: true }),
      maxActiveGuilds: this.config.get("MUSIC_MAX_ACTIVE_GUILDS", { infer: true })
    };
  }

  public isRuntimeAvailable(): boolean {
    return this.sources.isRuntimeAvailable() && this.voice.isReady();
  }

  public async enqueue(input: {
    guildId: string;
    voiceChannelId: string;
    sourceUrl: string;
    requestedByDiscordUserId: string;
    requestedVia: MusicRequestSource;
  }): Promise<MusicEnqueueResult> {
    return this.withGuildLock(input.guildId, async () => {
      if (!this.isRuntimeAvailable()) {
        throw new ApiError(503, "MUSIC_SOURCE_UNAVAILABLE", "Music playback is unavailable");
      }
      await this.access.requireCanPlay(input.requestedByDiscordUserId, input.guildId);
      const resolved = await this.sources.resolve(input.sourceUrl);
      await this.access.requireCanPlay(input.requestedByDiscordUserId, input.guildId);
      if (resolved.tracks.length === 0) {
        const first = resolved.rejected[0];
        throw new ApiError(
          422,
          first?.code ?? "MUSIC_SOURCE_UNAVAILABLE",
          first?.message ?? "No playable tracks were found"
        );
      }
      let session = this.sessions.get(input.guildId);
      if (!session) {
        const active = [...this.sessions.values()].filter(
          (candidate) => candidate.current || candidate.queue.length > 0
        ).length;
        if (active >= this.limits().maxActiveGuilds) {
          throw new ApiError(429, "MUSIC_CAPACITY_REACHED", "All music playback sessions are busy");
        }
      }
      await this.voice.acquire(input.guildId, input.voiceChannelId);
      if (!session) {
        session = {
          guildId: input.guildId,
          channelId: input.voiceChannelId,
          queue: [],
          current: null,
          processing: false,
          extractor: null,
          transcoder: null,
          lastError: null,
          generation: 0
        };
        this.sessions.set(input.guildId, session);
      }
      session.channelId = input.voiceChannelId;
      const available =
        this.limits().maxQueueLength - session.queue.length - (session.current ? 1 : 0);
      if (available <= 0) throw new ApiError(429, "MUSIC_QUEUE_FULL", "The music queue is full");

      const acceptedTracks = resolved.tracks.slice(0, available);
      const rejected = [...resolved.rejected];
      for (const track of resolved.tracks.slice(available)) {
        rejected.push({
          sourceUrl: track.originalUrl,
          title: track.title,
          code: "MUSIC_QUEUE_FULL",
          message: "The music queue is full"
        });
      }
      const accepted = acceptedTracks.map<MusicQueueItem>((track, index) => ({
        ...track,
        id: randomUUID(),
        requestedByDiscordUserId: input.requestedByDiscordUserId,
        requestedVia: input.requestedVia,
        voiceChannelId: input.voiceChannelId,
        state: "QUEUED",
        position: session!.queue.length + index + (session!.current ? 1 : 0),
        enqueuedAt: new Date()
      }));
      session.queue.push(...accepted);
      this.voice.markBusy(input.guildId, "music", true);
      void this.processQueue(session);
      return {
        accepted,
        rejected,
        truncated: resolved.truncated || acceptedTracks.length < resolved.tracks.length
      };
    });
  }

  public status(guildId: string): MusicQueueStatus {
    const session = this.sessions.get(guildId);
    const shared = this.voice.status(guildId);
    if (!session) {
      return {
        ...shared,
        current: null,
        items: [],
        paused: false,
        interruptedByInstant: this.voice.instantActive(guildId),
        progressMs: 0,
        lastError: null
      };
    }
    if (session.lastError && Date.now() - session.lastError.occurredAt.getTime() > 60_000)
      session.lastError = null;
    const paused = this.voice.musicPaused(guildId);
    return {
      ...shared,
      current: session.current
        ? { ...session.current, state: paused ? "PAUSED" : "PLAYING", position: 0 }
        : null,
      items: session.queue.map((item, index) => ({
        ...item,
        state: "QUEUED",
        position: index + 1
      })),
      paused,
      interruptedByInstant: this.voice.instantActive(guildId),
      progressMs: this.voice.musicProgressMs(guildId),
      lastError: session.lastError
    };
  }

  public pause(guildId: string): void {
    const session = this.requireActive(guildId);
    if (!session.current || !this.voice.pauseMusic(guildId)) {
      throw new ApiError(409, "MUSIC_NOT_PLAYING", "No music is currently playing");
    }
  }

  public resume(guildId: string): void {
    const session = this.requireActive(guildId);
    if (!session.current)
      throw new ApiError(409, "MUSIC_NOT_PLAYING", "No music is currently playing");
    this.voice.resumeMusic(guildId);
  }

  public skip(guildId: string): void {
    const session = this.requireActive(guildId);
    if (!session.current)
      throw new ApiError(409, "MUSIC_NOT_PLAYING", "No music is currently playing");
    session.generation += 1;
    this.stopProcesses(session);
    this.voice.stopMusic(guildId);
  }

  public stop(guildId: string): void {
    const session = this.sessions.get(guildId);
    if (session) {
      session.generation += 1;
      session.queue.length = 0;
      session.current = null;
      this.stopProcesses(session);
      this.sessions.delete(guildId);
    }
    this.voice.stopMusic(guildId);
    this.voice.markBusy(guildId, "music", false);
    this.voice.scheduleDisconnectIfIdle(guildId);
  }

  private async processQueue(session: GuildMusicSession): Promise<void> {
    if (session.processing || !this.sessions.has(session.guildId)) return;
    session.processing = true;
    try {
      while (session.queue.length > 0 && this.sessions.has(session.guildId)) {
        const item = session.queue.shift()!;
        if (!(await this.access.canPlay(item.requestedByDiscordUserId, session.guildId))) continue;
        const generation = session.generation;
        session.current = { ...item, state: "PLAYING", position: 0 };
        try {
          const source = this.sources.spawnAudio(item);
          session.extractor = source.process;
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
              "128k",
              "-f",
              "ogg",
              "pipe:1"
            ],
            {
              shell: false,
              detached: platform() !== "win32",
              stdio: ["pipe", "pipe", "pipe"]
            }
          );
          session.transcoder = transcoder;
          let ffmpegError = "";
          transcoder.stderr.on("data", (chunk: Buffer) => {
            if (ffmpegError.length < 65_536) ffmpegError += chunk.toString("utf8");
          });
          source.process.stdout.pipe(transcoder.stdin);
          transcoder.stdin.on("error", () => this.voice.stopMusic(session.guildId));
          source.process.once("error", () => this.voice.stopMusic(session.guildId));
          source.process.once("close", (code) => {
            if (code && code !== 0 && generation === session.generation) {
              const blocked = /(403|forbidden|po token|sign in|challenge)/iu.test(source.stderr());
              session.lastError = {
                code: blocked ? "YOUTUBE_BLOCKED" : "MUSIC_SOURCE_UNAVAILABLE",
                message: blocked
                  ? "YouTube blocked playback from this server"
                  : "The music stream ended unexpectedly",
                occurredAt: new Date()
              };
              this.voice.stopMusic(session.guildId);
            }
          });
          transcoder.once("error", () => this.voice.stopMusic(session.guildId));
          transcoder.once("close", (code) => {
            if (code && code !== 0 && generation === session.generation) {
              this.logger.warn(
                `FFmpeg failed in guild ${session.guildId}: ${ffmpegError.slice(-500)}`
              );
              this.voice.stopMusic(session.guildId);
            }
          });
          await this.voice.playMusic(
            session.guildId,
            createAudioResource(transcoder.stdout, {
              inputType: StreamType.OggOpus,
              metadata: item
            })
          );
        } catch (error) {
          const apiError = error instanceof ApiError ? error : undefined;
          session.lastError = {
            code: apiError?.code ?? "MUSIC_SOURCE_UNAVAILABLE",
            message: apiError?.message ?? "Music playback failed",
            occurredAt: new Date()
          };
          this.logger.warn(`Skipped music item ${item.id}: ${String(error)}`);
        } finally {
          this.stopProcesses(session);
          session.current = null;
        }
      }
    } finally {
      session.processing = false;
      this.voice.markBusy(session.guildId, "music", false);
      this.voice.scheduleDisconnectIfIdle(session.guildId);
    }
  }

  private stopProcesses(session: GuildMusicSession): void {
    for (const process of [session.extractor, session.transcoder]) {
      if (process) this.sources.terminateProcess(process);
    }
    session.extractor = null;
    session.transcoder = null;
  }

  private requireActive(guildId: string): GuildMusicSession {
    const session = this.sessions.get(guildId);
    if (!session) throw new ApiError(409, "MUSIC_NOT_PLAYING", "No music is currently queued");
    return session;
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
