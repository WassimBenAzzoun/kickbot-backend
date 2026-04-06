import { GatewayIntentBits, Client } from "discord.js";

export function createDiscordClient(): Client {
  return new Client({
    intents: [GatewayIntentBits.Guilds]
  });
}