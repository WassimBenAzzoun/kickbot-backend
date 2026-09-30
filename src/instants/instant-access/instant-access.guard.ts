import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { MessageFlags } from "discord.js";
import { NecordExecutionContext, type SlashCommandContext } from "necord";
import { InstantAccessService } from "./instant-access.service.js";

@Injectable()
export class InstantAccessGuard implements CanActivate {
  public constructor(private readonly access: InstantAccessService) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const [interaction] = NecordExecutionContext.create(context).getContext<SlashCommandContext>();
    if (!interaction.inCachedGuild()) {
      await interaction.reply({
        content: "Instant commands can only be used inside a Discord server.",
        flags: MessageFlags.Ephemeral
      });
      return false;
    }
    if (!(await this.access.canPlay(interaction.user.id, interaction.guildId))) {
      const settings = await this.access.settings();
      await interaction.reply({
        content: settings.instantsEnabled
          ? "You are not allowed to use instant playback."
          : "Instant playback is currently disabled.",
        flags: MessageFlags.Ephemeral
      });
      return false;
    }
    return true;
  }
}
