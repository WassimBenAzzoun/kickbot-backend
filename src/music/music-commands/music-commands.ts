import { Injectable, UseGuards } from "@nestjs/common";
import { ChannelType, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import {
  Context,
  createCommandGroupDecorator,
  Options,
  SlashCommand,
  StringOption,
  Subcommand,
  type SlashCommandContext
} from "necord";
import { ApiError } from "../../common/api-error.js";
import { InstantAccessGuard } from "../../instants/instant-access/instant-access.guard.js";
import { MusicQueueService } from "../music-queue/music-queue.service.js";

class PlayMusicOptions {
  @StringOption({
    name: "url",
    description: "A YouTube video/playlist or Spotify track/playlist URL",
    required: true
  })
  public url!: string;
}

const MusicCommand = createCommandGroupDecorator({
  name: "music",
  description: "Control YouTube and Spotify-matched music playback"
});

@Injectable()
export class PlayMusicCommand {
  public constructor(private readonly music: MusicQueueService) {}

  @SlashCommand({ name: "play", description: "Queue a YouTube or Spotify URL" })
  @UseGuards(InstantAccessGuard)
  public async play(
    @Context() [interaction]: SlashCommandContext,
    @Options() options: PlayMusicOptions
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const channel = memberVoiceChannel(interaction);
      const result = await this.music.enqueue({
        guildId: interaction.guildId!,
        voiceChannelId: channel.id,
        sourceUrl: options.url,
        requestedByDiscordUserId: interaction.user.id,
        requestedVia: "DISCORD"
      });
      const first = result.accepted[0];
      const lines = [
        `Queued ${result.accepted.length} track${result.accepted.length === 1 ? "" : "s"} in <#${channel.id}>.`,
        first ? `First: **${first.title}**${first.artist ? ` — ${first.artist}` : ""}` : "",
        result.rejected.length > 0
          ? `${result.rejected.length} playlist item${result.rejected.length === 1 ? " was" : "s were"} skipped.`
          : "",
        result.truncated ? "The playlist was limited to the configured maximum." : ""
      ].filter(Boolean);
      await interaction.editReply(lines.join("\n"));
    } catch (error) {
      await interaction.editReply(errorMessage(error));
    }
  }
}

@MusicCommand()
@Injectable()
export class MusicCommands {
  public constructor(private readonly music: MusicQueueService) {}

  @Subcommand({ name: "queue", description: "Show the current music queue" })
  @UseGuards(InstantAccessGuard)
  public async queue(@Context() [interaction]: SlashCommandContext): Promise<void> {
    const status = this.music.status(interaction.guildId!);
    const lines = [
      status.current
        ? `${status.paused ? "⏸️" : "▶️"} **${status.current.title}**${status.current.artist ? ` — ${status.current.artist}` : ""}`
        : "Nothing is playing.",
      status.interruptedByInstant ? "An Instant is temporarily interrupting music." : "",
      ...status.items.slice(0, 10).map((item) => `${item.position}. ${item.title}`)
    ].filter(Boolean);
    await interaction.reply({ content: lines.join("\n"), flags: MessageFlags.Ephemeral });
  }

  @Subcommand({ name: "pause", description: "Pause the current music track" })
  @UseGuards(InstantAccessGuard)
  public pause(@Context() [interaction]: SlashCommandContext) {
    return this.control(interaction, "pause", "Music paused.");
  }

  @Subcommand({ name: "resume", description: "Resume the current music track" })
  @UseGuards(InstantAccessGuard)
  public resume(@Context() [interaction]: SlashCommandContext) {
    return this.control(interaction, "resume", "Music resumed.");
  }

  @Subcommand({ name: "skip", description: "Skip the current music track" })
  @UseGuards(InstantAccessGuard)
  public skip(@Context() [interaction]: SlashCommandContext) {
    return this.control(interaction, "skip", "Skipped the current track.");
  }

  @Subcommand({ name: "stop", description: "Stop music and clear only the music queue" })
  @UseGuards(InstantAccessGuard)
  public stop(@Context() [interaction]: SlashCommandContext) {
    return this.control(interaction, "stop", "Music stopped and the queue was cleared.");
  }

  private async control(
    interaction: ChatInputCommandInteraction,
    action: "pause" | "resume" | "skip" | "stop",
    success: string
  ): Promise<void> {
    try {
      this.music[action](interaction.guildId!);
      await interaction.reply({ content: success, flags: MessageFlags.Ephemeral });
    } catch (error) {
      await interaction.reply({ content: errorMessage(error), flags: MessageFlags.Ephemeral });
    }
  }
}

function memberVoiceChannel(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) {
    throw new ApiError(400, "GUILD_REQUIRED", "Use this command inside a Discord server");
  }
  const channel = interaction.member.voice.channel;
  if (!channel || channel.type !== ChannelType.GuildVoice) {
    throw new ApiError(400, "VOICE_CHANNEL_REQUIRED", "Join a normal voice channel first");
  }
  return channel;
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Music playback failed. Try again later.";
}
