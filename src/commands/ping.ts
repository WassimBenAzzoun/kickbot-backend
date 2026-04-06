import { SlashCommandBuilder } from "discord.js";
import { SlashCommand } from "./types";

export const pingCommand: SlashCommand = {
  data: new SlashCommandBuilder().setName("ping").setDescription("Health check for the bot"),
  async execute({ interaction }) {
    const latency = Date.now() - interaction.createdTimestamp;
    await interaction.reply({
      content: `Pong. Gateway latency: ${latency}ms`,
      ephemeral: true
    });
  }
};