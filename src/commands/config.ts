import { ChannelType, SlashCommandBuilder } from "discord.js";
import { z } from "zod";
import { SlashCommand } from "./types";

const channelInputSchema = z.object({
  channelId: z.string().min(1)
});

export const configCommand: SlashCommand = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName("config")
    .setDescription("Manage guild Kick alert configuration")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("channel")
        .setDescription("Set the Discord channel where alerts are sent")
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Text channel for live alerts")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("view")
        .setDescription("View current guild alert configuration")
    ),
  async execute({ interaction, services }) {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({
        content: "This command can only be used inside a server.",
        ephemeral: true
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand(true);

    if (subcommand === "channel") {
      const channel = interaction.options.getChannel("channel", true);
      const parsed = channelInputSchema.safeParse({
        channelId: channel.id
      });

      if (!parsed.success) {
        await interaction.reply({
          content: "Invalid channel input. Please choose a valid text channel.",
          ephemeral: true
        });
        return;
      }

      await services.guildConfigService.setAlertChannel(guildId, parsed.data.channelId);
      await interaction.reply({
        content: `Kick live alerts will be sent to <#${parsed.data.channelId}>.`,
        ephemeral: true
      });
      return;
    }

    const config = await services.guildConfigService.getGuildConfig(guildId);
    const streamerCount = await services.trackedStreamerService.countGuildStreamers(guildId);

    const lines = [
      "Current configuration:",
      `- Alert channel: ${config?.alertChannelId ? `<#${config.alertChannelId}>` : "Not configured"}`,
      `- Tracked streamers: ${streamerCount}`
    ];

    await interaction.reply({
      content: lines.join("\n"),
      ephemeral: true
    });
  }
};