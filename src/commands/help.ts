import { SlashCommandBuilder } from "discord.js";
import { SlashCommand } from "./types";

export const helpCommand: SlashCommand = {
  data: new SlashCommandBuilder().setName("help").setDescription("Show available commands"),
  async execute({ interaction }) {
    const message = [
      "Available commands:",
      "- /config channel <channel> -> set alert channel (admin)",
      "- /config view -> show server notification config (admin)",
      "- /streamer add <kick_username> -> track a Kick streamer (admin)",
      "- /streamer remove <kick_username> -> remove tracked streamer (admin)",
      "- /streamer enable <kick_username> -> enable tracking (admin)",
      "- /streamer disable <kick_username> -> disable tracking (admin)",
      "- /streamer list -> list tracked streamers (admin)",
      "- /ping -> bot health check",
      "- /help -> show this help"
    ].join("\n");

    await interaction.reply({
      content: message,
      ephemeral: true
    });
  }
};