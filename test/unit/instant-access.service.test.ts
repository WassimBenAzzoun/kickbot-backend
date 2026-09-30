import { describe, expect, it, vi } from "vitest";
import type { DiscordApiService } from "../../src/auth/discord-api.service.js";
import type { AdminAccessService } from "../../src/admin/admin-access.service.js";
import type { PrismaService } from "../../src/database/prisma.service.js";
import { InstantAccessMode } from "../../src/generated/prisma/enums.js";
import { InstantAccessService } from "../../src/instants/instant-access/instant-access.service.js";

describe("InstantAccessService", () => {
  function fixture(input?: {
    enabled?: boolean;
    mode?: InstantAccessMode;
    admin?: boolean;
    allowed?: boolean;
    guildAllowed?: boolean;
  }) {
    const settings = {
      instantsEnabled: input?.enabled ?? true,
      instantAccessMode: input?.mode ?? InstantAccessMode.EVERYONE,
      allowlistEnforced: false
    };
    const prisma = {
      botSettings: { upsert: vi.fn(async () => settings) },
      discordGuild: { findUnique: vi.fn(async () => ({ isAllowed: input?.guildAllowed ?? true })) },
      instantAllowedUser: {
        findUnique: vi.fn(async () => (input?.allowed ? { discordId: "user" } : null))
      }
    };
    const admins = { isAdmin: vi.fn(async () => input?.admin ?? false) };
    return new InstantAccessService(
      prisma as unknown as PrismaService,
      admins as unknown as AdminAccessService,
      {} as DiscordApiService
    );
  }

  it("allows everyone while enabled and denies all playback while disabled", async () => {
    await expect(fixture().canPlay("user", "guild")).resolves.toBe(true);
    await expect(fixture({ enabled: false }).canPlay("user", "guild")).resolves.toBe(false);
    await expect(fixture({ enabled: false }).requireCanPlay("user", "guild")).rejects.toMatchObject(
      { code: "INSTANTS_DISABLED" }
    );
  });

  it("enforces the user allowlist and lets global admins bypass it", async () => {
    const restricted = fixture({ mode: InstantAccessMode.ALLOWLIST_ONLY });
    await expect(restricted.canPlay("user", "guild")).resolves.toBe(false);
    await expect(
      fixture({ mode: InstantAccessMode.ALLOWLIST_ONLY, allowed: true }).canPlay("user", "guild")
    ).resolves.toBe(true);
    await expect(
      fixture({ mode: InstantAccessMode.ALLOWLIST_ONLY, admin: true }).canPlay("admin", "guild")
    ).resolves.toBe(true);
  });
});
