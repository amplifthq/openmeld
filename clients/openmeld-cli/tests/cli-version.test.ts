import { describe, expect, it } from "vitest";
import packageJson from "../package.json";
import {
  formatCliVersionSummary,
  getCliVersionInfo,
} from "../src/runtime/cli-version";

describe("cli version", () => {
  it("formats the current CLI version summary with the release date label", () => {
    const versionInfo = getCliVersionInfo();
    const expectedReleaseDate = packageJson.openMeldReleaseDate ?? null;
    const expectedReleaseDateLabel = expectedReleaseDate
      ? expectedReleaseDate.slice(5)
      : null;

    expect(versionInfo.releaseDate).toBe(expectedReleaseDate);
    expect(versionInfo.releaseDateLabel).toBe(expectedReleaseDateLabel);
    expect(versionInfo.summary).toBe(formatCliVersionSummary());
  });
});
