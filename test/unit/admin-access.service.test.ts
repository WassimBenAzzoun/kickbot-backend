import type { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import { AdminAccessService } from "../../src/admin/admin-access.service.js";
import type { Environment } from "../../src/config/environment.js";
import type { PrismaService } from "../../src/database/prisma.service.js";

describe("AdminAccessService", () => {
  function createService(databaseAdmin: boolean) {
    const prisma = {
      globalAdmin: {
        findUnique: vi.fn(async () => (databaseAdmin ? { discordId: "database-admin" } : null))
      }
    };
    const config = {
      get: vi.fn(() => "configured-admin, second-admin")
    };
    return {
      service: new AdminAccessService(
        prisma as unknown as PrismaService,
        config as unknown as ConfigService<Environment, true>
      ),
      prisma
    };
  }

  it("recognizes configured administrators without querying the database", async () => {
    const { service, prisma } = createService(false);
    await expect(service.isAdmin("configured-admin")).resolves.toBe(true);
    expect(prisma.globalAdmin.findUnique).not.toHaveBeenCalled();
  });

  it("recognizes database administrators and rejects other users", async () => {
    const database = createService(true);
    await expect(database.service.isAdmin("database-admin")).resolves.toBe(true);
    const regular = createService(false);
    await expect(regular.service.isAdmin("regular-user")).resolves.toBe(false);
  });
});
