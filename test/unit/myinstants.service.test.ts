import type { HttpService } from "@nestjs/axios";
import type { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import type { Environment } from "../../src/config/environment.js";
import { MyinstantsService } from "../../src/instants/myinstants/myinstants.service.js";

function serviceWithResponse(response: {
  status: number;
  data: unknown;
  headers?: Record<string, string>;
}) {
  const get = vi.fn(async () => ({ ...response, headers: response.headers ?? {} }));
  const http = { axiosRef: { get } };
  const config = {
    get: vi.fn(
      (key: string) =>
        (
          ({
            MYINSTANTS_REQUEST_TIMEOUT_MS: 8_000,
            MYINSTANTS_CACHE_TTL_SECONDS: 300,
            MYINSTANTS_USER_AGENT: "KickBot test",
            INSTANT_AUDIO_MAX_BYTES: 5_242_880
          }) as Record<string, string | number>
        )[key]
    )
  };
  return {
    service: new MyinstantsService(
      http as unknown as HttpService,
      config as unknown as ConfigService<Environment, true>
    ),
    get
  };
}

describe("MyinstantsService", () => {
  it("normalizes only HTTPS Myinstants instant pages", () => {
    const { service } = serviceWithResponse({ status: 200, data: "" });
    expect(service.normalizePageUrl("https://myinstants.com/instant/air-horn/")).toBe(
      "https://www.myinstants.com/en/instant/air-horn/"
    );
    expect(() =>
      service.normalizePageUrl("http://www.myinstants.com/en/instant/air-horn/")
    ).toThrowError(/HTTPS Myinstants/);
    expect(() => service.normalizePageUrl("https://evil.test/en/instant/air-horn/")).toThrowError(
      /Myinstants/
    );
  });

  it("parses search results and caches their detail audio path", async () => {
    const html = `<div class="instant"><a class="instant-link" href="/en/instant/air-horn/">Air Horn</a><button class="small-button" onclick="play('/media/sounds/air-horn.mp3', 'x')"></button></div>`;
    const { service, get } = serviceWithResponse({ status: 200, data: html });
    await expect(service.search("air horn", 25)).resolves.toEqual([
      {
        id: "air-horn",
        title: "Air Horn",
        pageUrl: "https://www.myinstants.com/en/instant/air-horn/"
      }
    ]);
    await expect(
      service.resolve("https://www.myinstants.com/en/instant/air-horn/")
    ).resolves.toMatchObject({ audioUrl: "https://www.myinstants.com/media/sounds/air-horn.mp3" });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("maps Cloudflare challenge pages to the blocked provider error", async () => {
    const { service } = serviceWithResponse({
      status: 403,
      data: "Attention Required! | Cloudflare"
    });
    await expect(service.search("blocked sound")).rejects.toMatchObject({
      code: "MYINSTANTS_BLOCKED"
    });
  });

  it("rejects non-audio responses and arbitrary audio hosts", async () => {
    const { service } = serviceWithResponse({
      status: 200,
      data: new TextEncoder().encode("not audio").buffer,
      headers: { "content-type": "text/html" }
    });
    await expect(
      service.downloadAudio("https://www.myinstants.com/media/sounds/test.mp3")
    ).rejects.toMatchObject({ code: "INVALID_INSTANT_AUDIO" });
    await expect(
      service.downloadAudio("https://evil.test/media/sounds/test.mp3")
    ).rejects.toMatchObject({
      code: "INVALID_INSTANT_URL"
    });
  });
});
