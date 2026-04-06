import axios, { AxiosError, AxiosInstance } from "axios";
import { Logger } from "pino";
import { z } from "zod";
import { env } from "../../config/env";
import { sleep } from "../../utils/async";

const TOKEN_EXPIRY_SKEW_MS = 30_000;

const kickTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().min(1),
  expires_in: z.coerce.number().int().positive(),
  scope: z.string().optional()
});

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
  scope: string | null;
}

export class KickAuthService {
  private readonly tokenClient: AxiosInstance;
  private cachedToken: CachedToken | null = null;
  private inflightTokenRequest: Promise<string> | null = null;

  public constructor(private readonly logger: Logger) {
    this.tokenClient = axios.create({
      timeout: env.KICK_REQUEST_TIMEOUT_MS
    });
  }

  public async getAccessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.hasValidCachedToken()) {
      return this.cachedToken!.accessToken;
    }

    if (this.inflightTokenRequest) {
      return this.inflightTokenRequest;
    }

    this.inflightTokenRequest = this.fetchAccessToken();

    try {
      return await this.inflightTokenRequest;
    } finally {
      this.inflightTokenRequest = null;
    }
  }

  public invalidateCachedToken(): void {
    this.cachedToken = null;
  }

  private hasValidCachedToken(): boolean {
    if (!this.cachedToken) {
      return false;
    }

    const now = Date.now();
    return now + TOKEN_EXPIRY_SKEW_MS < this.cachedToken.expiresAtMs;
  }

  private async fetchAccessToken(): Promise<string> {
    const maxAttempts = env.KICK_MAX_RETRIES + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const form = new URLSearchParams({
          grant_type: "client_credentials",
          client_id: env.KICK_CLIENT_ID,
          client_secret: env.KICK_CLIENT_SECRET
        });

        if (env.KICK_SCOPES.trim().length > 0) {
          form.set("scope", env.KICK_SCOPES.trim());
        }

        const response = await this.tokenClient.post(env.KICK_TOKEN_URL, form.toString(), {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded"
          },
          validateStatus: () => true
        });

        if (response.status >= 200 && response.status < 300) {
          const parsed = kickTokenResponseSchema.safeParse(response.data);
          if (!parsed.success) {
            throw new Error("Kick token response shape was invalid");
          }

          const tokenData = parsed.data;
          this.cachedToken = {
            accessToken: tokenData.access_token,
            expiresAtMs: Date.now() + tokenData.expires_in * 1000,
            scope: tokenData.scope?.trim() ? tokenData.scope.trim() : null
          };

          this.logger.info(
            {
              expiresInSeconds: tokenData.expires_in,
              scope: this.cachedToken.scope
            },
            "Kick app token acquired"
          );

          return tokenData.access_token;
        }

        const shouldRetry = response.status === 429 || response.status >= 500;
        if (!shouldRetry || attempt === maxAttempts) {
          throw new Error(`Kick OAuth token request failed with status ${response.status}`);
        }

        const delayMs = this.computeRetryDelayMs(
          attempt,
          response.status,
          response.headers["retry-after"]
        );

        this.logger.warn(
          {
            attempt,
            maxAttempts,
            status: response.status,
            delayMs
          },
          "Kick token request will retry"
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
            attempt,
            maxAttempts,
            status,
            delayMs
          },
          "Kick token request retrying after transport/server failure"
        );

        await sleep(delayMs);
      }
    }

    throw new Error("Kick token acquisition failed unexpectedly");
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
