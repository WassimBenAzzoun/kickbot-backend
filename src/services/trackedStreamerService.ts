import { Prisma, StreamPlatform, TrackedStreamer } from "@prisma/client";
import { TrackedStreamerRepository } from "../repositories/trackedStreamerRepository";

export type AddStreamerResult =
  | { type: "created"; streamer: TrackedStreamer }
  | { type: "already_exists"; streamer: TrackedStreamer };

export class TrackedStreamerService {
  public constructor(private readonly trackedStreamerRepository: TrackedStreamerRepository) {}

  public async addKickStreamer(guildId: string, streamerUsername: string): Promise<AddStreamerResult> {
    const existing = await this.trackedStreamerRepository.findByGuildAndStreamer(
      guildId,
      StreamPlatform.KICK,
      streamerUsername
    );

    if (existing) {
      return {
        type: "already_exists",
        streamer: existing
      };
    }

    try {
      const streamer = await this.trackedStreamerRepository.createTrackedStreamer({
        guildId,
        platform: StreamPlatform.KICK,
        streamerUsername
      });

      return {
        type: "created",
        streamer
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const duplicate = await this.trackedStreamerRepository.findByGuildAndStreamer(
          guildId,
          StreamPlatform.KICK,
          streamerUsername
        );

        if (duplicate) {
          return {
            type: "already_exists",
            streamer: duplicate
          };
        }
      }

      throw error;
    }
  }

  public async removeKickStreamer(guildId: string, streamerUsername: string): Promise<boolean> {
    return this.trackedStreamerRepository.removeByGuildAndStreamer(
      guildId,
      StreamPlatform.KICK,
      streamerUsername
    );
  }

  public async removeStreamerById(guildId: string, streamerId: string): Promise<boolean> {
    return this.trackedStreamerRepository.removeByIdAndGuild(streamerId, guildId);
  }

  public async setKickStreamerEnabled(
    guildId: string,
    streamerUsername: string,
    isEnabled: boolean
  ): Promise<boolean> {
    return this.trackedStreamerRepository.setActiveByGuildAndStreamer(
      guildId,
      StreamPlatform.KICK,
      streamerUsername,
      isEnabled
    );
  }

  public async setStreamerEnabledById(
    guildId: string,
    streamerId: string,
    isEnabled: boolean
  ): Promise<boolean> {
    return this.trackedStreamerRepository.setActiveByIdAndGuild(streamerId, guildId, isEnabled);
  }

  public async getStreamerById(guildId: string, streamerId: string): Promise<TrackedStreamer | null> {
    return this.trackedStreamerRepository.findByIdAndGuild(streamerId, guildId);
  }

  public async listGuildStreamers(guildId: string): Promise<TrackedStreamer[]> {
    return this.trackedStreamerRepository.listByGuild(guildId);
  }

  public async countGuildStreamers(guildId: string): Promise<number> {
    return this.trackedStreamerRepository.countByGuild(guildId);
  }
}