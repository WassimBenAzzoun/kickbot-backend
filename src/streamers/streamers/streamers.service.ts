import { Injectable } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client.js";
import { StreamPlatform } from "../../generated/prisma/enums.js";
import { ApiError } from "../../common/api-error.js";
import { PrismaService } from "../../database/prisma.service.js";

@Injectable()
export class StreamersService {
  public constructor(private readonly prisma: PrismaService) {}

  public list(guildId: string) {
    return this.prisma.trackedStreamer.findMany({
      where: { guildId },
      orderBy: [{ enabled: "desc" }, { normalizedUsername: "asc" }]
    });
  }

  public async add(guildId: string, username: string) {
    const normalizedUsername = normalizeUsername(username);
    try {
      return await this.prisma.trackedStreamer.create({
        data: {
          guildId,
          username: username.trim(),
          normalizedUsername,
          platform: StreamPlatform.KICK
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ApiError(409, "STREAMER_EXISTS", "This Kick streamer is already tracked");
      }
      throw error;
    }
  }

  public async update(guildId: string, id: string, enabled: boolean) {
    const result = await this.prisma.trackedStreamer.updateMany({
      where: { id, guildId },
      data: { enabled }
    });
    if (result.count === 0) throw new ApiError(404, "STREAMER_NOT_FOUND", "Streamer not found");
    return this.prisma.trackedStreamer.findUniqueOrThrow({ where: { id } });
  }

  public async remove(guildId: string, id: string): Promise<void> {
    const result = await this.prisma.trackedStreamer.deleteMany({ where: { id, guildId } });
    if (result.count === 0) throw new ApiError(404, "STREAMER_NOT_FOUND", "Streamer not found");
  }

  public findByUsername(guildId: string, username: string) {
    return this.prisma.trackedStreamer.findUnique({
      where: {
        guildId_platform_normalizedUsername: {
          guildId,
          platform: StreamPlatform.KICK,
          normalizedUsername: normalizeUsername(username)
        }
      }
    });
  }
}

export function normalizeUsername(username: string): string {
  return username.trim().replace(/^@/, "").toLowerCase();
}
