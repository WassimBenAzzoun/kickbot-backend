import { SerializeOptions, applyDecorators } from "@nestjs/common";
import { ApiResponse, type ApiResponseOptions } from "@nestjs/swagger";
import { z } from "zod";
import {
  BotActivityType,
  GuildMembershipState,
  NotificationStatus,
  StreamPlatform
} from "../generated/prisma/enums.js";

const dateTimeSchema = z.preprocess(
  (value) => (value instanceof Date ? value.toISOString() : value),
  z.iso.datetime()
);
const snowflakeSchema = z.string().regex(/^\d+$/).meta({ example: "123456789012345678" });
const pageSchema = z.object({ nextCursor: z.string().nullable(), hasMore: z.boolean() });

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().optional()
  })
});

export const sessionUserResponseSchema = z.object({
  id: snowflakeSchema,
  username: z.string(),
  globalName: z.string().nullable(),
  avatarUrl: z.url().nullable(),
  isGlobalAdmin: z.boolean()
});

export const inviteUrlResponseSchema = z.object({ url: z.url() });
export const successResponseSchema = z.object({ success: z.literal(true) });

export const discordGuildResponseSchema = z.object({
  id: snowflakeSchema,
  name: z.string().nullable(),
  iconHash: z.string().nullable(),
  membershipState: z.enum(GuildMembershipState),
  alertChannelId: snowflakeSchema.nullable(),
  isAllowed: z.boolean(),
  allowlistNotes: z.string().nullable(),
  allowedByDiscordUserId: snowflakeSchema.nullable(),
  allowedAt: dateTimeSchema.nullable(),
  joinedAt: dateTimeSchema.nullable(),
  leftAt: dateTimeSchema.nullable(),
  lastSeenAt: dateTimeSchema.nullable(),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema
});

export const manageableGuildResponseSchema = z.object({
  id: snowflakeSchema,
  name: z.string(),
  iconHash: z.string().nullable(),
  configured: z.boolean(),
  alertChannelId: snowflakeSchema.nullable(),
  isAllowed: z.boolean(),
  membershipState: z.enum(GuildMembershipState),
  trackedStreamerCount: z.number().int().nonnegative()
});

export const adminGuildResponseSchema = discordGuildResponseSchema.extend({
  trackedStreamerCount: z.number().int().nonnegative()
});

export const discordChannelResponseSchema = z.object({
  id: snowflakeSchema,
  name: z.string(),
  type: z.number().int()
});

export const trackedStreamerResponseSchema = z.object({
  id: z.uuid(),
  guildId: snowflakeSchema,
  platform: z.enum(StreamPlatform),
  username: z.string(),
  normalizedUsername: z.string(),
  enabled: z.boolean(),
  lastKnownLiveState: z.boolean(),
  currentLiveStartedAt: dateTimeSchema.nullable(),
  lastNotifiedLiveAt: dateTimeSchema.nullable(),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema
});

export const notificationResponseSchema = z.object({
  id: z.uuid(),
  guildId: snowflakeSchema,
  streamerId: z.uuid().nullable(),
  streamerUsername: z.string(),
  normalizedUsername: z.string(),
  platform: z.enum(StreamPlatform),
  status: z.enum(NotificationStatus),
  streamUrl: z.url(),
  title: z.string().nullable(),
  category: z.string().nullable(),
  thumbnailUrl: z.url().nullable(),
  viewerCount: z.number().int().nullable(),
  streamStartedAt: dateTimeSchema,
  discordMessageId: snowflakeSchema.nullable(),
  sentAt: dateTimeSchema
});

export const botSettingsResponseSchema = z.object({
  id: z.literal("default"),
  allowlistEnforced: z.boolean(),
  rotationEnabled: z.boolean(),
  rotationIntervalSeconds: z.number().int(),
  defaultStatusEnabled: z.boolean(),
  defaultStatusText: z.string().nullable(),
  defaultActivityType: z.enum(BotActivityType).nullable(),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema
});

export const presenceMessageResponseSchema = z.object({
  id: z.uuid(),
  text: z.string(),
  activityType: z.enum(BotActivityType),
  enabled: z.boolean(),
  sortOrder: z.number().int(),
  usePlaceholders: z.boolean(),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema
});

export const globalAdminResponseSchema = z.object({
  discordId: snowflakeSchema,
  createdAt: dateTimeSchema.optional(),
  source: z.enum(["environment", "database"]).optional()
});

export const livenessResponseSchema = z.object({
  status: z.literal("ok"),
  timestamp: z.iso.datetime()
});

export const readinessResponseSchema = z.object({
  status: z.literal("ok"),
  checks: z.object({
    database: z.literal("up"),
    discord: z.enum(["up", "disabled"]),
    scheduler: z.enum(["up", "disabled"])
  })
});

export function collectionResponseSchema<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), page: pageSchema });
}

export function ApiSchemaResponse(
  schema: z.ZodType,
  options: { status?: number; description?: string } = {}
) {
  const response: ApiResponseOptions = {
    status: options.status ?? 200,
    description: options.description,
    schema: z.toJSONSchema(schema, { target: "openapi-3.0", io: "output" }) as never
  };
  return applyDecorators(SerializeOptions({ schema }), ApiResponse(response));
}

export function ApiErrors(...statuses: number[]) {
  return applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({
        status,
        description: errorDescription(status),
        schema: z.toJSONSchema(errorResponseSchema, {
          target: "openapi-3.0",
          io: "output"
        }) as never
      })
    )
  );
}

function errorDescription(status: number): string {
  return (
    {
      400: "The request is invalid.",
      401: "A valid session cookie is required.",
      403: "The authenticated user does not have access.",
      404: "The requested resource does not exist.",
      409: "The request conflicts with existing state.",
      429: "The API rate limit was exceeded.",
      500: "An unexpected server error occurred.",
      502: "An upstream Discord or Kick request failed.",
      503: "The service is not ready."
    }[status] ?? "Request failed."
  );
}
