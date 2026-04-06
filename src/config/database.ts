import { PrismaClient } from "@prisma/client";
import { env } from "./env";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

const prismaClient =
  global.__prisma ??
  new PrismaClient({
    log: env.NODE_ENV === "development" ? ["error", "warn", "info"] : ["error", "warn"]
  });

if (env.NODE_ENV !== "production") {
  global.__prisma = prismaClient;
}

export const prisma = prismaClient;