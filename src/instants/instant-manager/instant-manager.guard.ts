import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { MessageFlags, PermissionFlagsBits } from "discord.js";
import { NecordExecutionContext, type SlashCommandContext } from "necord";
import { AdminAccessService } from "../../admin/admin-access.service.js";

@Injectable()
export class InstantManagerGuard implements CanActivate {
  public constructor(private readonly admins: AdminAccessService) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const [interaction] = NecordExecutionContext.create(context).getContext<SlashCommandContext>();
    const allowed =
      interaction.inCachedGuild() &&
      (interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild) ||
        (await this.admins.isAdmin(interaction.user.id)));
    if (!allowed) {
      await interaction.reply({
        content: "Manage Server permission or global administrator access is required.",
        flags: MessageFlags.Ephemeral
      });
    }
    return allowed;
  }
}
