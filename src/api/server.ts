import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { FastifyInstance } from "fastify";
import { AppContext } from "../shared/appContext";
import { env } from "../config/env";
import { ApiError } from "./services/errors";
import { adminRoutes } from "./routes/adminRoutes";
import { authRoutes } from "./routes/authRoutes";
import { botRoutes } from "./routes/botRoutes";
import { dashboardRoutes } from "./routes/dashboardRoutes";
import { guildRoutes } from "./routes/guildRoutes";
import { healthRoutes } from "./routes/healthRoutes";

function resolveCorsOrigins(): string[] {
  return env.CORS_ORIGIN.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export async function buildApiServer(appContext: AppContext): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: {
      level: env.LOG_LEVEL
    }
  });

  fastify.decorate("appContext", appContext);

  await fastify.register(cookie);
  await fastify.register(helmet, {
    // API-only service: keep common hardening headers but skip CSP that targets HTML rendering.
    contentSecurityPolicy: false
  });
  await fastify.register(cors, {
    origin: resolveCorsOrigins(),
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  });

  await fastify.register(rateLimit, {
    global: true,
    max: env.API_RATE_LIMIT_MAX,
    timeWindow: env.API_RATE_LIMIT_WINDOW_SECONDS * 1000
  });

  await fastify.register(healthRoutes);
  await fastify.register(authRoutes);
  await fastify.register(botRoutes);
  await fastify.register(dashboardRoutes);
  await fastify.register(guildRoutes);
  await fastify.register(adminRoutes);

  fastify.setNotFoundHandler(async (_request, reply) => {
    await reply.code(404).send({
      error: "Not Found",
      message: "Route not found"
    });
  });

  fastify.setErrorHandler(async (error, _request, reply) => {
    if (error instanceof ApiError) {
      await reply.code(error.statusCode).send({
        error: error.statusCode >= 500 ? "Server Error" : "Request Error",
        message: error.message
      });
      return;
    }

    fastify.log.error({ err: error }, "Unhandled API error");
    await reply.code(500).send({
      error: "Internal Server Error",
      message: "Unexpected API error"
    });
  });

  return fastify;
}
