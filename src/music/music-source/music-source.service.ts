import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { spawn, type ChildProcess } from "node:child_process";
import { platform } from "node:os";
import { kill as killProcessGroup } from "node:process";
import { ApiError } from "../../common/api-error.js";
import type { Environment } from "../../config/environment.js";
import type {
  RejectedMusicTrack,
  ResolvedMusicSource,
  ResolvedMusicTrack,
  SpawnedMusicStream
} from "../music.types.js";

interface YtDlpEntry {
  id?: string;
  title?: string;
  uploader?: string;
  channel?: string;
  webpage_url?: string;
  original_url?: string;
  url?: string;
  duration?: number;
  live_status?: string;
  is_live?: boolean;
  availability?: string;
  age_limit?: number;
  thumbnail?: string;
  entries?: YtDlpEntry[];
}

interface SpotifyTrack {
  id: string;
  name: string;
  duration_ms: number;
  external_urls?: { spotify?: string };
  artists: Array<{ name: string }>;
  album?: { images?: Array<{ url: string }> };
  external_ids?: { isrc?: string };
}

interface CacheEntry {
  expiresAt: number;
  value: ResolvedMusicSource;
}

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "music.youtube.com", "youtu.be"]);
const SPOTIFY_HOSTS = new Set(["open.spotify.com"]);
const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;

@Injectable()
export class MusicSourceService implements OnModuleInit {
  private readonly logger = new Logger(MusicSourceService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private ytDlpAvailable = false;
  private spotifyToken: { value: string; expiresAt: number } | null = null;

  public constructor(private readonly config: ConfigService<Environment, true>) {}

  public async onModuleInit(): Promise<void> {
    try {
      const version = (await this.runYtDlp(["--version"], 5_000)).trim();
      this.ytDlpAvailable = version.length > 0;
      this.logger.log(`yt-dlp ${version} is available for music playback`);
    } catch {
      this.logger.warn("yt-dlp is unavailable; music playback will remain disabled");
    }
  }

  public isRuntimeAvailable(): boolean {
    return this.ytDlpAvailable;
  }

  public spotifyAvailable(): boolean {
    return Boolean(
      this.config.get("SPOTIFY_CLIENT_ID", { infer: true }) &&
      this.config.get("SPOTIFY_CLIENT_SECRET", { infer: true })
    );
  }

  public async resolve(sourceUrl: string): Promise<ResolvedMusicSource> {
    const parsed = parseMusicUrl(sourceUrl);
    const cacheKey = parsed.url.toString();
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return structuredClone(cached.value);
    if (!this.ytDlpAvailable) {
      throw new ApiError(503, "MUSIC_SOURCE_UNAVAILABLE", "yt-dlp is unavailable");
    }

    const resolved =
      parsed.provider === "YOUTUBE"
        ? await this.resolveYouTube(parsed.url, parsed.kind)
        : await this.resolveSpotify(parsed.url, parsed.kind, parsed.id);
    this.cache.set(cacheKey, { value: resolved, expiresAt: Date.now() + 5 * 60_000 });
    while (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value!);
    return structuredClone(resolved);
  }

  public spawnAudio(track: ResolvedMusicTrack): SpawnedMusicStream {
    const process = spawn(
      "yt-dlp",
      [
        "--no-warnings",
        "--no-update",
        "--js-runtimes",
        "node",
        "--no-playlist",
        "--no-progress",
        "-f",
        "bestaudio/best",
        "-o",
        "-",
        track.resolvedYouTubeUrl
      ],
      {
        shell: false,
        detached: platform() !== "win32",
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    let stderr = "";
    process.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_STDERR_BYTES) stderr += chunk.toString("utf8");
    });
    return { process, stderr: () => stderr.slice(-MAX_STDERR_BYTES) };
  }

  public terminateProcess(process: ChildProcess): void {
    terminateProcessTree(process);
  }

  private async resolveYouTube(url: URL, kind: "track" | "playlist"): Promise<ResolvedMusicSource> {
    if (kind === "track") {
      return {
        tracks: [await this.preflightYouTube(url.toString(), url.toString())],
        rejected: [],
        truncated: false
      };
    }
    const limit = this.config.get("MUSIC_MAX_PLAYLIST_ITEMS", { infer: true });
    const data = await this.ytJson([
      "--flat-playlist",
      "--playlist-end",
      String(limit + 1),
      "--dump-single-json",
      "--skip-download",
      url.toString()
    ]);
    const entries = (data.entries ?? []).filter((entry) => entry.id).slice(0, limit);
    const settled = await mapLimit(entries, 2, async (entry) => {
      const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(entry.id!)}`;
      try {
        return { track: await this.preflightYouTube(watchUrl, watchUrl) };
      } catch (error) {
        return { rejected: rejection(watchUrl, entry.title, error) };
      }
    });
    return {
      tracks: settled.flatMap((item) => (item.track ? [item.track] : [])),
      rejected: settled.flatMap((item) => (item.rejected ? [item.rejected] : [])),
      truncated: (data.entries?.length ?? 0) > limit
    };
  }

  private async preflightYouTube(url: string, originalUrl: string): Promise<ResolvedMusicTrack> {
    const data = await this.ytJson(["--dump-single-json", "--skip-download", "--no-playlist", url]);
    this.validateYouTubeEntry(data);
    return {
      sourceId: data.id!,
      title: data.title!,
      artist: data.uploader ?? data.channel ?? null,
      provider: "YOUTUBE",
      originalUrl,
      resolvedYouTubeUrl: data.webpage_url ?? `https://www.youtube.com/watch?v=${data.id}`,
      thumbnailUrl: data.thumbnail ?? null,
      durationSeconds: Math.round(data.duration!)
    };
  }

  private validateYouTubeEntry(entry: YtDlpEntry): void {
    if (!entry.id || !entry.title || !Number.isFinite(entry.duration)) {
      throw new ApiError(
        502,
        "MUSIC_SOURCE_UNAVAILABLE",
        "YouTube returned incomplete track metadata"
      );
    }
    if (
      entry.is_live ||
      ["is_live", "is_upcoming", "post_live"].includes(entry.live_status ?? "")
    ) {
      throw new ApiError(
        400,
        "LIVE_STREAM_UNSUPPORTED",
        "Live streams and premieres are not supported"
      );
    }
    if (
      (entry.age_limit ?? 0) > 0 ||
      ["private", "premium_only", "subscriber_only"].includes(entry.availability ?? "")
    ) {
      throw new ApiError(
        400,
        "MUSIC_SOURCE_UNAVAILABLE",
        "This YouTube video is not publicly playable"
      );
    }
    const maximum = this.config.get("MUSIC_MAX_DURATION_SECONDS", { infer: true });
    if (entry.duration! > maximum) {
      throw new ApiError(400, "TRACK_TOO_LONG", `Tracks may not exceed ${maximum} seconds`);
    }
  }

  private async resolveSpotify(
    url: URL,
    kind: "track" | "playlist",
    id: string
  ): Promise<ResolvedMusicSource> {
    if (!this.spotifyAvailable()) {
      throw new ApiError(503, "SPOTIFY_UNAVAILABLE", "Spotify credentials are not configured");
    }
    if (kind === "track") {
      const track = await this.spotifyGet<SpotifyTrack>(`/tracks/${encodeURIComponent(id)}`);
      try {
        return {
          tracks: [await this.matchSpotifyTrack(track, url.toString())],
          rejected: [],
          truncated: false
        };
      } catch (error) {
        throw error instanceof ApiError
          ? error
          : new ApiError(502, "TRACK_MATCH_NOT_FOUND", "A YouTube match was not found");
      }
    }

    const limit = this.config.get("MUSIC_MAX_PLAYLIST_ITEMS", { infer: true });
    const payload = await this.spotifyGet<{
      items: Array<{ track?: SpotifyTrack | null; item?: SpotifyTrack | null }>;
      total?: number;
      next?: string | null;
    }>(`/playlists/${encodeURIComponent(id)}/items?limit=${limit}`);
    const spotifyTracks = payload.items
      .map((item) => item.track ?? item.item)
      .filter((track): track is SpotifyTrack => Boolean(track));
    const settled = await mapLimit(spotifyTracks, 2, async (track) => {
      const trackUrl = track.external_urls?.spotify ?? `https://open.spotify.com/track/${track.id}`;
      try {
        return { track: await this.matchSpotifyTrack(track, trackUrl) };
      } catch (error) {
        return { rejected: rejection(trackUrl, track.name, error) };
      }
    });
    return {
      tracks: settled.flatMap((item) => (item.track ? [item.track] : [])),
      rejected: settled.flatMap((item) => (item.rejected ? [item.rejected] : [])),
      truncated: Boolean(payload.next) || (payload.total ?? spotifyTracks.length) > limit
    };
  }

  private async matchSpotifyTrack(
    track: SpotifyTrack,
    originalUrl: string
  ): Promise<ResolvedMusicTrack> {
    this.assertSpotifyTrack(track);
    const artists = track.artists.map((artist) => artist.name).join(", ");
    const query = `${artists} - ${track.name} official audio`;
    const result = await this.ytJson([
      "--flat-playlist",
      "--playlist-end",
      "5",
      "--dump-single-json",
      "--skip-download",
      `ytsearch5:${query}`
    ]);
    const candidates = (result.entries ?? [])
      .filter((entry) => entry.id && entry.title && Number.isFinite(entry.duration))
      .map((entry) => ({
        entry,
        score: scoreSpotifyMatch(track.name, artists, track.duration_ms / 1_000, entry)
      }))
      .filter((candidate) => candidate.score >= 0.62)
      .sort((left, right) => right.score - left.score);
    const match = candidates[0]?.entry;
    if (!match) {
      throw new ApiError(
        404,
        "TRACK_MATCH_NOT_FOUND",
        `No confident YouTube match was found for ${artists} – ${track.name}`
      );
    }
    const youtubeUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(match.id!)}`;
    const resolved = await this.preflightYouTube(youtubeUrl, originalUrl);
    return {
      ...resolved,
      sourceId: track.id,
      title: track.name,
      artist: artists,
      provider: "SPOTIFY",
      originalUrl,
      thumbnailUrl: track.album?.images?.[0]?.url ?? resolved.thumbnailUrl
    };
  }

  private assertSpotifyTrack(track: SpotifyTrack): void {
    if (
      !track ||
      typeof track.id !== "string" ||
      typeof track.name !== "string" ||
      !Number.isFinite(track.duration_ms) ||
      !Array.isArray(track.artists) ||
      track.artists.length === 0 ||
      track.artists.some((artist) => typeof artist?.name !== "string")
    ) {
      throw new ApiError(502, "SPOTIFY_UNAVAILABLE", "Spotify returned invalid track metadata");
    }
  }

  private async spotifyGet<T>(path: string): Promise<T> {
    const token = await this.getSpotifyToken();
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.config.get("MUSIC_RESOLVE_TIMEOUT_MS", { infer: true })
    );
    try {
      const response = await fetch(`https://api.spotify.com/v1${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
        redirect: "error"
      });
      if (!response.ok) {
        throw new ApiError(
          response.status === 404 ? 404 : 502,
          "SPOTIFY_UNAVAILABLE",
          "Spotify metadata is unavailable"
        );
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, "SPOTIFY_UNAVAILABLE", "Spotify metadata is unavailable");
    } finally {
      clearTimeout(timer);
    }
  }

  private async getSpotifyToken(): Promise<string> {
    if (this.spotifyToken && this.spotifyToken.expiresAt > Date.now() + 30_000)
      return this.spotifyToken.value;
    const clientId = this.config.get("SPOTIFY_CLIENT_ID", { infer: true });
    const clientSecret = this.config.get("SPOTIFY_CLIENT_SECRET", { infer: true });
    if (!clientId || !clientSecret)
      throw new ApiError(503, "SPOTIFY_UNAVAILABLE", "Spotify credentials are not configured");
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.config.get("MUSIC_RESOLVE_TIMEOUT_MS", { infer: true })
    );
    try {
      const response = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: "grant_type=client_credentials",
        signal: controller.signal,
        redirect: "error"
      });
      if (!response.ok) throw new Error(`Spotify token ${response.status}`);
      const body = (await response.json()) as { access_token?: string; expires_in?: number };
      if (!body.access_token) throw new Error("Spotify token missing");
      this.spotifyToken = {
        value: body.access_token,
        expiresAt: Date.now() + (body.expires_in ?? 3_600) * 1_000
      };
      return body.access_token;
    } catch {
      throw new ApiError(502, "SPOTIFY_UNAVAILABLE", "Spotify authentication failed");
    } finally {
      clearTimeout(timer);
    }
  }

  private async ytJson(args: string[]): Promise<YtDlpEntry> {
    const output = await this.runYtDlp([
      "--no-warnings",
      "--no-update",
      "--js-runtimes",
      "node",
      ...args
    ]);
    try {
      return JSON.parse(output) as YtDlpEntry;
    } catch {
      throw new ApiError(502, "MUSIC_SOURCE_UNAVAILABLE", "YouTube returned invalid metadata");
    }
  }

  private async runYtDlp(args: string[], timeoutMs?: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const process = spawn("yt-dlp", args, {
        shell: false,
        detached: platform() !== "win32",
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timeout = setTimeout(
        () => {
          terminateProcessTree(process);
          finish(
            new ApiError(504, "MUSIC_SOURCE_UNAVAILABLE", "Music source resolution timed out")
          );
        },
        timeoutMs ?? this.config.get("MUSIC_RESOLVE_TIMEOUT_MS", { infer: true })
      );
      const finish = (error?: ApiError): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve(stdout);
      };
      process.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
        if (Buffer.byteLength(stdout) > MAX_CAPTURE_BYTES) {
          terminateProcessTree(process);
          finish(
            new ApiError(502, "MUSIC_SOURCE_UNAVAILABLE", "Music source metadata was too large")
          );
        }
      });
      process.stderr.on("data", (chunk: Buffer) => {
        if (stderr.length < MAX_STDERR_BYTES) stderr += chunk.toString("utf8");
      });
      process.once("error", () =>
        finish(new ApiError(503, "MUSIC_SOURCE_UNAVAILABLE", "yt-dlp is unavailable"))
      );
      process.once("close", (code) => {
        if (settled) return;
        if (code === 0) return finish();
        const blocked =
          /(403|forbidden|sign in|po token|confirm you.re not a bot|challenge)/iu.test(stderr);
        finish(
          new ApiError(
            502,
            blocked ? "YOUTUBE_BLOCKED" : "MUSIC_SOURCE_UNAVAILABLE",
            blocked
              ? "YouTube blocked playback from this server"
              : "The music source is unavailable"
          )
        );
      });
    });
  }
}

export function parseMusicUrl(source: string): {
  provider: "YOUTUBE" | "SPOTIFY";
  kind: "track" | "playlist";
  id: string;
  url: URL;
} {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new ApiError(
      400,
      "UNSUPPORTED_MUSIC_URL",
      "Enter a supported YouTube or Spotify HTTPS URL"
    );
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new ApiError(
      400,
      "UNSUPPORTED_MUSIC_URL",
      "Enter a supported YouTube or Spotify HTTPS URL"
    );
  }
  const host = url.hostname.toLowerCase();
  if (YOUTUBE_HOSTS.has(host)) {
    let id = "";
    let kind: "track" | "playlist" = "track";
    if (host === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0] ?? "";
    else if (url.pathname === "/playlist") {
      id = url.searchParams.get("list") ?? "";
      kind = "playlist";
    } else if (url.pathname === "/watch") id = url.searchParams.get("v") ?? "";
    else if (/^\/(shorts|live)\//u.test(url.pathname)) id = url.pathname.split("/")[2] ?? "";
    if (!/^[\w-]{6,64}$/u.test(id))
      throw new ApiError(400, "UNSUPPORTED_MUSIC_URL", "Unsupported YouTube URL");
    const canonical =
      kind === "playlist"
        ? new URL(`https://www.youtube.com/playlist?list=${encodeURIComponent(id)}`)
        : new URL(`https://www.youtube.com/watch?v=${encodeURIComponent(id)}`);
    return { provider: "YOUTUBE", kind, id, url: canonical };
  }
  if (SPOTIFY_HOSTS.has(host)) {
    const parts = url.pathname.split("/").filter(Boolean);
    const offset = parts[0]?.startsWith("intl-") ? 1 : 0;
    const kind = parts[offset];
    const id = parts[offset + 1] ?? "";
    if ((kind !== "track" && kind !== "playlist") || !/^[A-Za-z0-9]{10,64}$/u.test(id)) {
      throw new ApiError(
        400,
        "UNSUPPORTED_MUSIC_URL",
        "Only Spotify track and playlist URLs are supported"
      );
    }
    return {
      provider: "SPOTIFY",
      kind,
      id,
      url: new URL(`https://open.spotify.com/${kind}/${id}`)
    };
  }
  throw new ApiError(
    400,
    "UNSUPPORTED_MUSIC_URL",
    "Enter a supported YouTube or Spotify HTTPS URL"
  );
}

export function scoreSpotifyMatch(
  spotifyTitle: string,
  spotifyArtist: string,
  spotifyDurationSeconds: number,
  candidate: Pick<YtDlpEntry, "title" | "uploader" | "channel" | "duration">
): number {
  if (!candidate.title || !Number.isFinite(candidate.duration)) return 0;
  const durationDelta = Math.abs(candidate.duration! - spotifyDurationSeconds);
  if (durationDelta > 15) return 0;
  const wantedTitle = tokenSet(spotifyTitle);
  const candidateTitle = tokenSet(candidate.title);
  const wantedArtist = tokenSet(spotifyArtist);
  const candidateText = tokenSet(
    `${candidate.title} ${candidate.uploader ?? ""} ${candidate.channel ?? ""}`
  );
  const titleScore = overlap(wantedTitle, candidateTitle);
  const artistScore = overlap(wantedArtist, candidateText);
  const durationScore = 1 - durationDelta / 15;
  return titleScore * 0.55 + artistScore * 0.3 + durationScore * 0.15;
}

function tokenSet(value: string): Set<string> {
  return new Set(
    value
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(/\s+/u)
      .filter(
        (token) =>
          token.length > 1 && !["official", "audio", "video", "lyrics", "topic"].includes(token)
      )
  );
}

function overlap(wanted: Set<string>, actual: Set<string>): number {
  if (wanted.size === 0) return 0;
  let matches = 0;
  for (const token of wanted) if (actual.has(token)) matches += 1;
  return matches / wanted.size;
}

function rejection(
  sourceUrl: string,
  title: string | undefined,
  error: unknown
): RejectedMusicTrack {
  const apiError = error instanceof ApiError ? error : undefined;
  return {
    sourceUrl,
    ...(title ? { title } : {}),
    code: apiError?.code ?? "MUSIC_SOURCE_UNAVAILABLE",
    message: apiError?.message ?? "The music source is unavailable"
  };
}

async function mapLimit<T, R>(
  items: T[],
  concurrency: number,
  operation: (item: T) => Promise<R>
): Promise<R[]> {
  const results = Array.from<R>({ length: items.length });
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (index < items.length) {
        const current = index++;
        results[current] = await operation(items[current]!);
      }
    })
  );
  return results;
}

function terminateProcessTree(child: ChildProcess): void {
  if (child.killed || child.exitCode !== null) return;
  if (platform() !== "win32" && child.pid) {
    try {
      killProcessGroup(-child.pid, "SIGKILL");
      return;
    } catch {
      // The process may have already exited between the state check and the signal.
    }
  }
  child.kill("SIGKILL");
}
