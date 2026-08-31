import { describe, expect, it } from "vitest";
import {
  resolveFormalSpaceUpdatePreviewText,
  resolveSpaceStatusPreviewText,
  resolveVisibleTimelineSignalTypes,
  SPACE_STATUS_PREVIEW_MAX_CHARS,
  VISIBLE_SPACE_TIMELINE_SIGNAL_TYPES,
} from "../space/rules/formal-space-update";

describe("resolveVisibleTimelineSignalTypes", () => {
  it("defaults an unfiltered timeline read to every visible signal type", () => {
    expect(resolveVisibleTimelineSignalTypes([])).toEqual([
      "signal.text",
      "signal.status",
      "signal.system_notice",
    ]);
  });

  it("never defaults to operational presence signals", () => {
    const resolved = resolveVisibleTimelineSignalTypes([]);
    expect(resolved).not.toContain("presence.join");
    expect(resolved).not.toContain("presence.quit");
    expect(VISIBLE_SPACE_TIMELINE_SIGNAL_TYPES).not.toContain("presence.join");
  });

  it("preserves an explicit visible-type filter", () => {
    expect(resolveVisibleTimelineSignalTypes(["signal.text"])).toEqual([
      "signal.text",
    ]);
    expect(
      resolveVisibleTimelineSignalTypes([
        "signal.status",
        "signal.system_notice",
      ])
    ).toEqual(["signal.status", "signal.system_notice"]);
  });

  it("regression: presence churn cannot bury visible messages out of a recent window", () => {
    // Reproduces the production incident shape: a recent window whose newest
    // entries are dominated by presence.join/quit churn, with the real messages
    // older. With the visible-default filter applied at the read layer, only the
    // visible messages survive — the timeline can never render empty while
    // messages exist.
    const newestFirstStreamTypes = [
      ...Array.from({ length: 320 }, (_, index) =>
        index % 2 === 0 ? "presence.join" : "presence.quit"
      ),
      "signal.text",
      "signal.text",
    ];
    const allowedTypes = new Set<string>(resolveVisibleTimelineSignalTypes([]));
    const kept = newestFirstStreamTypes.filter((type) =>
      allowedTypes.has(type)
    );

    expect(kept).toEqual(["signal.text", "signal.text"]);
  });
});

describe("Space update previews", () => {
  it("bounds a long latest-update preview without splitting a character", () => {
    const signal = {
      type: "signal.text",
      data: {
        text: `${"a".repeat(SPACE_STATUS_PREVIEW_MAX_CHARS - 2)}😀tail`,
      },
    } as Parameters<typeof resolveFormalSpaceUpdatePreviewText>[0];
    const preview = resolveSpaceStatusPreviewText(signal);

    expect(preview).toHaveLength(SPACE_STATUS_PREVIEW_MAX_CHARS - 1);
    expect(preview).toBe(`${"a".repeat(SPACE_STATUS_PREVIEW_MAX_CHARS - 2)}…`);
    expect(preview).not.toContain("tail");
    expect(resolveFormalSpaceUpdatePreviewText(signal)).toContain("😀tail");
  });
});
