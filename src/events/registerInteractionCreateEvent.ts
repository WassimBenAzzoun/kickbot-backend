import {
  ChatInputCommandInteraction,
  Client,
  Collection,
  Events,
  PermissionFlagsBits
} from "discord.js";
import { Logger } from "pino";
import { SlashCommand, CommandServices } from "../commands/types";

function hasAdministratorPermission(interaction: ChatInputCommandInteraction): boolean {
  return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.Administrator));
}

export function registerInteractionCreateEvent(
  client: Client,
  commands: Collection<string, SlashCommand>,
  services: CommandServices,
  logger: Logger
): void {
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    if (!interaction.inGuild()) {
      await interaction.reply({
        content: "Commands are only supported in Discord servers, not DMs.",
        ephemeral: true
      });
      return;
    }

    const command = commands.get(interaction.commandName);
    if (!command) {
      logger.warn({ commandName: interaction.commandName }, "Unknown slash command received");
      await interaction.reply({
        content: "This command is not available.",
        ephemeral: true
      });
      return;
    }

    if (command.adminOnly && !hasAdministratorPermission(interaction)) {
      await interaction.reply({
        content: "This command is restricted to server administrators.",
        ephemeral: true
      });
      return;
    }

    try {
      await command.execute({
        interaction,
        services,
        logger
      });
    } catch (error) {
      logger.error(
        {
          err: error,
          commandName: interaction.commandName,
          guildId: interaction.guildId,
          userId: interaction.user.id
        },
        "Command execution failed"
      );

      const response = {
        content: "Something went wrong while running this command. Please try again.",
        ephemeral: true
      };

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(response);
      } else {
        await interaction.reply(response);
      }
    }
  });
}