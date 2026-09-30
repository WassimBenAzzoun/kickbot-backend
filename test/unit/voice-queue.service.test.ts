import { describe, expect, it } from "vitest";
import { totalPacketDuration } from "../../src/instants/voice-queue/voice-queue.service.js";

describe("instant audio duration parsing", () => {
  it("sums ffprobe packet durations from a non-seekable audio stream", () => {
    expect(totalPacketDuration("0.026122\n0.026122\n0.013061\n")).toBeCloseTo(0.065305);
  });

  it("ignores ffprobe metadata and rejects output without timed audio packets", () => {
    expect(totalPacketDuration("N/A\n\nmetadata\n")).toBeNull();
  });
});
