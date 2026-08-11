import { describe, expect, it } from "vitest";
import {
  resolveInformationStatusBadgeClassName,
  resolveStatusToneAdvisoryBadgeClassName,
  resolveStatusToneAttentionItemClassName,
  resolveStatusToneBadgeClassName,
  resolveStatusToneCompactBadgeClassName,
  resolveStatusToneIconClassName,
  resolveStatusToneIndicatorClassName,
  resolveStatusToneInteractiveTextClassName,
  resolveStatusToneOpaqueWarningSurfaceClassName,
  resolveStatusToneOutlineActionClassName,
  resolveStatusToneOutlineBadgeClassName,
  resolveStatusToneProminentBadgeClassName,
  resolveStatusToneProminentSurfaceClassName,
  resolveStatusToneQuietTextClassName,
  resolveStatusToneRingIndicatorClassName,
  resolveStatusToneSoftTextClassName,
  resolveStatusToneStrongBadgeClassName,
  resolveStatusToneStrongTextClassName,
  resolveStatusToneSurfaceClassName,
  resolveStatusToneTintClassName,
  resolveStatusToneVerificationIconClassName,
  resolveStatusToneWarningNoticeClassName,
} from "#lib/status-tone";

describe("status tone theme pairs", () => {
  it("keeps Found visually distinct from the blue Checking state", () => {
    expect(resolveStatusToneBadgeClassName("found")).toContain("violet");
    expect(resolveStatusToneBadgeClassName("found")).not.toContain("sky");
    expect(resolveStatusToneSurfaceClassName("found", "subtle")).toContain(
      "violet"
    );
  });

  it("keeps the existing dark prominent badge colors", () => {
    expect(resolveStatusToneProminentBadgeClassName("ready")).toContain(
      "dark:text-emerald-200"
    );
    expect(resolveStatusToneProminentBadgeClassName("warning")).toContain(
      "dark:text-amber-200"
    );
    expect(resolveInformationStatusBadgeClassName()).toContain(
      "dark:text-blue-200"
    );
    expect(resolveStatusToneAdvisoryBadgeClassName()).toContain(
      "dark:text-amber-100"
    );
    expect(resolveStatusToneCompactBadgeClassName("ready")).toContain(
      "dark:border-emerald-500/35"
    );
    expect(resolveStatusToneStrongBadgeClassName("ready")).toContain(
      "dark:text-emerald-300"
    );
    expect(resolveStatusToneWarningNoticeClassName()).toContain(
      "dark:text-amber-300"
    );
    expect(resolveStatusToneOpaqueWarningSurfaceClassName()).toContain(
      "dark:bg-amber-50"
    );
    expect(resolveStatusToneOutlineBadgeClassName("checking")).toContain(
      "dark:border-sky-300/35"
    );
  });

  it("keeps paired status surfaces and tints in one resolver", () => {
    expect(resolveStatusToneProminentSurfaceClassName("ready")).toContain(
      "dark:border-emerald-500/40"
    );
    expect(resolveStatusToneSurfaceClassName("warning")).toContain(
      "dark:bg-amber-500/5"
    );
    expect(resolveStatusToneSurfaceClassName("ready", "subtle")).toContain(
      "dark:bg-emerald-500/[0.03]"
    );
    expect(resolveStatusToneTintClassName("checking")).toContain(
      "dark:bg-sky-500/5"
    );
  });

  it("preserves the existing dark text, icon, and indicator shades", () => {
    expect(resolveStatusToneStrongTextClassName("warning")).toContain(
      "dark:text-amber-300"
    );
    expect(resolveStatusToneSoftTextClassName("checking")).toContain(
      "dark:text-sky-200"
    );
    expect(resolveStatusToneIconClassName("ready")).toContain(
      "dark:text-emerald-400"
    );
    expect(resolveStatusToneIconClassName("ready", "quiet")).toContain(
      "dark:text-emerald-600"
    );
    expect(resolveStatusToneIndicatorClassName("warning")).toContain(
      "dark:bg-amber-300"
    );
    expect(resolveStatusToneIndicatorClassName("checking", "quiet")).toContain(
      "dark:bg-sky-400"
    );
    expect(resolveStatusToneIndicatorClassName("ready", "solid")).toContain(
      "dark:bg-emerald-500"
    );
    expect(resolveStatusToneIndicatorClassName("ready", "prominent")).toContain(
      "dark:bg-emerald-300"
    );
    expect(resolveStatusToneRingIndicatorClassName("ready")).toContain(
      "dark:ring-emerald-500/20"
    );
    expect(resolveStatusToneQuietTextClassName("warning")).toContain(
      "dark:text-amber-700"
    );
    expect(resolveStatusToneAttentionItemClassName("warning")).toContain(
      "dark:!text-amber-300"
    );
    expect(resolveStatusToneInteractiveTextClassName("warning")).toContain(
      "dark:hover:text-amber-200"
    );
    expect(resolveStatusToneOutlineActionClassName("warning")).toContain(
      "dark:border-amber-300/35"
    );
    expect(resolveStatusToneVerificationIconClassName("warning")).toContain(
      "dark:text-orange-500"
    );
  });
});
