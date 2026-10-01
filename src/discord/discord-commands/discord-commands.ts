import { Injectable, UseGuards } from "@nestjs/common";
import { ChannelType, MessageFlags, type GuildBasedChannel } from "discord.js";
import {
  ChannelOption,
  Context,
  createCommandGroupDecorator,
  Options,
  SlashCommand,
  type SlashCommandContext,
  StringOption,
  Subcommand
} from "necord";
import { PrismaService } from "../../database/prisma.service.js";
import { StreamersService } from "../../streamers/streamers/streamers.service.js";
import { GuildManagerGuard } from "../guild-manager.guard.js";

class ChannelOptions {
  @ChannelOption({
    name: "channel",
    description: "Text channel for Kick live alerts",
    required: true,
    channel_types: [ChannelType.GuildText, ChannelType.GuildAnnouncement]
  })
  public channel!: GuildBasedChannel;
}

class StreamerOptions {
  @StringOption({ name: "kick_username", description: "Kick username", required: true })
  public username!: string;
}

const ConfigCommand = createCommandGroupDecorator({
  name: "config",
  description: "Manage Kick alert configuration"
});
const StreamerCommand = createCommandGroupDecorator({
  name: "streamer",
  description: "Manage tracked Kick streamers"
});

@Injectable()
export class DiscordCommands {
  @SlashCommand({ name: "ping", description: "Check whether KickBot is online" })
  public async ping(@Context() [interaction]: SlashCommandContext): Promise<void> {
    await interaction.reply({
      content: `Pong! ${interaction.client.ws.ping}ms`,
      flags: MessageFlags.Ephemeral
    });
  }

  @SlashCommand({ name: "help", description: "Show KickBot commands" })
  public async help(@Context() [interaction]: SlashCommandContext): Promise<void> {
    await interaction.reply({
      content: [
        "**KickBot commands**",
        "`/config channel` – choose the live-alert channel",
        "`/config view` – show this server's configuration",
        "`/streamer add|remove|enable|disable|list` – manage tracked Kick channels",
        "`/instant play|search|queue|stop` – play Myinstants sounds in voice",
        "`/play url` – queue a YouTube or Spotify URL",
        "`/music queue|pause|resume|skip|stop` – control music playback"
      ].join("\n"),
      flags: MessageFlags.Ephemeral
    });
  }
}

@ConfigCommand()
@Injectable()
@UseGuards(GuildManagerGuard)
export class ConfigCommands {
  public constructor(private readonly prisma: PrismaService) {}

  @Subcommand({ name: "channel", description: "Set the Discord channel where alerts are sent" })
  public async channel(
    @Context() [interaction]: SlashCommandContext,
    @Options() options: ChannelOptions
  ): Promise<void> {
    const guildId = interaction.guildId!;
    await this.prisma.discordGuild.upsert({
      where: { id: guildId },
      create: {
        id: guildId,
        name: interaction.guild?.name,
        iconHash: interaction.guild?.icon,
        alertChannelId: options.channel.id,
        lastSeenAt: new Date()
      },
      update: {
        name: interaction.guild?.name,
        iconHash: interaction.guild?.icon,
        alertChannelId: options.channel.id,
        lastSeenAt: new Date()
      }
    });
    await interaction.reply({
      content: `Live alerts will be sent to <#${options.channel.id}>.`,
      flags: MessageFlags.Ephemeral
    });
  }

  @Subcommand({ name: "view", description: "View the current Kick alert configuration" })
  public async view(@Context() [interaction]: SlashCommandContext): Promise<void> {
    const guild = await this.prisma.discordGuild.findUnique({
      where: { id: interaction.guildId! }
    });
    await interaction.reply({
      content: guild?.alertChannelId
        ? `Alert channel: <#${guild.alertChannelId}>`
        : "No alert channel is configured.",
      flags: MessageFlags.Ephemeral
    });
  }
}

@StreamerCommand()
@Injectable()
@UseGuards(GuildManagerGuard)
export class StreamerCommands {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly streamers: StreamersService
  ) {}

  @Subcommand({ name: "add", description: "Add a Kick streamer to tracking" })
  public async add(
    @Context() [interaction]: SlashCommandContext,
    @Options() options: StreamerOptions
  ): Promise<void> {
    await this.ensureGuild(interaction);
    const streamer = await this.streamers.add(interaction.guildId!, options.username);
    await interaction.reply({
      content: `Now tracking **${streamer.username}**.`,
      flags: MessageFlags.Ephemeral
    });
  }

  @Subcommand({ name: "remove", description: "Remove a tracked Kick streamer" })
  public async remove(
    @Context() [interaction]: SlashCommandContext,
    @Options() options: StreamerOptions
  ): Promise<void> {
    const streamer = await this.requireStreamer(interaction.guildId!, options.username);
    await this.streamers.remove(interaction.guildId!, streamer.id);
    await interaction.reply({
      content: `Stopped tracking **${streamer.username}**.`,
      flags: MessageFlags.Ephemeral
    });
  }

  @Subcommand({ name: "enable", description: "Enable tracking for a Kick streamer" })
  public enable(
    @Context() context: SlashCommandContext,
    @Options() options: StreamerOptions
  ): Promise<void> {
    return this.setEnabled(context, options.username, true);
  }

  @Subcommand({ name: "disable", description: "Disable tracking for a Kick streamer" })
  public disable(
    @Context() context: SlashCommandContext,
    @Options() options: StreamerOptions
  ): Promise<void> {
    return this.setEnabled(context, options.username, false);
  }

  @Subcommand({ name: "list", description: "List tracked Kick streamers" })
  public async list(@Context() [interaction]: SlashCommandContext): Promise<void> {
    const items = await this.streamers.list(interaction.guildId!);
    const content =
      items.length === 0
        ? "No Kick streamers are tracked."
        : items
            .map((item) => `${item.enabled ? "✅" : "⏸️"} ${item.username}`)
            .join("\n")
            .slice(0, 1900);
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }

  private async setEnabled(
    [interaction]: SlashCommandContext,
    username: string,
    enabled: boolean
  ): Promise<void> {
    const streamer = await this.requireStreamer(interaction.guildId!, username);
    await this.streamers.update(interaction.guildId!, streamer.id, enabled);
    await interaction.reply({
      content: `${enabled ? "Enabled" : "Disabled"} **${streamer.username}**.`,
      flags: MessageFlags.Ephemeral
    });
  }

  private async requireStreamer(guildId: string, username: string) {
    const streamer = await this.streamers.findByUsername(guildId, username);
    if (!streamer) throw new Error(`Streamer ${username} is not tracked`);
    return streamer;
  }

  private async ensureGuild(interaction: SlashCommandContext[0]): Promise<void> {
    await this.prisma.discordGuild.upsert({
      where: { id: interaction.guildId! },
      create: {
        id: interaction.guildId!,
        name: interaction.guild?.name,
        iconHash: interaction.guild?.icon,
        lastSeenAt: new Date()
      },
      update: {
        name: interaction.guild?.name,
        iconHash: interaction.guild?.icon,
        lastSeenAt: new Date()
      }
    });
  }
}
