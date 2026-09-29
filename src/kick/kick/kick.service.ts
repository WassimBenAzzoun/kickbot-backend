import { HttpService } from "@nestjs/axios";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";
import type { Environment } from "../../config/environment.js";

const tokenSchema = z.object({ access_token: z.string(), expires_in: z.number().optional() });
const channelSchema = z.object({
  slug: z.string(),
  stream_title: z.string().nullable().optional(),
  category: z.object({ name: z.string().nullable().optional() }).nullable().optional(),
  stream: z
    .object({
      is_live: z.boolean().optional(),
      thumbnail: z.string().nullable().optional(),
      viewer_count: z.number().nullable().optional(),
      start_time: z.string().nullable().optional()
    })
    .nullable()
    .optional(),
  profile_picture: z.string().nullable().optional()
});
const channelsResponseSchema = z.object({ data: z.array(channelSchema) });

export interface StreamStatus {
  username: string;
  normalizedUsername: string;
  isLive: boolean;
  streamUrl: string;
  title: string | null;
  category: string | null;
  thumbnailUrl: string | null;
  profileImageUrl: string | null;
  viewerCount: number | null;
  startedAt: Date | null;
}

@Injectable()
export class KickService {
  private readonly logger = new Logger(KickService.name);
  private token: { value: string; expiresAt: number } | null = null;

  public constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService<Environment, true>
  ) {}

  public async getStatus(username: string): Promise<StreamStatus> {
    return this.withRetry(async () => {
      const response = await this.http.axiosRef.get(
        `${this.config.get("KICK_API_BASE_URL", { infer: true })}/public/v1/channels`,
        {
          params: { slug: username },
          timeout: this.config.get("KICK_REQUEST_TIMEOUT_MS", { infer: true }),
          headers: { authorization: `Bearer ${await this.accessToken()}` }
        }
      );
      const channels = channelsResponseSchema.parse(response.data).data;
      const normalized = username.trim().toLowerCase();
      const channel =
        channels.find((item) => item.slug.toLowerCase() === normalized) ?? channels[0];
      if (!channel) return this.offline(username);
      const stream = channel.stream;
      const startedAt = stream?.start_time ? new Date(stream.start_time) : null;
      return {
        username: channel.slug,
        normalizedUsername: normalized,
        isLive: stream?.is_live === true,
        streamUrl: `https://kick.com/${encodeURIComponent(channel.slug)}`,
        title: channel.stream_title ?? null,
        category: channel.category?.name ?? null,
        thumbnailUrl: stream?.thumbnail ?? null,
        profileImageUrl: channel.profile_picture ?? null,
        viewerCount: stream?.viewer_count ?? null,
        startedAt: startedAt && !Number.isNaN(startedAt.valueOf()) ? startedAt : null
      };
    });
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.config.get("KICK_CLIENT_ID", { infer: true }),
      client_secret: this.config.get("KICK_CLIENT_SECRET", { infer: true })
    });
    const scope = this.config.get("KICK_SCOPES", { infer: true }).trim();
    if (scope) body.set("scope", scope);
    const response = await this.http.axiosRef.post(
      this.config.get("KICK_TOKEN_URL", { infer: true }),
      body.toString(),
      {
        headers: { "content-type": "application/x-www-form-urlencoded" },
        timeout: this.config.get("KICK_REQUEST_TIMEOUT_MS", { infer: true })
      }
    );
    const token = tokenSchema.parse(response.data);
    this.token = {
      value: token.access_token,
      expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000
    };
    return token.access_token;
  }

  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    const attempts = this.config.get("KICK_MAX_RETRIES", { infer: true }) + 1;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt === attempts) break;
        const delay =
          this.config.get("KICK_RETRY_BASE_DELAY_MS", { infer: true }) * 2 ** (attempt - 1);
        this.logger.warn(`Kick request failed; retrying in ${delay}ms`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw lastError;
  }

  private offline(username: string): StreamStatus {
    return {
      username,
      normalizedUsername: username.trim().toLowerCase(),
      isLive: false,
      streamUrl: `https://kick.com/${encodeURIComponent(username)}`,
      title: null,
      category: null,
      thumbnailUrl: null,
      profileImageUrl: null,
      viewerCount: null,
      startedAt: null
    };
  }
}
