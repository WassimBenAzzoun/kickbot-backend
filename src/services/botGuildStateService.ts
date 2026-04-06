import { BotGuildState } from "@prisma/client";
import { BotGuildStateRepository, UpsertBotGuildStateInput } from "../repositories/botGuildStateRepository";

export interface BotGuildSnapshot {
  guildId: string;
  guildName: string;
  iconHash: string | null;
}

export class BotGuildStateService {
  public constructor(private readonly botGuildStateRepository: BotGuildStateRepository) {}

  public async listInGuild(): Promise<BotGuildState[]> {
    return this.botGuildStateRepository.listInGuild();
  }

  public async syncGuildSnapshots(guilds: BotGuildSnapshot[]): Promise<void> {
    const uniqueGuilds = this.deduplicateGuilds(guilds);

    for (const guild of uniqueGuilds) {
      await this.botGuildStateRepository.upsertAsPresent({
        guildId: guild.guildId,
        guildName: guild.guildName,
        iconHash: guild.iconHash
      });
    }

    await this.botGuildStateRepository.markMissingAsLeft(uniqueGuilds.map((guild) => guild.guildId));
  }

  public async markGuildJoined(guild: BotGuildSnapshot): Promise<void> {
    await this.botGuildStateRepository.upsertAsPresent({
      guildId: guild.guildId,
      guildName: guild.guildName,
      iconHash: guild.iconHash
    });
  }

  public async markGuildLeft(guildId: string): Promise<void> {
    await this.botGuildStateRepository.markAsLeft(guildId);
  }

  public async recordHeartbeat(guilds: UpsertBotGuildStateInput[]): Promise<void> {
    await this.syncGuildSnapshots(
      guilds.map((guild) => ({
        guildId: guild.guildId,
        guildName: guild.guildName,
        iconHash: guild.iconHash
      }))
    );
  }

  private deduplicateGuilds(guilds: BotGuildSnapshot[]): BotGuildSnapshot[] {
    const map = new Map<string, BotGuildSnapshot>();

    for (const guild of guilds) {
      map.set(guild.guildId, guild);
    }

    return Array.from(map.values());
  }
}
