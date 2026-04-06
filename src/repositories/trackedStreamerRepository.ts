import { PrismaClient, StreamPlatform, TrackedStreamer } from "@prisma/client";

export interface GuildStreamerCount {
  guildId: string;
  count: number;
}

export class TrackedStreamerRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public async createTrackedStreamer(input: {
    guildId: string;
    platform: StreamPlatform;
    streamerUsername: string;
  }): Promise<TrackedStreamer> {
    return this.prisma.trackedStreamer.create({
      data: {
        guildId: input.guildId,
        platform: input.platform,
        streamerUsername: input.streamerUsername
      }
    });
  }

  public async findByIdAndGuild(id: string, guildId: string): Promise<TrackedStreamer | null> {
    return this.prisma.trackedStreamer.findFirst({
      where: {
        id,
        guildId
      }
    });
  }

  public async findByGuildAndStreamer(
    guildId: string,
    platform: StreamPlatform,
    streamerUsername: string
  ): Promise<TrackedStreamer | null> {
    return this.prisma.trackedStreamer.findUnique({
      where: {
        guildId_platform_streamerUsername: {
          guildId,
          platform,
          streamerUsername
        }
      }
    });
  }

  public async removeByGuildAndStreamer(
    guildId: string,
    platform: StreamPlatform,
    streamerUsername: string
  ): Promise<boolean> {
    const deleted = await this.prisma.trackedStreamer.deleteMany({
      where: {
        guildId,
        platform,
        streamerUsername
      }
    });

    return deleted.count > 0;
  }

  public async removeByIdAndGuild(id: string, guildId: string): Promise<boolean> {
    const deleted = await this.prisma.trackedStreamer.deleteMany({
      where: {
        id,
        guildId
      }
    });

    return deleted.count > 0;
  }

  public async listByGuild(guildId: string): Promise<TrackedStreamer[]> {
    return this.prisma.trackedStreamer.findMany({
      where: { guildId },
      orderBy: [{ isActive: "desc" }, { streamerUsername: "asc" }]
    });
  }

  public async countByGuild(guildId: string): Promise<number> {
    return this.prisma.trackedStreamer.count({
      where: { guildId }
    });
  }

  public async countAll(): Promise<number> {
    return this.prisma.trackedStreamer.count();
  }

  public async countActiveLive(): Promise<number> {
    return this.prisma.trackedStreamer.count({
      where: {
        isActive: true,
        lastKnownLiveState: true
      }
    });
  }

  public async countByGuildIds(guildIds: string[]): Promise<GuildStreamerCount[]> {
    if (guildIds.length === 0) {
      return [];
    }

    const rows = await this.prisma.trackedStreamer.groupBy({
      by: ["guildId"],
      where: {
        guildId: {
          in: guildIds
        }
      },
      _count: {
        _all: true
      }
    });

    return rows.map((row) => ({
      guildId: row.guildId,
      count: row._count._all
    }));
  }

  public async listAllActive(): Promise<TrackedStreamer[]> {
    return this.prisma.trackedStreamer.findMany({
      where: {
        isActive: true
      },
      orderBy: [{ guildId: "asc" }, { streamerUsername: "asc" }]
    });
  }

  public async setActiveByGuildAndStreamer(
    guildId: string,
    platform: StreamPlatform,
    streamerUsername: string,
    isActive: boolean
  ): Promise<boolean> {
    const updated = await this.prisma.trackedStreamer.updateMany({
      where: {
        guildId,
        platform,
        streamerUsername
      },
      data: {
        isActive
      }
    });

    return updated.count > 0;
  }

  public async setActiveByIdAndGuild(id: string, guildId: string, isActive: boolean): Promise<boolean> {
    const updated = await this.prisma.trackedStreamer.updateMany({
      where: {
        id,
        guildId
      },
      data: {
        isActive
      }
    });

    return updated.count > 0;
  }

  public async markLiveTransition(trackedStreamerId: string): Promise<boolean> {
    const updated = await this.prisma.trackedStreamer.updateMany({
      where: {
        id: trackedStreamerId,
        lastKnownLiveState: false
      },
      data: {
        lastKnownLiveState: true,
        lastNotifiedLiveAt: new Date()
      }
    });

    return updated.count === 1;
  }

  public async markOfflineTransition(trackedStreamerId: string): Promise<boolean> {
    const updated = await this.prisma.trackedStreamer.updateMany({
      where: {
        id: trackedStreamerId,
        lastKnownLiveState: true
      },
      data: {
        lastKnownLiveState: false
      }
    });

    return updated.count === 1;
  }

  public async updateLiveState(trackedStreamerId: string, isLive: boolean): Promise<void> {
    await this.prisma.trackedStreamer.update({
      where: { id: trackedStreamerId },
      data: {
        lastKnownLiveState: isLive
      }
    });
  }
}
