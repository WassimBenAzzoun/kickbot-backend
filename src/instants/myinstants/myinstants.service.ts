import { HttpService } from "@nestjs/axios";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AxiosError, type AxiosResponse } from "axios";
import * as cheerio from "cheerio";
import { setTimeout as delay } from "node:timers/promises";
import { ApiError } from "../../common/api-error.js";
import type { Environment } from "../../config/environment.js";
import type { InstantSearchResult, ResolvedInstant } from "../instants.types.js";

const MYINSTANTS_ORIGIN = "https://www.myinstants.com";
const ALLOWED_HOSTS = new Set(["myinstants.com", "www.myinstants.com"]);
const INSTANT_PATH = /^\/(?:[a-z]{2}\/)?instant\/([a-z0-9][a-z0-9_-]*)\/?$/i;
const AUDIO_PATH = /^\/media\/sounds\/[a-z0-9][a-z0-9._%+-]*$/i;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

@Injectable()
export class MyinstantsService {
  private readonly logger = new Logger(MyinstantsService.name);
  private readonly searchCache = new Map<string, CacheEntry<InstantSearchResult[]>>();
  private readonly detailCache = new Map<string, CacheEntry<ResolvedInstant>>();
  private readonly waiters: Array<() => void> = [];
  private activeRequests = 0;
  private lastSearchAt = 0;
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;

  public constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService<Environment, true>
  ) {}

  public async search(query: string, limit = 20): Promise<InstantSearchResult[]> {
    const normalized = query.trim().replace(/\s+/g, " ").slice(0, 80);
    if (normalized.length < 2) {
      throw new ApiError(
        400,
        "INVALID_INSTANT_QUERY",
        "Search query must contain at least 2 characters"
      );
    }
    const key = normalized.toLocaleLowerCase();
    const cached = this.readCache(this.searchCache, key);
    if (cached) return cached.slice(0, limit);

    await this.acquire();
    try {
      const wait = Math.max(0, 1_000 - (Date.now() - this.lastSearchAt));
      if (wait > 0) await delay(wait);
      this.lastSearchAt = Date.now();
      const url = new URL("/en/search/", MYINSTANTS_ORIGIN);
      url.searchParams.set("name", normalized);
      const html = await this.requestHtml(url);
      const results = this.parseSearch(html).slice(0, 25);
      this.writeCache(this.searchCache, key, results);
      return results.slice(0, limit);
    } finally {
      this.release();
    }
  }

  public async resolve(pageUrl: string): Promise<ResolvedInstant> {
    const canonical = this.normalizePageUrl(pageUrl);
    const cached = this.readCache(this.detailCache, canonical);
    if (cached) return cached;

    await this.acquire();
    try {
      const html = await this.requestHtml(new URL(canonical));
      const $ = cheerio.load(html);
      const title = $("h1").first().text().trim();
      const audioPath =
        $("a[download][href^='/media/sounds/']").first().attr("href") ??
        $("#instant-page-button-element").first().attr("data-url") ??
        this.audioPathFromOnclick($("#instant-page-button-element").first().attr("onclick"));
      if (!title || !audioPath || !AUDIO_PATH.test(audioPath)) {
        throw new ApiError(404, "INSTANT_NOT_FOUND", "Myinstants sound was not found");
      }
      const id = new URL(canonical).pathname.match(INSTANT_PATH)?.[1];
      if (!id) throw new ApiError(400, "INVALID_INSTANT_URL", "Invalid Myinstants URL");
      const result = {
        id,
        title,
        pageUrl: canonical,
        audioUrl: new URL(audioPath, MYINSTANTS_ORIGIN).toString()
      };
      this.writeCache(this.detailCache, canonical, result);
      return result;
    } finally {
      this.release();
    }
  }

  public async downloadAudio(audioUrl: string): Promise<Buffer> {
    let url = this.validateAudioUrl(audioUrl);
    const timeout = this.config.get("MYINSTANTS_REQUEST_TIMEOUT_MS", { infer: true });
    const maxBytes = this.config.get("INSTANT_AUDIO_MAX_BYTES", { infer: true });
    await this.acquire();
    try {
      for (let redirect = 0; redirect <= 3; redirect += 1) {
        let response: AxiosResponse<ArrayBuffer> | undefined;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          response = await this.http.axiosRef.get<ArrayBuffer>(url.toString(), {
            responseType: "arraybuffer",
            timeout,
            maxRedirects: 0,
            maxContentLength: maxBytes,
            maxBodyLength: maxBytes,
            validateStatus: () => true,
            headers: this.headers()
          });
          if ((response.status === 429 || response.status >= 500) && attempt === 0) {
            await delay(500);
            continue;
          }
          break;
        }
        if (!response) break;
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.location;
          if (!location) break;
          url = this.validateAudioUrl(new URL(location, url).toString());
          continue;
        }
        if (response.status === 403) {
          throw new ApiError(502, "MYINSTANTS_BLOCKED", "Myinstants blocked the audio request");
        }
        if (response.status !== 200) {
          throw new ApiError(502, "MYINSTANTS_UNAVAILABLE", "Myinstants audio is unavailable");
        }
        const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
        if (!contentType.startsWith("audio/") && !contentType.includes("octet-stream")) {
          throw new ApiError(502, "INVALID_INSTANT_AUDIO", "Myinstants returned invalid audio");
        }
        const buffer = Buffer.from(response.data);
        if (buffer.length === 0 || buffer.length > maxBytes) {
          throw new ApiError(400, "INSTANT_TOO_LARGE", "Instant audio exceeds the 5 MB limit");
        }
        return buffer;
      }
      throw new ApiError(502, "MYINSTANTS_UNAVAILABLE", "Too many Myinstants redirects");
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof AxiosError && error.code === "ERR_BAD_RESPONSE") {
        throw new ApiError(400, "INSTANT_TOO_LARGE", "Instant audio exceeds the 5 MB limit");
      }
      throw this.providerError(error);
    } finally {
      this.release();
    }
  }

  public normalizePageUrl(value: string): string {
    let url: URL;
    try {
      url = new URL(value.trim());
    } catch {
      throw new ApiError(400, "INVALID_INSTANT_URL", "Enter a valid Myinstants instant URL");
    }
    this.assertAllowedHost(url);
    const match = url.pathname.match(INSTANT_PATH);
    if (!match || url.protocol !== "https:") {
      throw new ApiError(400, "INVALID_INSTANT_URL", "Enter a valid Myinstants instant URL");
    }
    return `${MYINSTANTS_ORIGIN}/en/instant/${match[1]}/`;
  }

  private parseSearch(html: string): InstantSearchResult[] {
    const $ = cheerio.load(html);
    const results: InstantSearchResult[] = [];
    $(".instant").each((_index, element) => {
      const container = $(element);
      const link = container.find("a.instant-link[href*='/instant/']").first();
      const href = link.attr("href");
      const title = link.text().trim();
      const audioPath =
        container.find(".small-button").first().attr("data-url") ??
        this.audioPathFromOnclick(container.find(".small-button").first().attr("onclick"));
      if (!href || !title || !audioPath || !AUDIO_PATH.test(audioPath)) return;
      try {
        const pageUrl = this.normalizePageUrl(new URL(href, MYINSTANTS_ORIGIN).toString());
        const id = new URL(pageUrl).pathname.match(INSTANT_PATH)?.[1];
        if (!id || results.some((item) => item.id === id)) return;
        results.push({ id, title: title.slice(0, 200), pageUrl });
        this.writeCache(this.detailCache, pageUrl, {
          id,
          title: title.slice(0, 200),
          pageUrl,
          audioUrl: new URL(audioPath, MYINSTANTS_ORIGIN).toString()
        });
      } catch {
        // Ignore malformed upstream entries without failing the entire search.
      }
    });
    return results;
  }

  private audioPathFromOnclick(value: string | undefined): string | undefined {
    return value?.match(/^play\(['"]([^'"]+)['"]/)?.[1];
  }

  private async requestHtml(initialUrl: URL): Promise<string> {
    if (Date.now() < this.circuitOpenUntil) {
      throw new ApiError(502, "MYINSTANTS_UNAVAILABLE", "Myinstants is temporarily unavailable");
    }
    let url = initialUrl;
    this.assertAllowedHost(url);
    const timeout = this.config.get("MYINSTANTS_REQUEST_TIMEOUT_MS", { infer: true });
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let response: AxiosResponse<string> | undefined;
        for (let redirect = 0; redirect <= 3; redirect += 1) {
          response = await this.http.axiosRef.get<string>(url.toString(), {
            responseType: "text",
            timeout,
            maxRedirects: 0,
            maxContentLength: 1_000_000,
            validateStatus: () => true,
            headers: this.headers()
          });
          if (response.status >= 300 && response.status < 400) {
            const location = response.headers.location;
            if (!location) break;
            url = new URL(location, url);
            this.assertAllowedHost(url);
            continue;
          }
          break;
        }
        if (!response) break;
        if (this.isCloudflareBlock(response)) {
          throw new ApiError(502, "MYINSTANTS_BLOCKED", "Myinstants blocked this server request");
        }
        if (response.status === 200) {
          this.consecutiveFailures = 0;
          return response.data;
        }
        if ((response.status === 429 || response.status >= 500) && attempt === 0) {
          await delay(500);
          continue;
        }
        throw new ApiError(502, "MYINSTANTS_UNAVAILABLE", "Myinstants is unavailable");
      }
      throw new ApiError(502, "MYINSTANTS_UNAVAILABLE", "Myinstants is unavailable");
    } catch (error) {
      if (error instanceof ApiError && error.code === "MYINSTANTS_BLOCKED") {
        this.registerFailure(error);
        throw error;
      }
      const mapped = error instanceof ApiError ? error : this.providerError(error);
      this.registerFailure(mapped);
      throw mapped;
    }
  }

  private isCloudflareBlock(response: AxiosResponse<string>): boolean {
    const body = String(response.data).slice(0, 10_000);
    return (
      response.status === 403 ||
      response.headers["cf-mitigated"] === "challenge" ||
      body.includes("Attention Required! | Cloudflare")
    );
  }

  private registerFailure(error: Error): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= 3) {
      this.circuitOpenUntil = Date.now() + 60_000;
      this.logger.warn(`Myinstants circuit opened: ${error.message}`);
    }
  }

  private validateAudioUrl(value: string): URL {
    const url = new URL(value);
    this.assertAllowedHost(url);
    if (url.protocol !== "https:" || !AUDIO_PATH.test(url.pathname)) {
      throw new ApiError(400, "INVALID_INSTANT_AUDIO", "Invalid Myinstants audio URL");
    }
    return url;
  }

  private assertAllowedHost(url: URL): void {
    if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
      throw new ApiError(400, "INVALID_INSTANT_URL", "Only HTTPS Myinstants URLs are accepted");
    }
  }

  private headers(): Record<string, string> {
    return {
      "user-agent": this.config.get("MYINSTANTS_USER_AGENT", { infer: true }),
      accept: "text/html,application/xhtml+xml,audio/mpeg,audio/*;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.8"
    };
  }

  private providerError(error: unknown): ApiError {
    this.logger.warn(`Myinstants request failed: ${String(error)}`);
    return new ApiError(502, "MYINSTANTS_UNAVAILABLE", "Myinstants is unavailable");
  }

  private readCache<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
    const entry = cache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  private writeCache<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void {
    if (cache.size >= 100) cache.delete(cache.keys().next().value ?? "");
    cache.set(key, {
      value,
      expiresAt:
        Date.now() + this.config.get("MYINSTANTS_CACHE_TTL_SECONDS", { infer: true }) * 1_000
    });
  }

  private async acquire(): Promise<void> {
    if (this.activeRequests < 2) {
      this.activeRequests += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.activeRequests += 1;
  }

  private release(): void {
    this.activeRequests -= 1;
    this.waiters.shift()?.();
  }
}
