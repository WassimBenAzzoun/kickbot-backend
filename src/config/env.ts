import "dotenv/config";
import { z } from "zod";

function emptyStringToUndefined(value: unknown): unknown {
  if (typeof value === "string" && value.trim().length === 0) {
    return undefined;
  }

  return value;
}

function optionalString() {
  return z.preprocess(emptyStringToUndefined, z.string().min(1).optional());
}

function optionalUrl() {
  return z.preprocess(emptyStringToUndefined, z.string().url().optional());
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  DISCORD_TOKEN: optionalString(),
  DISCORD_CLIENT_ID: z.string().min(1, "DISCORD_CLIENT_ID is required"),
  DISCORD_CLIENT_SECRET: optionalString(),
  DISCORD_REDIRECT_URI: optionalUrl(),
  DISCORD_COMMAND_GUILD_ID: optionalString(),
  DISCORD_BOT_PERMISSIONS: z.string().regex(/^\d+$/).default("84992"),
  DISCORD_OAUTH_SCOPES: z.string().default("identify guilds"),
  DISCORD_GUILDS_CACHE_TTL_SECONDS: z.coerce.number().int().min(5).max(300).default(30),

  POLL_INTERVAL_SECONDS: z.coerce.number().int().min(10).max(3600).default(60),
  BOT_PRESENCE_SYNC_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(300).default(10),
  KICK_CLIENT_ID: z.string().min(1, "KICK_CLIENT_ID is required"),
  KICK_CLIENT_SECRET: z.string().min(1, "KICK_CLIENT_SECRET is required"),
  KICK_API_BASE_URL: z.string().url().default("https://api.kick.com"),
  KICK_TOKEN_URL: z.string().url().default("https://id.kick.com/oauth/token"),
  KICK_SCOPES: z.string().default(""),
  KICK_WEBHOOK_SECRET: optionalString(),
  KICK_WEBHOOK_BASE_URL: optionalUrl(),
  KICK_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(8000),
  KICK_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
  KICK_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(100).max(10000).default(1000),
  PROVIDER_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(4),

  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_BASE_URL: z.string().url().default("http://localhost:4000"),
  FRONTEND_URL: z.string().url().default("http://localhost:3000"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),

  GLOBAL_ADMIN_DISCORD_IDS: z.string().default(""),

  JWT_SECRET: optionalString(),
  JWT_EXPIRES_IN: z.string().default("7d"),
  SESSION_COOKIE_NAME: z.string().default("kickbot_session"),
  OAUTH_STATE_COOKIE_NAME: z.string().default("kickbot_oauth_state"),
  COOKIE_SECURE: z.coerce.boolean().default(false),
  COOKIE_DOMAIN: optionalString(),

  API_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10000).default(100),
  API_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).max(3600).default(60),

  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info")
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
    .join("; ");

  throw new Error(`Invalid environment configuration: ${details}`);
}

export const env = parsed.data;
