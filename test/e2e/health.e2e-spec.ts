import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../../src/database/prisma.service.js";
import { HealthController } from "../../src/health/health/health.controller.js";
import { InstantAccessService } from "../../src/instants/instant-access/instant-access.service.js";
import { VoiceQueueService } from "../../src/instants/voice-queue/voice-queue.service.js";

describe("health endpoints", () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: { $queryRaw: vi.fn().mockResolvedValue([{ ok: 1 }]) } },
        {
          provide: ConfigService,
          useValue: { get: vi.fn((key: string) => (key === "DISCORD_ENABLED" ? false : undefined)) }
        },
        {
          provide: InstantAccessService,
          useValue: { settings: vi.fn(async () => ({ instantsEnabled: false })) }
        },
        { provide: VoiceQueueService, useValue: { isRuntimeAvailable: vi.fn(() => false) } }
      ]
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix("api/v1");
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => app.close());

  it("reports liveness and HTTP readiness", async () => {
    const live = await app.inject({ method: "GET", url: "/api/v1/health/live" });
    expect(live.statusCode).toBe(200);
    expect(live.json().status).toBe("ok");

    const ready = await app.inject({ method: "GET", url: "/api/v1/health/ready" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json().checks).toEqual({
      database: "up",
      discord: "disabled",
      scheduler: "disabled",
      instants: "disabled"
    });
  });
});
