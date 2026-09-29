import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ModuleRef } from "@nestjs/core";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  ApiErrors,
  ApiSchemaResponse,
  livenessResponseSchema,
  readinessResponseSchema
} from "../../common/api-documentation.js";
import type { Environment } from "../../config/environment.js";
import { PrismaService } from "../../database/prisma.service.js";
import { DiscordService } from "../../discord/discord/discord.service.js";
import { SchedulingService } from "../../scheduling/scheduling/scheduling.service.js";

@Controller("health")
@ApiTags("Health")
export class HealthController {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly moduleRef: ModuleRef,
    private readonly config: ConfigService<Environment, true>
  ) {}

  @Get("live")
  @ApiOperation({ summary: "Check whether the backend process is alive" })
  @ApiSchemaResponse(livenessResponseSchema)
  public live(): { status: "ok"; timestamp: string } {
    return { status: "ok", timestamp: new Date().toISOString() };
  }

  @Get("ready")
  @ApiOperation({ summary: "Check database, Discord, and scheduler readiness" })
  @ApiSchemaResponse(readinessResponseSchema)
  @ApiErrors(503)
  public async ready(): Promise<{ status: "ok"; checks: Record<string, "up" | "disabled"> }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const discordEnabled = this.config.get("DISCORD_ENABLED", { infer: true });
      const discord = discordEnabled
        ? this.moduleRef.get(DiscordService, { strict: false })
        : undefined;
      const scheduler = discordEnabled
        ? this.moduleRef.get(SchedulingService, { strict: false })
        : undefined;
      if (discordEnabled && (!discord?.isReady() || !scheduler?.isReady()))
        throw new Error("Discord runtime is not ready");
      return {
        status: "ok",
        checks: {
          database: "up",
          discord: discordEnabled ? "up" : "disabled",
          scheduler: discordEnabled ? "up" : "disabled"
        }
      };
    } catch (error) {
      throw new ServiceUnavailableException({
        code: "NOT_READY",
        message: "Service is not ready",
        cause: String(error)
      });
    }
  }
}
