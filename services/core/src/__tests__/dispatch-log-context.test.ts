import { describe, expect, it } from "vitest";
import {
  buildDispatchHumanLogContext,
  buildDispatchTargetSummaryLabel,
  sanitizeSourceTextPreview,
} from "../dispatch/application/dispatch-log-context";

describe("dispatch log context", () => {
  it("builds human log context with queued and attempt ages", () => {
    expect(
      buildDispatchHumanLogContext({
        nowMs: 10_000,
        spaceName: "ops-room",
        targetLabel: "Step6 Codex",
        targetProfileName: "Codex Agent",
        sourceProfileName: "Felix",
        sourceText: "hello world",
        handedOffAtMs: 8000,
        lastAttemptAtMs: 9500,
      })
    ).toEqual({
      spaceName: "ops-room",
      targetProfileName: "Codex Agent",
      targetLabel: "Step6 Codex",
      sourceProfileName: "Felix",
      sourceTextPreview: "hello world",
      handoffAgeMs: 2000,
      lastAttemptAgeMs: 500,
    });
  });

  it("falls back to createdAt when queuedAt is missing", () => {
    expect(
      buildDispatchHumanLogContext({
        nowMs: 10_000,
        createdAtMs: 9000,
      }).handoffAgeMs
    ).toBe(1000);
  });

  it("sanitizes and truncates source text previews", () => {
    const longText = `hello\n${"x".repeat(200)}`;
    const preview = sanitizeSourceTextPreview(longText);

    expect(preview).not.toContain("\n");
    expect(preview?.length).toBeLessThanOrEqual(120);
    expect(preview?.endsWith("…")).toBe(true);
  });

  it("prefers target labels for target summary labels", () => {
    expect(
      buildDispatchTargetSummaryLabel({
        targetLabel: "Step6 Codex",
        targetProfileName: "Codex Agent",
        targetProfileId: "agt-1",
      })
    ).toBe("Step6 Codex");
  });
});
