import { z } from "zod";

const optionalString = () =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().min(1).optional()
  );
const booleanFromEnvironment = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((value, context) => {
      if (value === undefined) return defaultValue;
      if (value === "true") return true;
      if (value === "false") return false;
      context.addIssue({ code: "custom", message: "Expected true or false" });
      return z.NEVER;
    });

export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    DATABASE_URL: z.string().min(1),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "log", "debug", "verbose"]).default("log"),

    DISCORD_ENABLED: booleanFromEnvironment(true),
    DISCORD_TOKEN: optionalString(),
    DISCORD_CLIENT_ID: z.string().trim().min(1),
    DISCORD_CLIENT_SECRET: z.string().trim().min(1),
    DISCORD_REDIRECT_URI: z.url(),
    DISCORD_DEVELOPMENT_GUILD_ID: optionalString(),
    DISCORD_BOT_PERMISSIONS: z.string().regex(/^\d+$/).default("3230720"),
    DISCORD_OAUTH_SCOPES: z.string().default("identify guilds"),

    KICK_CLIENT_ID: z.string().trim().min(1),
    KICK_CLIENT_SECRET: z.string().trim().min(1),
    KICK_API_BASE_URL: z.url().default("https://api.kick.com"),
    KICK_TOKEN_URL: z.url().default("https://id.kick.com/oauth/token"),
    KICK_SCOPES: z.string().default(""),
    KICK_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(8_000),
    KICK_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
    KICK_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(100).max(10_000).default(1_000),
    POLL_INTERVAL_SECONDS: z.coerce.number().int().min(15).default(60),
    PROVIDER_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(4),
    BOT_PRESENCE_SYNC_INTERVAL_SECONDS: z.coerce.number().int().min(10).default(60),

    MYINSTANTS_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(8_000),
    MYINSTANTS_CACHE_TTL_SECONDS: z.coerce.number().int().min(30).max(3_600).default(300),
    MYINSTANTS_USER_AGENT: z.string().trim().min(1).default("KickBot/2.0"),
    INSTANT_AUDIO_MAX_BYTES: z.coerce
      .number()
      .int()
      .min(100_000)
      .max(20_000_000)
      .default(5_242_880),
    INSTANT_MAX_DURATION_SECONDS: z.coerce.number().int().min(1).max(120).default(30),
    INSTANT_MAX_QUEUE_LENGTH: z.coerce.number().int().min(1).max(100).default(20),
    INSTANT_USER_COOLDOWN_SECONDS: z.coerce.number().int().min(0).max(60).default(3),
    INSTANT_MAX_ACTIVE_GUILDS: z.coerce.number().int().min(1).max(20).default(5),
    INSTANT_IDLE_DISCONNECT_SECONDS: z.coerce.number().int().min(1).max(300).default(30),

    FRONTEND_URL: z.url().default("http://localhost:3000"),
    CORS_ORIGINS: z.string().default("http://localhost:3000"),
    SESSION_ENCRYPTION_KEY: z.string().min(32),
    SESSION_TTL_SECONDS: z.coerce.number().int().min(300).default(604_800),
    SESSION_COOKIE_NAME: z.string().default("kickbot_session"),
    OAUTH_STATE_COOKIE_NAME: z.string().default("kickbot_oauth_state"),
    COOKIE_SECURE: booleanFromEnvironment(false),
    COOKIE_DOMAIN: optionalString(),
    API_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(100),
    API_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).default(60),
    GLOBAL_ADMIN_DISCORD_IDS: z.string().default(""),
    SWAGGER_UI_ENABLED: booleanFromEnvironment(true)
  })
  .superRefine((value, context) => {
    if (value.DISCORD_ENABLED && !value.DISCORD_TOKEN) {
      context.addIssue({
        code: "custom",
        path: ["DISCORD_TOKEN"],
        message: "DISCORD_TOKEN is required when DISCORD_ENABLED=true"
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export function corsOrigins(value: string): string[] {
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}
