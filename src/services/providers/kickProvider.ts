import axios, { AxiosError, AxiosInstance } from "axios";
import { StreamPlatform } from "@prisma/client";
import { Logger } from "pino";
import { z } from "zod";
import { env } from "../../config/env";
import { NormalizedStreamStatus } from "../../types/stream";
import { sleep } from "../../utils/async";
import { KickAuthService } from "./kickAuthService";
import { StreamPlatformProvider } from "./streamPlatformProvider";

const kickCategorySchema = z
  .object({
    name: z.string().optional().nullable()
  })
  .passthrough();

const kickStreamSchema = z
  .object({
    is_live: z.boolean().optional(),
    start_time: z.string().optional().nullable(),
    thumbnail: z.string().optional().nullable(),
    viewer_count: z.number().optional().nullable()
  })
  .passthrough();

const kickChannelSchema = z
  .object({
    slug: z.string(),
    stream_title: z.string().optional().nullable(),
    category: kickCategorySchema.optional().nullable(),
    stream: kickStreamSchema.optional().nullable(),
    profile_picture: z.string().optional().nullable()
  })
  .passthrough();

const kickChannelsResponseSchema = z
  .object({
    data: z.array(kickChannelSchema).optional(),
    message: z.string().optional()
  })
  .passthrough();

type JsonObject = Record<string, unknown>;
type KickChannel = z.infer<typeof kickChannelSchema>;

export class KickProvider implements StreamPlatformProvider {
  public readonly platform = StreamPlatform.KICK;
  private readonly httpClient: AxiosInstance;
  private readonly authService: KickAuthService;

  public constructor(private readonly logger: Logger) {
    this.httpClient = axios.create({
      baseURL: env.KICK_API_BASE_URL,
      timeout: env.KICK_REQUEST_TIMEOUT_MS,
      headers: {
        "User-Agent": "KickDiscordNotifierBot/1.0"
      }
    });

    this.authService = new KickAuthService(this.logger.child({ scope: "kick-auth" }));
  }

  public async getStreamStatus(streamerUsername: string): Promise<NormalizedStreamStatus> {
    const normalizedStreamerUsername = streamerUsername.trim().toLowerCase();
    const channel = await this.fetchChannelBySlug(normalizedStreamerUsername);

    if (!channel) {
      return this.createOfflineStatus(normalizedStreamerUsername);
    }

    return this.normalizeChannel(normalizedStreamerUsername, channel);
  }

  private async fetchChannelBySlug(streamerUsername: string): Promise<KickChannel | null> {
    const maxAttempts = env.KICK_MAX_RETRIES + 1;
    let forceTokenRefresh = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const accessToken = await this.authService.getAccessToken(forceTokenRefresh);
        forceTokenRefresh = false;

        const response = await this.httpClient.get("/public/v1/channels", {
          params: {
            slug: streamerUsername
          },
          headers: {
            Authorization: `Bearer ${accessToken}`
          },
          validateStatus: () => true
        });

        if (response.status >= 200 && response.status < 300) {
          const parsed = kickChannelsResponseSchema.safeParse(response.data);
          if (!parsed.success) {
            throw new Error("Kick channels response shape was invalid");
          }

          const channels = parsed.data.data ?? [];
          return this.pickChannelBySlug(channels, streamerUsername);
        }

        if (response.status === 401) {
          this.authService.invalidateCachedToken();

          if (attempt === maxAttempts) {
            throw new Error("Kick API authentication failed (401)");
          }

          forceTokenRefresh = true;
          this.logger.warn(
            {
              streamerUsername,
              attempt,
              maxAttempts
            },
            "Kick API returned 401; invalidated cached token and retrying"
          );
          continue;
        }

        if (response.status === 404) {
          return null;
        }

        const shouldRetry = response.status === 429 || response.status >= 500;
        if (!shouldRetry || attempt === maxAttempts) {
          throw new Error(`Kick channels request failed with status ${response.status}`);
        }

        const delayMs = this.computeRetryDelayMs(
          attempt,
          response.status,
          response.headers["retry-after"]
        );

        this.logger.warn(
          {
            streamerUsername,
            attempt,
            maxAttempts,
            status: response.status,
            delayMs
          },
          "Kick channels request will retry"
        );

        await sleep(delayMs);
      } catch (error) {
        const axiosError = error as AxiosError;
        const status = axiosError.response?.status ?? null;

        const shouldRetry =
          axios.isAxiosError(error) &&
          (!status || status === 429 || status >= 500 || axiosError.code === "ECONNABORTED");

        if (!shouldRetry || attempt === maxAttempts) {
          throw error;
        }

        const delayMs = this.computeRetryDelayMs(
          attempt,
          status,
          axiosError.response?.headers?.["retry-after"]
        );

        this.logger.warn(
          {
            streamerUsername,
            attempt,
            maxAttempts,
            status,
            delayMs
          },
          "Kick channels request retrying after transport/server failure"
        );

        await sleep(delayMs);
      }
    }

    return null;
  }

  private pickChannelBySlug(channels: KickChannel[], streamerUsername: string): KickChannel | null {
    if (channels.length === 0) {
      return null;
    }

    const exactMatch = channels.find(
      (channel) => channel.slug.trim().toLowerCase() === streamerUsername
    );

    return exactMatch ?? channels[0] ?? null;
  }

  private normalizeChannel(
    streamerUsername: string,
    channel: KickChannel
  ): NormalizedStreamStatus {
    const stream = channel.stream ?? null;
    const slug = this.pickString(channel.slug, streamerUsername) ?? streamerUsername;

    return {
      platform: StreamPlatform.KICK,
      streamerUsername,
      isLive: stream?.is_live === true,
      streamUrl: `https://kick.com/${encodeURIComponent(slug)}`,
      title: this.pickString(channel.stream_title),
      category: this.pickString(channel.category?.name),
      thumbnailUrl: this.pickString(stream?.thumbnail),
      profileImageUrl: this.extractProfileImage(channel),
      viewerCount: this.pickNumber(stream?.viewer_count),
      startedAt: this.parseDate(this.pickString(stream?.start_time))
    };
  }

  private extractProfileImage(channel: KickChannel): string | null {
    const channelObject = this.asObject(channel);
    const userObject = this.asObject(channelObject?.user);
    const broadcasterObject = this.asObject(channelObject?.broadcaster);

    return this.pickString(
      channel.profile_picture,
      userObject?.profile_picture,
      userObject?.avatar,
      broadcasterObject?.profile_picture,
      broadcasterObject?.avatar
    );
  }

  private createOfflineStatus(streamerUsername: string): NormalizedStreamStatus {
    return {
      platform: StreamPlatform.KICK,
      streamerUsername,
      isLive: false,
      streamUrl: `https://kick.com/${encodeURIComponent(streamerUsername)}`,
      title: null,
      category: null,
      thumbnailUrl: null,
      profileImageUrl: null,
      viewerCount: null,
      startedAt: null
    };
  }

  private asObject(value: unknown): JsonObject | null {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as JsonObject;
    }

    return null;
  }

  private pickString(...values: unknown[]): string | null {
    for (const value of values) {
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed.length > 0) {
          return trimmed;
        }
      }
    }

    return null;
  }

  private pickNumber(...values: unknown[]): number | null {
    for (const value of values) {
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        return Math.floor(value);
      }

      if (typeof value === "string") {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isNaN(parsed) && parsed >= 0) {
          return parsed;
        }
      }
    }

    return null;
  }

  private parseDate(value: string | null): Date | null {
    if (!value) {
      return null;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    return date;
  }

  private computeRetryDelayMs(
    attempt: number,
    status: number | null,
    retryAfterHeader: string | number | string[] | undefined
  ): number {
    const retryAfterMs = this.parseRetryAfterToMs(retryAfterHeader);
    if (status === 429 && retryAfterMs !== null) {
      return retryAfterMs;
    }

    const exponentialDelay = env.KICK_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
    return Math.min(exponentialDelay, 15_000);
  }

  private parseRetryAfterToMs(
    retryAfterHeader: string | number | string[] | undefined
  ): number | null {
    const retryAfterValue =
      typeof retryAfterHeader === "string"
        ? retryAfterHeader
        : typeof retryAfterHeader === "number"
          ? String(retryAfterHeader)
          : Array.isArray(retryAfterHeader)
            ? retryAfterHeader[0]
            : null;

    if (!retryAfterValue) {
      return null;
    }

    const seconds = Number.parseInt(retryAfterValue, 10);
    if (!Number.isNaN(seconds) && seconds > 0) {
      return seconds * 1000;
    }

    const retryAt = new Date(retryAfterValue).getTime();
    if (Number.isNaN(retryAt)) {
      return null;
    }

    return Math.max(retryAt - Date.now(), 0);
  }
}
