import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  type AudioPlayer,
  type VoiceConnection
} from "@discordjs/voice";
import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ModuleRef } from "@nestjs/core";
import { ChannelType, Client, PermissionFlagsBits, type VoiceBasedChannel } from "discord.js";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { ApiError } from "../../common/api-error.js";
import type { Environment } from "../../config/environment.js";
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

interface GuildVoiceSession {
  guildId: string;
  channelId: string;
  connection: VoiceConnection;
  player: AudioPlayer;
  queue: InstantQueueItem[];
  current: InstantQueueItem | null;
  processing: boolean;
  idleTimer: NodeJS.Timeout | null;
  idleDisconnectAt: Date | null;
  lastError: InstantQueueFailure | null;
  transcoder: ChildProcessWithoutNullStreams | null;
}

@Injectable()
export class VoiceQueueService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(VoiceQueueService.name);
  private readonly sessions = new Map<string, GuildVoiceSession>();
  private readonly cooldowns = new Map<string, number>();
  private readonly guildLocks = new Map<string, Promise<void>>();
  private ffprobeAvailable = false;

  public constructor(
    private readonly moduleRef: ModuleRef,
    private readonly config: ConfigService<Environment, true>,
    private readonly provider: MyinstantsService,
    private readonly access: InstantAccessService
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
    return this.ffprobeAvailable && Boolean(this.client()?.isReady());
  }

  public async listVoiceChannels(guildId: string) {
    const client = this.requireClient();
    const guild = await client.guilds.fetch(guildId);
    const me = guild.members.me ?? (await guild.members.fetchMe());
    const channels = await guild.channels.fetch();
    return [...channels.values()]
      .filter((channel): channel is VoiceBasedChannel => {
        if (!channel || channel.type !== ChannelType.GuildVoice) return false;
        const permissions = channel.permissionsFor(me);
        return Boolean(
          permissions?.has([
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.Connect,
            PermissionFlagsBits.Speak
          ]) && channel.joinable
        );
      })
      .sort((left, right) => left.position - right.position)
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        type: channel.type,
        memberCount: channel.members.size
      }));
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
      await this.requireVoiceChannel(input.guildId, input.voiceChannelId);
      this.enforceCooldown(input.guildId, input.requestedByDiscordUserId);

      let session = this.sessions.get(input.guildId);
      if (session && session.channelId !== input.voiceChannelId) {
        if (session.current || session.queue.length > 0) {
          throw new ApiError(
            409,
            "VOICE_CHANNEL_BUSY",
            "The bot is already playing in another voice channel"
          );
        }
        this.destroySession(session);
        session = undefined;
      }
      if (!session) session = await this.createSession(input.guildId, input.voiceChannelId);

      const limits = this.limits();
      if (session.queue.length >= limits.maxQueueLength) {
        throw new ApiError(429, "INSTANT_QUEUE_FULL", "The instant queue is full");
      }
      this.cancelIdleDisconnect(session);
      const startsImmediately =
        session.current === null && !session.processing && session.queue.length === 0;
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
      const position =
        session.current || session.processing
          ? session.queue.length
          : Math.max(0, session.queue.length - 1);
      void this.processNext(session);
      return { item: this.publicItem(item, position), position, startsImmediately };
    });
  }

  public status(guildId: string): InstantQueueStatus {
    const session = this.sessions.get(guildId);
    if (!session) {
      return {
        connectionState: "IDLE",
        voiceChannelId: null,
        current: null,
        items: [],
        idleDisconnectAt: null,
        lastError: null
      };
    }
    if (session.lastError && Date.now() - session.lastError.occurredAt.getTime() > 60_000) {
      session.lastError = null;
    }
    return {
      connectionState: session.current
        ? "PLAYING"
        : session.connection.state.status === VoiceConnectionStatus.Ready
          ? "READY"
          : "CONNECTING",
      voiceChannelId: session.channelId,
      current: session.current ? this.publicItem(session.current, 0) : null,
      items: session.queue.map((item, index) => this.publicItem(item, index + 1)),
      idleDisconnectAt: session.idleDisconnectAt,
      lastError: session.lastError
    };
  }

  public stopGuild(guildId: string): void {
    const session = this.sessions.get(guildId);
    if (session) this.destroySession(session);
  }

  public stopAll(): void {
    for (const session of this.sessions.values()) this.destroySession(session);
  }

  private async createSession(guildId: string, channelId: string): Promise<GuildVoiceSession> {
    if (this.sessions.size >= this.limits().maxActiveGuilds) {
      throw new ApiError(429, "VOICE_CAPACITY_REACHED", "All instant voice sessions are busy");
    }
    const channel = await this.requireVoiceChannel(guildId, channelId);
    getVoiceConnection(guildId)?.destroy();
    const connection = joinVoiceChannel({
      guildId,
      channelId,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false
    });
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Stop } });
    const session: GuildVoiceSession = {
      guildId,
      channelId,
      connection,
      player,
      queue: [],
      current: null,
      processing: false,
      idleTimer: null,
      idleDisconnectAt: null,
      lastError: null,
      transcoder: null
    };
    player.on(AudioPlayerStatus.Idle, () => {
      if (!session.current) return;
      this.stopTranscoder(session);
      session.current = null;
      void this.processNext(session);
    });
    player.on("error", (error) => {
      this.logger.error(`Instant playback failed in guild ${guildId}: ${error.message}`);
      session.lastError = {
        code: "INSTANT_PLAYBACK_FAILED",
        message: "The instant could not be played",
        occurredAt: new Date()
      };
      this.stopTranscoder(session);
      session.current = null;
      void this.processNext(session);
    });
    connection.on("error", (error) => {
      this.logger.error(`Discord voice connection failed in guild ${guildId}: ${error.message}`);
      session.lastError = {
        code: "VOICE_CONNECTION_FAILED",
        message: "The Discord voice connection failed",
        occurredAt: new Date()
      };
    });
    connection.subscribe(player);
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
    } catch {
      connection.destroy();
      throw new ApiError(502, "VOICE_CONNECTION_FAILED", "Could not join the voice channel");
    }
    this.sessions.set(guildId, session);
    return session;
  }

  private async processNext(session: GuildVoiceSession): Promise<void> {
    if (session.processing || session.current || !this.sessions.has(session.guildId)) return;
    session.processing = true;
    this.cancelIdleDisconnect(session);
    try {
      while (session.queue.length > 0) {
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
          transcoder.once("error", (error) => {
            this.logger.error(`FFmpeg failed in guild ${session.guildId}: ${error.message}`);
            session.player.stop(true);
          });
          transcoder.stdin.on("error", (error) => {
            this.logger.warn(
              `FFmpeg input closed early in guild ${session.guildId}: ${error.message}`
            );
            session.player.stop(true);
          });
          transcoder.stdin.end(audio);
          const resource = createAudioResource(transcoder.stdout, {
            inputType: StreamType.OggOpus,
            metadata: item
          });
          session.player.play(resource);
          return;
        } catch (error) {
          session.current = null;
          const apiError = error instanceof ApiError ? error : undefined;
          session.lastError = {
            code: apiError?.code ?? "INSTANT_PLAYBACK_FAILED",
            message: apiError?.message ?? "The instant could not be played",
            occurredAt: new Date()
          };
          this.logger.warn(`Skipped instant ${item.id}: ${String(error)}`);
        }
      }
      this.scheduleIdleDisconnect(session);
    } finally {
      session.processing = false;
    }
  }

  private scheduleIdleDisconnect(session: GuildVoiceSession): void {
    if (session.idleTimer || session.current || session.queue.length > 0) return;
    const delayMs = this.limits().idleDisconnectSeconds * 1_000;
    session.idleDisconnectAt = new Date(Date.now() + delayMs);
    session.idleTimer = setTimeout(() => this.destroySession(session), delayMs);
    session.idleTimer.unref();
  }

  private cancelIdleDisconnect(session: GuildVoiceSession): void {
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.idleTimer = null;
    session.idleDisconnectAt = null;
  }

  private destroySession(session: GuildVoiceSession): void {
    this.cancelIdleDisconnect(session);
    session.queue.length = 0;
    session.current = null;
    this.stopTranscoder(session);
    session.player.stop(true);
    if (session.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      session.connection.destroy();
    }
    this.sessions.delete(session.guildId);
  }

  private stopTranscoder(session: GuildVoiceSession): void {
    if (session.transcoder && !session.transcoder.killed) session.transcoder.kill();
    session.transcoder = null;
  }

  private async requireVoiceChannel(
    guildId: string,
    channelId: string
  ): Promise<VoiceBasedChannel> {
    const guild = await this.requireClient().guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId);
    if (!channel || channel.type !== ChannelType.GuildVoice) {
      throw new ApiError(400, "INVALID_VOICE_CHANNEL", "Choose a normal Discord voice channel");
    }
    const me = guild.members.me ?? (await guild.members.fetchMe());
    const permissions = channel.permissionsFor(me);
    if (
      !permissions?.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak
      ]) ||
      !channel.joinable
    ) {
      throw new ApiError(
        403,
        "VOICE_PERMISSION_MISSING",
        "The bot needs View Channel, Connect, and Speak in that channel"
      );
    }
    return channel;
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
      const fail = (error: ApiError): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      };
      const timer = setTimeout(() => {
        process.kill();
        fail(new ApiError(503, "VOICE_RUNTIME_UNAVAILABLE", "ffprobe timed out"));
      }, 8_000);
      process.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
      });
      process.once("error", () => {
        fail(new ApiError(503, "VOICE_RUNTIME_UNAVAILABLE", "ffprobe is unavailable"));
      });
      process.stdin.on("error", () => {
        fail(new ApiError(400, "INVALID_INSTANT_AUDIO", "Audio duration could not be read"));
      });
      process.once("close", (code) => {
        if (settled) return;
        if (code !== 0) {
          fail(new ApiError(400, "INVALID_INSTANT_AUDIO", "Audio duration could not be read"));
          return;
        }
        const value = totalPacketDuration(output);
        if (value === null) {
          fail(new ApiError(400, "INVALID_INSTANT_AUDIO", "Audio duration could not be read"));
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(value);
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
        process.kill();
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

  private client(): Client | undefined {
    try {
      return this.moduleRef.get(Client, { strict: false });
    } catch {
      return undefined;
    }
  }

  private requireClient(): Client {
    const client = this.client();
    if (!client?.isReady()) {
      throw new ApiError(503, "DISCORD_NOT_READY", "Discord is not ready");
    }
    return client;
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
