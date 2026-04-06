import { env } from "../config/env";
import { GlobalAdminRepository } from "../repositories/globalAdminRepository";

function parseConfiguredAdminIds(raw: string): Set<string> {
  return new Set(
    raw
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
  );
}

export interface GlobalAdminEntry {
  discordId: string;
  source: "env" | "database";
  createdAt: Date | null;
}

export class GlobalAdminService {
  private readonly configuredAdminIds: Set<string>;

  public constructor(private readonly globalAdminRepository: GlobalAdminRepository) {
    this.configuredAdminIds = parseConfiguredAdminIds(env.GLOBAL_ADMIN_DISCORD_IDS);
  }

  public async isGlobalAdmin(discordUserId: string): Promise<boolean> {
    if (this.configuredAdminIds.has(discordUserId)) {
      return true;
    }

    const admin = await this.globalAdminRepository.findByDiscordId(discordUserId);
    return admin !== null;
  }

  public async listGlobalAdmins(): Promise<GlobalAdminEntry[]> {
    const databaseAdmins = await this.globalAdminRepository.listAll();
    const items = new Map<string, GlobalAdminEntry>();

    for (const discordId of this.configuredAdminIds) {
      items.set(discordId, {
        discordId,
        source: "env",
        createdAt: null
      });
    }

    for (const admin of databaseAdmins) {
      items.set(admin.discordId, {
        discordId: admin.discordId,
        source: this.configuredAdminIds.has(admin.discordId) ? "env" : "database",
        createdAt: admin.createdAt
      });
    }

    return Array.from(items.values()).sort((a, b) => a.discordId.localeCompare(b.discordId));
  }

  public async addGlobalAdmin(discordId: string): Promise<GlobalAdminEntry> {
    const trimmed = discordId.trim();

    if (!trimmed) {
      throw new Error("discordId cannot be empty");
    }

    const created = await this.globalAdminRepository.upsert(trimmed);

    return {
      discordId: created.discordId,
      source: this.configuredAdminIds.has(created.discordId) ? "env" : "database",
      createdAt: created.createdAt
    };
  }

  public async removeGlobalAdmin(discordId: string): Promise<"removed" | "env_managed" | "not_found"> {
    const trimmed = discordId.trim();

    if (!trimmed) {
      return "not_found";
    }

    if (this.configuredAdminIds.has(trimmed)) {
      return "env_managed";
    }

    const removed = await this.globalAdminRepository.removeByDiscordId(trimmed);
    return removed ? "removed" : "not_found";
  }
}
