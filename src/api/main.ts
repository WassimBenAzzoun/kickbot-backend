import { prisma } from "../config/database";
import { env } from "../config/env";
import { createAppContext } from "../shared/appContext";
import { logger } from "../utils/logger";
import { buildApiServer } from "./server";

async function bootstrapApi(): Promise<void> {
  const appContext = createAppContext();
  const server = await buildApiServer(appContext);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "Shutting down API server");
    await server.close();
    await prisma.$disconnect();
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT").finally(() => process.exit(0));
  });

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM").finally(() => process.exit(0));
  });

  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "Unhandled API promise rejection");
  });

  process.on("uncaughtException", (error) => {
    logger.fatal({ err: error }, "Uncaught API exception");
    void shutdown("uncaughtException").finally(() => process.exit(1));
  });

  await server.listen({
    host: "0.0.0.0",
    port: env.API_PORT
  });

  logger.info({ port: env.API_PORT }, "API server started");
}

void bootstrapApi().catch(async (error) => {
  logger.fatal({ err: error }, "Failed to bootstrap API");
  await prisma.$disconnect();
  process.exit(1);
});