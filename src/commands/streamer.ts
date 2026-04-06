import { SlashCommandBuilder } from "discord.js";
import { SlashCommand } from "./types";
import { kickUsernameSchema } from "../utils/validation";

function parseUsername(raw: string): { ok: true; value: string } | { ok: false; message: string } {
  const parsed = kickUsernameSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid username"
    };
  }

  return {
    ok: true,
    value: parsed.data
  };
}

export const streamerCommand: SlashCommand = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName("streamer")
    .setDescription("Manage tracked Kick streamers")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add")
        .setDescription("Add a Kick streamer to tracking")
        .addStringOption((option) =>
          option
            .setName("kick_username")
            .setDescription("Kick username")
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("remove")
        .setDescription("Remove a tracked Kick streamer")
        .addStringOption((option) =>
          option
            .setName("kick_username")
            .setDescription("Kick username")
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("enable")
        .setDescription("Enable tracking for a Kick streamer")
        .addStringOption((option) =>
          option
            .setName("kick_username")
            .setDescription("Kick username")
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("disable")
        .setDescription("Disable tracking for a Kick streamer")
        .addStringOption((option) =>
          option
            .setName("kick_username")
            .setDescription("Kick username")
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("list").setDescription("List all tracked Kick streamers")
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

    if (subcommand === "list") {
      const streamers = await services.trackedStreamerService.listGuildStreamers(guildId);
      if (streamers.length === 0) {
        await interaction.reply({
          content: "No Kick streamers are tracked yet. Use /streamer add <kick_username>.",
          ephemeral: true
        });
        return;
      }

      const lines = streamers.map((streamer, index) => {
        const state = streamer.isActive ? "enabled" : "disabled";
        return `${index + 1}. ${streamer.streamerUsername} (${state})`;
      });

      await interaction.reply({
        content: [`Tracked Kick streamers (${streamers.length}):`, ...lines].join("\n"),
        ephemeral: true
      });
      return;
    }

    const rawUsername = interaction.options.getString("kick_username", true);
    const parsedUsername = parseUsername(rawUsername);

    if (!parsedUsername.ok) {
      await interaction.reply({
        content: `Invalid Kick username: ${parsedUsername.message}`,
        ephemeral: true
      });
      return;
    }

    const username = parsedUsername.value;

    if (subcommand === "add") {
      const result = await services.trackedStreamerService.addKickStreamer(guildId, username);
      if (result.type === "already_exists") {
        await interaction.reply({
          content: `${username} is already tracked in this server.`,
          ephemeral: true
        });
        return;
      }

      await interaction.reply({
        content: `Now tracking Kick streamer ${username}.`,
        ephemeral: true
      });
      return;
    }

    if (subcommand === "remove") {
      const removed = await services.trackedStreamerService.removeKickStreamer(guildId, username);
      await interaction.reply({
        content: removed
          ? `Stopped tracking ${username}.`
          : `${username} was not tracked in this server.`,
        ephemeral: true
      });
      return;
    }

    if (subcommand === "enable") {
      const enabled = await services.trackedStreamerService.setKickStreamerEnabled(guildId, username, true);
      await interaction.reply({
        content: enabled
          ? `Enabled tracking for ${username}.`
          : `${username} was not found in this server's tracked list.`,
        ephemeral: true
      });
      return;
    }

    const disabled = await services.trackedStreamerService.setKickStreamerEnabled(guildId, username, false);
    await interaction.reply({
      content: disabled
        ? `Disabled tracking for ${username}.`
        : `${username} was not found in this server's tracked list.`,
      ephemeral: true
    });
  }
};