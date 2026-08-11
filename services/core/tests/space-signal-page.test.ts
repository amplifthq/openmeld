import { describe, expect, it } from "vitest";
import { resolveSignalsPageFromEntries } from "../src/space/transport/do/space";

function storageKey(ts: number, suffix: string): string {
  return `${new Date(ts).toISOString()}|${suffix}`;
}

function textSignalRaw(ts: number, signalId: string): string {
  return JSON.stringify({
    v: 1,
    id: signalId,
    spaceId: "space-test",
    ts,
    type: "signal.text",
    profile: {
      profileId: "profile-test",
      kind: "human",
      profileName: "Test User",
    },
    data: {
      text: `signal-${signalId}`,
    },
  });
}

describe("resolveSignalsPageFromEntries", () => {
  it("returns nextCursor null when read window is not full", () => {
    const result = resolveSignalsPageFromEntries({
      entries: [
        [storageKey(1, "a"), textSignalRaw(1, "sig-a")],
        [storageKey(2, "b"), textSignalRaw(2, "sig-b")],
      ],
      afterTs: null,
      limit: 2,
      readWindowFull: false,
    });

    expect(result.signals).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
  });

  it("uses page cursor when parsed payload exceeds limit", () => {
    const key1 = storageKey(1, "a");
    const key2 = storageKey(2, "b");
    const key3 = storageKey(3, "c");
    const result = resolveSignalsPageFromEntries({
      entries: [
        [key1, textSignalRaw(1, "sig-a")],
        [key2, textSignalRaw(2, "sig-b")],
        [key3, textSignalRaw(3, "sig-c")],
      ],
      afterTs: null,
      limit: 2,
      readWindowFull: true,
    });

    expect(result.signals).toHaveLength(2);
    expect(result.nextCursor).toBe(key2);
  });

  it("keeps nextCursor when read window is full but payload parse drops entries", () => {
    const key1 = storageKey(1, "a");
    const key2 = storageKey(2, "b");
    const key3 = storageKey(3, "c");
    const result = resolveSignalsPageFromEntries({
      entries: [
        [key1, textSignalRaw(1, "sig-a")],
        [key2, "{invalid-json"],
        [key3, "{still-invalid-json"],
      ],
      afterTs: null,
      limit: 2,
      readWindowFull: true,
    });

    expect(result.signals).toHaveLength(1);
    expect(result.nextCursor).toBe(key1);
  });

  it("uses the last scanned storage key when page has no valid signals", () => {
    const key1 = storageKey(1, "a");
    const key2 = storageKey(2, "b");
    const key3 = storageKey(3, "c");
    const result = resolveSignalsPageFromEntries({
      entries: [
        [key1, "{invalid-json"],
        [key2, "{still-invalid-json"],
        [key3, "{also-invalid-json"],
      ],
      afterTs: null,
      limit: 2,
      readWindowFull: true,
    });

    expect(result.signals).toEqual([]);
    expect(result.nextCursor).toBe(key3);
  });

  it("keeps nextCursor when cursor dedupe shrinks entry count but read window was full", () => {
    const key1 = storageKey(1, "a");
    const key2 = storageKey(2, "b");
    const result = resolveSignalsPageFromEntries({
      entries: [
        [key1, textSignalRaw(1, "sig-a")],
        [key2, "{invalid-json"],
      ],
      afterTs: null,
      limit: 2,
      // Simulates cursor mode where original read was full, then cursor entry
      // was removed before parsing.
      readWindowFull: true,
    });

    expect(result.signals).toHaveLength(1);
    expect(result.nextCursor).toBe(key1);
  });

  it("ignores legacy signal keys without delimiter suffix", () => {
    const legacyKey = new Date(1).toISOString();
    const validKey = storageKey(2, "b");

    const result = resolveSignalsPageFromEntries({
      entries: [
        [legacyKey, textSignalRaw(1, "sig-legacy")],
        [validKey, textSignalRaw(2, "sig-b")],
      ],
      afterTs: null,
      limit: 10,
      readWindowFull: false,
    });

    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]?.id).toBe("sig-b");
    expect(result.nextCursor).toBeNull();
  });
});
