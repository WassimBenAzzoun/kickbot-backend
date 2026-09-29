import { describe, expect, it } from "vitest";
import { normalizeUsername } from "../../src/streamers/streamers/streamers.service.js";

describe("normalizeUsername", () => {
  it("normalizes Kick handles for uniqueness", () => {
    expect(normalizeUsername("  @SomeStreamer ")).toBe("somestreamer");
  });
});
