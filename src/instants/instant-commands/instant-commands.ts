import { Injectable, UseGuards, type OnApplicationShutdown } from "@nestjs/common";
import {
  ActionRowBuilder,
  ChannelType,
  MessageFlags,
  StringSelectMenuBuilder,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction
} from "discord.js";
import { randomUUID } from "node:crypto";
import {
  ComponentParam,
  Context,
  createCommandGroupDecorator,
  Options,
  SelectedStrings,
  StringOption,
  StringSelect,
  Subcommand,
  type SlashCommandContext,
  type StringSelectContext
} from "necord";
import { ApiError } from "../../common/api-error.js";
import { InstantAccessGuard } from "../instant-access/instant-access.guard.js";
import { InstantAccessService } from "../instant-access/instant-access.service.js";
import { InstantManagerGuard } from "../instant-manager/instant-manager.guard.js";
import type { InstantSearchResult } from "../instants.types.js";
import { MyinstantsService } from "../myinstants/myinstants.service.js";
import { VoiceQueueService } from "../voice-queue/voice-queue.service.js";

class PlayInstantOptions {
  @StringOption({
    name: "source",
    description: "A Myinstants instant page URL",
    required: true
  })
  public source!: string;
}

class SearchInstantOptions {
  @StringOption({
    name: "query",
    description: "Text to search for on Myinstants",
    required: true,
    min_length: 2,
    max_length: 80
  })
  public query!: string;
}

interface SearchSession {
  userId: string;
  guildId: string;
  expiresAt: number;
  results: InstantSearchResult[];
}

const InstantCommand = createCommandGroupDecorator({
  name: "instant",
  description: "Search and play Myinstants sounds in voice"
});

@InstantCommand()
@Injectable()
export class InstantCommands implements OnApplicationShutdown {
  private readonly searches = new Map<string, SearchSession>();

  public constructor(
    private readonly provider: MyinstantsService,
    private readonly voice: VoiceQueueService,
    private readonly access: InstantAccessService
  ) {}

  public onApplicationShutdown(): void {
    this.searches.clear();
  }

  @Subcommand({ name: "play", description: "Play or queue a pasted Myinstants link" })
  @UseGuards(InstantAccessGuard)
  public async play(
    @Context() [interaction]: SlashCommandContext,
    @Options() options: PlayInstantOptions
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const channel = this.memberVoiceChannel(interaction);
      const instant = await this.provider.resolve(options.source);
      const queued = await this.voice.enqueue({
        guildId: interaction.guildId!,
        voiceChannelId: channel.id,
        instant,
        requestedByDiscordUserId: interaction.user.id,
        requestedVia: "DISCORD"
      });
      await interaction.editReply(
        this.queuedMessage(instant.title, instant.pageUrl, channel.id, queued.position)
      );
    } catch (error) {
      await interaction.editReply(this.errorMessage(error));
    }
  }

  @Subcommand({ name: "search", description: "Search Myinstants and choose a sound" })
  @UseGuards(InstantAccessGuard)
  public async search(
    @Context() [interaction]: SlashCommandContext,
    @Options() options: SearchInstantOptions
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      this.memberVoiceChannel(interaction);
      const results = await this.provider.search(options.query, 25);
      if (results.length === 0) {
        await interaction.editReply("No matching Myinstants sounds were found.");
        return;
      }
      this.deleteExpiredSearches();
      const token = randomUUID();
      this.searches.set(token, {
        userId: interaction.user.id,
        guildId: interaction.guildId!,
        expiresAt: Date.now() + 5 * 60_000,
        results
      });
      const select = new StringSelectMenuBuilder()
        .setCustomId(`instant/search/${token}`)
        .setPlaceholder("Choose an instant to queue")
        .setMinValues(1)
        .setMaxValues(1)
        .setOptions(
          results.map((result) => ({
            label: result.title.slice(0, 100),
            value: result.id.slice(0, 100),
            description: "Play from Myinstants"
          }))
        );
      await interaction.editReply({
        content: `Found ${results.length} result${results.length === 1 ? "" : "s"}.`,
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)]
      });
    } catch (error) {
      await interaction.editReply(this.errorMessage(error));
    }
  }

  @Subcommand({ name: "queue", description: "Show the current instant playback queue" })
  @UseGuards(InstantAccessGuard)
  public async queue(@Context() [interaction]: SlashCommandContext): Promise<void> {
    const status = this.voice.status(interaction.guildId!);
    const lines = [
      status.current ? `▶️ **${status.current.title}**` : "Nothing is playing.",
      ...status.items.slice(0, 10).map((item) => `${item.position}. ${item.title}`)
    ];
    await interaction.reply({ content: lines.join("\n"), flags: MessageFlags.Ephemeral });
  }

  @Subcommand({ name: "stop", description: "Stop playback, clear the queue, and leave voice" })
  @UseGuards(InstantManagerGuard)
  public async stop(@Context() [interaction]: SlashCommandContext): Promise<void> {
    this.voice.stopGuild(interaction.guildId!);
    await interaction.reply({
      content: "Instant playback stopped and the queue was cleared.",
      flags: MessageFlags.Ephemeral
    });
  }

  @StringSelect("instant/search/:token")
  public async chooseSearchResult(
    @Context() [interaction]: StringSelectContext,
    @SelectedStrings() selected: string[],
    @ComponentParam("token") token: string
  ): Promise<void> {
    const session = this.searches.get(token);
    if (
      !session ||
      session.expiresAt <= Date.now() ||
      session.userId !== interaction.user.id ||
      session.guildId !== interaction.guildId
    ) {
      await interaction.update({ content: "This instant search has expired.", components: [] });
      return;
    }
    this.searches.delete(token);
    try {
      await this.access.requireCanPlay(interaction.user.id, interaction.guildId!);
      const channel = this.memberVoiceChannel(interaction);
      const result = session.results.find((candidate) => candidate.id === selected[0]);
      if (!result) throw new ApiError(404, "INSTANT_NOT_FOUND", "Instant was not found");
      const instant = await this.provider.resolve(result.pageUrl);
      const queued = await this.voice.enqueue({
        guildId: interaction.guildId!,
        voiceChannelId: channel.id,
        instant,
        requestedByDiscordUserId: interaction.user.id,
        requestedVia: "DISCORD"
      });
      await interaction.update({
        content: this.queuedMessage(instant.title, instant.pageUrl, channel.id, queued.position),
        components: []
      });
    } catch (error) {
      await interaction.update({ content: this.errorMessage(error), components: [] });
    }
  }

  private memberVoiceChannel(
    interaction: ChatInputCommandInteraction | StringSelectMenuInteraction
  ) {
    if (!interaction.inCachedGuild()) {
      throw new ApiError(400, "GUILD_REQUIRED", "Use this command inside a Discord server");
    }
    const channel = interaction.member.voice.channel;
    if (!channel || channel.type !== ChannelType.GuildVoice) {
      throw new ApiError(400, "VOICE_CHANNEL_REQUIRED", "Join a normal voice channel first");
    }
    return channel;
  }

  private queuedMessage(
    title: string,
    pageUrl: string,
    channelId: string,
    position: number
  ): string {
    return position === 0
      ? `Playing **${title}** in <#${channelId}>.\n[Open on Myinstants](${pageUrl})`
      : `Queued **${title}** at position ${position} in <#${channelId}>.\n[Open on Myinstants](${pageUrl})`;
  }

  private errorMessage(error: unknown): string {
    return error instanceof ApiError ? error.message : "Instant playback failed. Try again later.";
  }

  private deleteExpiredSearches(): void {
    const now = Date.now();
    for (const [token, session] of this.searches) {
      if (session.expiresAt <= now) this.searches.delete(token);
    }
  }
}
