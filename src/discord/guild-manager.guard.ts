import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { MessageFlags, PermissionFlagsBits } from "discord.js";
import { NecordExecutionContext, type SlashCommandContext } from "necord";
import { PrismaService } from "../database/prisma.service.js";

@Injectable()
export class GuildManagerGuard implements CanActivate {
  public constructor(private readonly prisma: PrismaService) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const [interaction] = NecordExecutionContext.create(context).getContext<SlashCommandContext>();
    if (
      !interaction.inCachedGuild() ||
      !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
    ) {
      await interaction.reply({
        content: "Manage Server permission is required.",
        flags: MessageFlags.Ephemeral
      });
      return false;
    }
    const settings = await this.prisma.botSettings.findUnique({ where: { id: "default" } });
    if (settings?.allowlistEnforced) {
      const guild = await this.prisma.discordGuild.findUnique({
        where: { id: interaction.guildId }
      });
      if (!guild?.isAllowed) {
        await interaction.reply({
          content: "This server is not allowlisted.",
          flags: MessageFlags.Ephemeral
        });
        return false;
      }
    }
    return true;
  }
}
