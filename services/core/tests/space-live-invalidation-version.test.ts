import { describe, expect, it } from "vitest";
import { resolveNextLiveInvalidationVersion } from "../src/space/transport/do/space";

describe("space live invalidation versions", () => {
  it("keeps post-restart frames above the browser high-water mark", () => {
    const firstVersion = resolveNextLiveInvalidationVersion({
      inMemoryLastVersion: 0,
      nowMs: 1_772_000_000_000,
      storedLastVersion: 0,
    });
    const browserHighWaterMark = firstVersion;

    const postRestartVersion = resolveNextLiveInvalidationVersion({
      inMemoryLastVersion: 0,
      nowMs: 1_772_000_000_001,
      storedLastVersion: firstVersion,
    });

    expect(postRestartVersion).toBeGreaterThan(browserHighWaterMark);
  });

  it("uses the persisted version when wall clock moves backward after restart", () => {
    const postRestartVersion = resolveNextLiveInvalidationVersion({
      inMemoryLastVersion: 0,
      nowMs: 100,
      storedLastVersion: 1_772_000_000_000,
    });

    expect(postRestartVersion).toBe(1_772_000_000_001);
  });
});
