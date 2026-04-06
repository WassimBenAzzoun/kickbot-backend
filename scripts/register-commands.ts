import { REST, Routes } from "discord.js";
import { commands } from "../src/commands";
import { env } from "../src/config/env";
import { requireEnvValue } from "../src/config/required";

async function registerCommands(): Promise<void> {
  const discordToken = requireEnvValue(env.DISCORD_TOKEN, "DISCORD_TOKEN");
  const rest = new REST({ version: "10" }).setToken(discordToken);
  const body = commands.map((command) => command.data.toJSON());

  const route = env.DISCORD_COMMAND_GUILD_ID
    ? Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_COMMAND_GUILD_ID)
    : Routes.applicationCommands(env.DISCORD_CLIENT_ID);

  await rest.put(route, { body });

  if (env.DISCORD_COMMAND_GUILD_ID) {
    // eslint-disable-next-line no-console
    console.log(
      `Registered ${body.length} slash commands for guild ${env.DISCORD_COMMAND_GUILD_ID}.`
    );
    return;
  }

  // eslint-disable-next-line no-console
  console.log(`Registered ${body.length} global slash commands.`);
}

void registerCommands().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to register slash commands", error);
  process.exit(1);
});