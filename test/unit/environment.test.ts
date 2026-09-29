import { describe, expect, it } from "vitest";
import { environmentSchema } from "../../src/config/environment.js";

const validEnvironment = {
  DATABASE_URL: "postgresql://kickbot:kickbot@localhost:5432/kickbot",
  DISCORD_ENABLED: "false",
  DISCORD_CLIENT_ID: "123",
  DISCORD_CLIENT_SECRET: "secret",
  DISCORD_REDIRECT_URI: "http://localhost:4000/api/v1/auth/discord/callback",
  KICK_CLIENT_ID: "kick-client",
  KICK_CLIENT_SECRET: "kick-secret",
  SESSION_ENCRYPTION_KEY: "a-secure-test-key-that-is-at-least-32-characters"
};

describe("environmentSchema", () => {
  it("parses booleans and defaults", () => {
    const parsed = environmentSchema.parse(validEnvironment);
    expect(parsed.DISCORD_ENABLED).toBe(false);
    expect(parsed.PORT).toBe(4000);
    expect(parsed.POLL_INTERVAL_SECONDS).toBe(60);
  });

  it("requires a Discord token when the gateway is enabled", () => {
    const parsed = environmentSchema.safeParse({ ...validEnvironment, DISCORD_ENABLED: "true" });
    expect(parsed.success).toBe(false);
  });

  it("rejects ambiguous boolean values", () => {
    const parsed = environmentSchema.safeParse({ ...validEnvironment, COOKIE_SECURE: "yes" });
    expect(parsed.success).toBe(false);
  });
});
