import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/common/api-error.js";
import {
  parseMusicUrl,
  scoreSpotifyMatch
} from "../../src/music/music-source/music-source.service.js";

describe("music source validation", () => {
  it("canonicalizes supported YouTube and Spotify URLs", () => {
    expect(parseMusicUrl("https://youtu.be/dQw4w9WgXcQ?si=ignored")).toMatchObject({
      provider: "YOUTUBE",
      kind: "track",
      id: "dQw4w9WgXcQ"
    });
    expect(
      parseMusicUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLignored")
    ).toMatchObject({
      provider: "YOUTUBE",
      kind: "track"
    });
    expect(parseMusicUrl("https://www.youtube.com/playlist?list=PL1234567890")).toMatchObject({
      provider: "YOUTUBE",
      kind: "playlist",
      id: "PL1234567890"
    });
    expect(
      parseMusicUrl("https://open.spotify.com/intl-fr/track/4uLU6hMCjMI75M1A2tKUQC?si=ignored")
    ).toMatchObject({
      provider: "SPOTIFY",
      kind: "track",
      id: "4uLU6hMCjMI75M1A2tKUQC"
    });
  });

  it.each([
    "http://youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
    "https://user:pass@youtube.com/watch?v=dQw4w9WgXcQ",
    "https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy",
    "file:///tmp/audio.mp3",
    "$(touch hacked)"
  ])("rejects unsupported or injection-like input: %s", (value) => {
    expect(() => parseMusicUrl(value)).toThrow(ApiError);
  });

  it("ranks title, artist, and close duration while rejecting distant duration", () => {
    const strong = scoreSpotifyMatch("Blinding Lights", "The Weeknd", 200, {
      title: "The Weeknd - Blinding Lights (Official Audio)",
      uploader: "The Weeknd",
      duration: 202
    });
    const wrongDuration = scoreSpotifyMatch("Blinding Lights", "The Weeknd", 200, {
      title: "The Weeknd - Blinding Lights",
      uploader: "The Weeknd",
      duration: 250
    });
    expect(strong).toBeGreaterThan(0.8);
    expect(wrongDuration).toBe(0);
  });
});
