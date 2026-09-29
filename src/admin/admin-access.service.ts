import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Environment } from "../config/environment.js";
import { PrismaService } from "../database/prisma.service.js";

@Injectable()
export class AdminAccessService {
  private readonly configuredAdmins: Set<string>;

  public constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Environment, true>
  ) {
    this.configuredAdmins = new Set(
      config
        .get("GLOBAL_ADMIN_DISCORD_IDS", { infer: true })
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    );
  }

  public async isAdmin(discordId: string): Promise<boolean> {
    return (
      this.configuredAdmins.has(discordId) ||
      Boolean(await this.prisma.globalAdmin.findUnique({ where: { discordId } }))
    );
  }

  public configuredAdminIds(): string[] {
    return [...this.configuredAdmins];
  }

  public isConfiguredAdmin(discordId: string): boolean {
    return this.configuredAdmins.has(discordId);
  }
}
