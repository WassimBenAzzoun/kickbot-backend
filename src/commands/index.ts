import { Collection } from "discord.js";
import { configCommand } from "./config";
import { helpCommand } from "./help";
import { pingCommand } from "./ping";
import { streamerCommand } from "./streamer";
import { SlashCommand } from "./types";

export const commands: SlashCommand[] = [
  configCommand,
  streamerCommand,
  pingCommand,
  helpCommand
];

export const commandCollection = new Collection<string, SlashCommand>(
  commands.map((command) => [command.data.name, command])
);