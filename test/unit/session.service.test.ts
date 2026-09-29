import { ConfigService } from "@nestjs/config";
import type { HttpAdapterHost } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import type { Environment } from "../../src/config/environment.js";
import { SessionService } from "../../src/auth/session.service.js";

function createService(): SessionService {
  const config = new ConfigService<Environment, true>({
    NODE_ENV: "test",
    SESSION_ENCRYPTION_KEY: "a-secure-test-key-that-is-at-least-32-characters",
    SESSION_TTL_SECONDS: 3600,
    SESSION_COOKIE_NAME: "session",
    OAUTH_STATE_COOKIE_NAME: "oauth",
    COOKIE_SECURE: false
  });
  const adapter = {
    httpAdapter: { setCookie: vi.fn(), clearCookie: vi.fn() }
  } as unknown as HttpAdapterHost;
  return new SessionService(config, adapter);
}

describe("SessionService", () => {
  it("round-trips an encrypted session", async () => {
    const service = createService();
    const token = await service.createSession({
      id: "42",
      username: "tester",
      globalName: "Test User",
      avatar: null,
      accessToken: "oauth-token"
    });
    await expect(service.readSession(token)).resolves.toEqual({
      id: "42",
      username: "tester",
      globalName: "Test User",
      avatar: null,
      accessToken: "oauth-token"
    });
  });

  it("rejects a tampered session", async () => {
    const service = createService();
    const token = await service.createSession({
      id: "42",
      username: "tester",
      globalName: null,
      avatar: null,
      accessToken: "oauth-token"
    });
    const parts = token.split(".");
    parts[3] = `${parts[3]![0] === "a" ? "b" : "a"}${parts[3]!.slice(1)}`;
    await expect(service.readSession(parts.join("."))).resolves.toBeNull();
  });

  it("validates the encrypted OAuth state", async () => {
    const service = createService();
    const { state, token } = await service.createOAuthState();
    await expect(service.verifyOAuthState(token, state)).resolves.toBe(true);
    await expect(service.verifyOAuthState(token, "different")).resolves.toBe(false);
  });
});
