import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../../src/database/prisma.service.js";
import { configureOpenApi } from "../../src/openapi.js";

describe("OpenAPI documentation", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    Object.assign(process.env, {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      DISCORD_ENABLED: "false",
      DISCORD_CLIENT_ID: "123456789012345678",
      DISCORD_CLIENT_SECRET: "test-secret",
      DISCORD_REDIRECT_URI: "http://localhost:4000/api/v1/auth/discord/callback",
      KICK_CLIENT_ID: "test-client",
      KICK_CLIENT_SECRET: "test-secret",
      SESSION_ENCRYPTION_KEY: "test-encryption-key-with-at-least-32-characters"
    });
    const { AppModule } = await import("../../src/app.module.js");
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({
        $connect: vi.fn(),
        $disconnect: vi.fn(),
        $queryRaw: vi.fn().mockResolvedValue([{ ok: 1 }])
      })
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix("api/v1");
    configureOpenApi(app, { sessionCookieName: "kickbot_session", uiEnabled: true });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => app.close());

  it("serves a tagged contract with security, request, response, and error schemas", async () => {
    const response = await app.inject({ method: "GET", url: "/api/docs-json" });
    expect(response.statusCode).toBe(200);
    const document = response.json();

    expect(document.info).toMatchObject({ title: "KickBot Backend API", version: "2.0.0" });
    expect(document.tags.map((tag: { name: string }) => tag.name)).toEqual(
      expect.arrayContaining(["Authentication", "Bot", "Guilds", "Administration", "Health"])
    );
    expect(document.components.securitySchemes.sessionCookie).toMatchObject({
      type: "apiKey",
      in: "cookie",
      name: "kickbot_session"
    });
    expect(
      document.paths["/api/v1/auth/me"].get.responses["200"].content["application/json"].schema
        .properties.isGlobalAdmin
    ).toBeDefined();
    expect(
      document.paths["/api/v1/guilds"].get.responses["200"].content["application/json"].schema
        .properties.items.items.properties.trackedStreamerCount
    ).toBeDefined();
    expect(document.paths["/api/v1/guilds/{guildId}/streamers"].post).toMatchObject({
      summary: "Track a Kick streamer in a guild",
      security: [{ sessionCookie: [] }]
    });
    expect(
      document.paths["/api/v1/guilds/{guildId}/streamers"].post.requestBody.content[
        "application/json"
      ].schema.properties.username
    ).toBeDefined();
    expect(
      document.paths["/api/v1/guilds/{guildId}/streamers"].post.responses["201"].content[
        "application/json"
      ].schema.properties.normalizedUsername
    ).toBeDefined();
    expect(
      document.paths["/api/v1/guilds/{guildId}/streamers"].post.responses["409"].content[
        "application/json"
      ].schema.properties.error
    ).toBeDefined();
  });
});
