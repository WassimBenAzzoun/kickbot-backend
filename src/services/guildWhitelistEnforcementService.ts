import { Client, Guild, PermissionFlagsBits } from "discord.js";
import { Logger } from "pino";
import { BotGuildStateService } from "./botGuildStateService";
import { GuildWhitelistSettingsService } from "./guildWhitelistSettingsService";
import { WhitelistedGuildService } from "./whitelistedGuildService";

type EnforcementReason = "guild_join" | "startup_reconciliation";
type EnforcementResult = "disabled" | "allowed" | "left" | "leave_failed";

export class GuildWhitelistEnforcementService {
  private reconciliationPromise: Promise<{ checked: number; left: number }> | null = null;

  public constructor(
    private readonly guildWhitelistSettingsService: GuildWhitelistSettingsService,
    private readonly whitelistedGuildService: WhitelistedGuildService,
    private readonly botGuildStateService: BotGuildStateService,
    private readonly logger: Logger
  ) {}

  public async handleGuildJoin(guild: Guild): Promise<EnforcementResult> {
    this.logger.info(
      {
        guildId: guild.id,
        guildName: guild.name
      },
      "Bot joined guild"
    );

    return this.enforceGuild(guild, "guild_join");
  }

  public async reconcileCurrentGuilds(
    client: Client
  ): Promise<{ checked: number; left: number }> {
    if (this.reconciliationPromise) {
      this.logger.info("Guild whitelist reconciliation is already in progress");
      return this.reconciliationPromise;
    }

    this.reconciliationPromise = this.runReconciliation(client);

    try {
      return await this.reconciliationPromise;
    } finally {
      this.reconciliationPromise = null;
    }
  }

  private async runReconciliation(client: Client): Promise<{ checked: number; left: number }> {
    const enforcementEnabled = await this.guildWhitelistSettingsService.isWhitelistEnforced();

    if (!enforcementEnabled) {
      this.logger.info("Guild whitelist enforcement is disabled; skipping startup reconciliation");
      return {
        checked: 0,
        left: 0
      };
    }

    let checked = 0;
    let left = 0;

    for (const guild of client.guilds.cache.values()) {
      checked += 1;

      const result = await this.enforceGuild(guild, "startup_reconciliation");
      if (result === "left") {
        left += 1;
      }
    }

    this.logger.info(
      {
        checkedGuildCount: checked,
        removedGuildCount: left
      },
      "Completed guild whitelist reconciliation"
    );

    return { checked, left };
  }

  private async enforceGuild(guild: Guild, reason: EnforcementReason): Promise<EnforcementResult> {
    const enforcementEnabled = await this.guildWhitelistSettingsService.isWhitelistEnforced();

    if (!enforcementEnabled) {
      this.logger.info(
        {
          guildId: guild.id,
          guildName: guild.name,
          reason
        },
        "Guild whitelist enforcement is disabled"
      );

      return "disabled";
    }

    const whitelisted = await this.whitelistedGuildService.isGuildWhitelisted(guild.id);

    this.logger.info(
      {
        guildId: guild.id,
        guildName: guild.name,
        reason,
        whitelisted
      },
      "Evaluated guild against whitelist"
    );

    if (whitelisted) {
      return "allowed";
    }

    await this.tryNotifyGuildBeforeLeave(guild);

    try {
      await guild.leave();
      await this.botGuildStateService.markGuildLeft(guild.id);

      this.logger.warn(
        {
          guildId: guild.id,
          guildName: guild.name,
          reason
        },
        "Left non-whitelisted guild"
      );

      return "left";
    } catch (error) {
      this.logger.error(
        {
          err: error,
          guildId: guild.id,
          guildName: guild.name,
          reason
        },
        "Failed to leave non-whitelisted guild"
      );

      return "leave_failed";
    }
  }

  private async tryNotifyGuildBeforeLeave(guild: Guild): Promise<void> {
    const channel = guild.systemChannel;
    const me = guild.members.me;

    if (!channel || !channel.isTextBased() || !me) {
      return;
    }

    const permissions = channel.permissionsFor(me);
    if (
      !permissions?.has(PermissionFlagsBits.ViewChannel) ||
      !permissions.has(PermissionFlagsBits.SendMessages)
    ) {
      return;
    }

    try {
      await channel.send(
        "KickBot is not authorized for this server and will now leave. Contact the bot owner if this was unexpected."
      );
    } catch (error) {
      this.logger.warn(
        {
          err: error,
          guildId: guild.id,
          guildName: guild.name
        },
        "Failed to send whitelist enforcement message before leaving guild"
      );
    }
  }
}
