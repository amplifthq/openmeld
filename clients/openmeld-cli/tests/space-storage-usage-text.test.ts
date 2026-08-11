import { describe, expect, it } from "vitest";
import {
  formatStorageUsageDetailText,
  formatStorageUsageSummaryText,
} from "../src/space/view/space-storage-usage-text";

describe("space storage usage text", () => {
  it("keeps the compact summary format for composer surfaces", () => {
    expect(
      formatStorageUsageSummaryText({
        usedBytes: 393_000,
        usagePercent: 0,
      })
    ).toBe("393 KB ( 0% used )");
  });

  it("adds the soft limit to detail surfaces when it is available", () => {
    expect(
      formatStorageUsageDetailText({
        usedBytes: 393_000,
        softLimitBytes: 9_000_000_000,
        usagePercent: 0,
      })
    ).toBe("393 KB / 9 GB ( 0% used )");
  });

  it("falls back to the compact format when the soft limit is unavailable", () => {
    expect(
      formatStorageUsageDetailText({
        usedBytes: 393_000,
        softLimitBytes: null,
        usagePercent: 0,
      })
    ).toBe("393 KB ( 0% used )");
  });
});
