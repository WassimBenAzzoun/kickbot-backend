import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
  createAudioPlayer,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  type AudioPlayer,
  type AudioResource,
  type VoiceConnection
} from "@discordjs/voice";
import { Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ModuleRef } from "@nestjs/core";
import { ChannelType, Client, PermissionFlagsBits, type VoiceBasedChannel } from "discord.js";
import { ApiError } from "../common/api-error.js";
import type { Environment } from "../config/environment.js";

type BusyKind = "instant" | "music";

interface SharedVoiceSession {
  guildId: string;
  channelId: string;
  connection: VoiceConnection;
  instantPlayer: AudioPlayer;
  musicPlayer: AudioPlayer;
  instantMode: boolean;
  manualMusicPaused: boolean;
  busy: Set<BusyKind>;
  idleTimer: NodeJS.Timeout | null;
  idleDisconnectAt: Date | null;
  instantWaiters: Array<() => void>;
}

@Injectable()
export class DiscordVoiceService implements OnApplicationShutdown {
  private readonly logger = new Logger(DiscordVoiceService.name);
  private readonly sessions = new Map<string, SharedVoiceSession>();

  public constructor(
    private readonly moduleRef: ModuleRef,
    private readonly config: ConfigService<Environment, true>
  ) {}

  public onApplicationShutdown(): void {
    this.destroyAll();
  }

  public destroyAll(): void {
    for (const session of this.sessions.values()) this.destroySession(session);
  }

  public isReady(): boolean {
    return Boolean(this.client()?.isReady());
  }

  public async listVoiceChannels(guildId: string) {
    const guild = await this.requireClient().guilds.fetch(guildId);
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

  public async acquire(guildId: string, channelId: string): Promise<void> {
    let session = this.sessions.get(guildId);
    if (session?.connection.state.status === VoiceConnectionStatus.Destroyed) {
      this.destroySession(session);
      session = undefined;
    }
    if (session?.channelId === channelId) {
      this.cancelIdleDisconnect(session);
      return;
    }
    if (session && this.isBusy(session)) {
      throw new ApiError(
        409,
        "VOICE_CHANNEL_BUSY",
        "The bot is already playing in another voice channel"
      );
    }
    if (session) this.destroySession(session);
    if (this.sessions.size >= this.config.get("INSTANT_MAX_ACTIVE_GUILDS", { infer: true })) {
      throw new ApiError(429, "VOICE_CAPACITY_REACHED", "All voice sessions are busy");
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
    session = {
      guildId,
      channelId,
      connection,
      instantPlayer: createAudioPlayer({
        behaviors: { noSubscriber: NoSubscriberBehavior.Stop }
      }),
      musicPlayer: createAudioPlayer({
        behaviors: { noSubscriber: NoSubscriberBehavior.Pause }
      }),
      instantMode: false,
      manualMusicPaused: false,
      busy: new Set(),
      idleTimer: null,
      idleDisconnectAt: null,
      instantWaiters: []
    };
    connection.on("error", (error) => {
      this.logger.error(`Discord voice connection failed in guild ${guildId}: ${error.message}`);
    });
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
    } catch {
      connection.destroy();
      throw new ApiError(502, "VOICE_CONNECTION_FAILED", "Could not join the voice channel");
    }
    this.sessions.set(guildId, session);
  }

  public markBusy(guildId: string, kind: BusyKind, busy: boolean): void {
    const session = this.sessions.get(guildId);
    if (!session) return;
    if (busy) {
      session.busy.add(kind);
      this.cancelIdleDisconnect(session);
    } else {
      session.busy.delete(kind);
    }
  }

  public beginInstantMode(guildId: string): void {
    const session = this.requireSession(guildId);
    session.instantMode = true;
    session.busy.add("instant");
    this.cancelIdleDisconnect(session);
    if (session.musicPlayer.state.status !== AudioPlayerStatus.Idle) {
      session.musicPlayer.pause(true);
    }
    session.connection.subscribe(session.instantPlayer);
  }

  public endInstantMode(guildId: string): void {
    const session = this.sessions.get(guildId);
    if (!session) return;
    session.instantMode = false;
    session.busy.delete("instant");
    if (session.musicPlayer.state.status !== AudioPlayerStatus.Idle) {
      session.connection.subscribe(session.musicPlayer);
      if (!session.manualMusicPaused) session.musicPlayer.unpause();
    }
    for (const resolve of session.instantWaiters.splice(0)) resolve();
  }

  public async waitForInstantMode(guildId: string): Promise<void> {
    const session = this.requireSession(guildId);
    if (!session.instantMode) return;
    await new Promise<void>((resolve) => session.instantWaiters.push(resolve));
  }

  public playInstant(guildId: string, resource: AudioResource): Promise<void> {
    const session = this.requireSession(guildId);
    session.connection.subscribe(session.instantPlayer);
    return this.playAndWait(session.instantPlayer, resource);
  }

  public async playMusic(guildId: string, resource: AudioResource): Promise<void> {
    const session = this.requireSession(guildId);
    await this.waitForInstantMode(guildId);
    session.busy.add("music");
    session.connection.subscribe(session.musicPlayer);
    const completion = this.playAndWait(session.musicPlayer, resource);
    if (session.manualMusicPaused) session.musicPlayer.pause(true);
    await completion;
  }

  public pauseMusic(guildId: string): boolean {
    const session = this.requireSession(guildId);
    session.manualMusicPaused = true;
    if (session.musicPlayer.state.status === AudioPlayerStatus.Idle) return false;
    session.musicPlayer.pause(true);
    return true;
  }

  public resumeMusic(guildId: string): boolean {
    const session = this.requireSession(guildId);
    session.manualMusicPaused = false;
    if (session.instantMode || session.musicPlayer.state.status === AudioPlayerStatus.Idle) {
      return false;
    }
    session.connection.subscribe(session.musicPlayer);
    return session.musicPlayer.unpause();
  }

  public stopMusic(guildId: string): void {
    const session = this.sessions.get(guildId);
    if (!session) return;
    session.manualMusicPaused = false;
    session.musicPlayer.stop(true);
    session.busy.delete("music");
  }

  public stopInstant(guildId: string): void {
    const session = this.sessions.get(guildId);
    if (!session) return;
    session.instantPlayer.stop(true);
    this.endInstantMode(guildId);
  }

  public musicProgressMs(guildId: string): number {
    const session = this.sessions.get(guildId);
    if (!session || session.musicPlayer.state.status === AudioPlayerStatus.Idle) return 0;
    return session.musicPlayer.state.resource.playbackDuration;
  }

  public musicPaused(guildId: string): boolean {
    const session = this.sessions.get(guildId);
    return Boolean(session?.manualMusicPaused || session?.instantMode);
  }

  public instantActive(guildId: string): boolean {
    return Boolean(this.sessions.get(guildId)?.instantMode);
  }

  public status(guildId: string): {
    connectionState: "IDLE" | "CONNECTING" | "READY" | "PLAYING";
    voiceChannelId: string | null;
    idleDisconnectAt: Date | null;
  } {
    const session = this.sessions.get(guildId);
    if (!session) {
      return { connectionState: "IDLE", voiceChannelId: null, idleDisconnectAt: null };
    }
    const playing =
      session.instantPlayer.state.status !== AudioPlayerStatus.Idle ||
      session.musicPlayer.state.status !== AudioPlayerStatus.Idle;
    return {
      connectionState: playing
        ? "PLAYING"
        : session.connection.state.status === VoiceConnectionStatus.Ready
          ? "READY"
          : "CONNECTING",
      voiceChannelId: session.channelId,
      idleDisconnectAt: session.idleDisconnectAt
    };
  }

  public scheduleDisconnectIfIdle(guildId: string): void {
    const session = this.sessions.get(guildId);
    if (!session || session.idleTimer || this.isBusy(session)) return;
    const delayMs = this.config.get("INSTANT_IDLE_DISCONNECT_SECONDS", { infer: true }) * 1_000;
    session.idleDisconnectAt = new Date(Date.now() + delayMs);
    session.idleTimer = setTimeout(() => this.destroySession(session), delayMs);
    session.idleTimer.unref();
  }

  private playAndWait(player: AudioPlayer, resource: AudioResource): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        player.off(AudioPlayerStatus.Idle, onIdle);
        player.off("error", onError);
      };
      const onIdle = (): void => {
        cleanup();
        resolve();
      };
      const onError = (error: Error): void => {
        cleanup();
        reject(error);
      };
      player.once(AudioPlayerStatus.Idle, onIdle);
      player.once("error", onError);
      player.play(resource);
    });
  }

  private isBusy(session: SharedVoiceSession): boolean {
    return (
      session.busy.size > 0 ||
      session.instantMode ||
      session.instantPlayer.state.status !== AudioPlayerStatus.Idle ||
      session.musicPlayer.state.status !== AudioPlayerStatus.Idle
    );
  }

  private cancelIdleDisconnect(session: SharedVoiceSession): void {
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.idleTimer = null;
    session.idleDisconnectAt = null;
  }

  private destroySession(session: SharedVoiceSession): void {
    this.cancelIdleDisconnect(session);
    session.instantPlayer.stop(true);
    session.musicPlayer.stop(true);
    for (const resolve of session.instantWaiters.splice(0)) resolve();
    if (session.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      session.connection.destroy();
    }
    this.sessions.delete(session.guildId);
  }

  private requireSession(guildId: string): SharedVoiceSession {
    const session = this.sessions.get(guildId);
    if (!session) throw new ApiError(409, "VOICE_SESSION_MISSING", "Join a voice channel first");
    return session;
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
}
