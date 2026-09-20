import { expect, it } from "vitest";
import { desktopCandidateManifestSchema } from "../src/desktop-release";

const base = {
  schemaVersion: 1,
  target: "production",
  version: "0.1.4",
  releaseSha: "b".repeat(40),
  sha256: "a".repeat(64),
  sizeBytes: 1024,
};
const windows = {
  sha512: `${"A".repeat(86)}==`,
  publisherName: "Fixture Publisher",
};

it.each([
  "windows-x64",
  "windows-arm64",
])("accepts an immutable signed-installer contract for %s", (platform) => {
  expect(
    desktopCandidateManifestSchema.parse({ ...base, platform, windows })
  ).toMatchObject({ platform, windows });
});
it.each([
  { platform: "windows-x64" },
  { platform: "windows-arm64", windows: { ...windows, publisherName: "" } },
  { platform: "windows-x64", windows: { ...windows, sha512: "invalid" } },
  { platform: "macos-arm64", windows },
  { platform: "windows-ia32", windows },
  {
    platform: "windows-x64",
    windows,
    zip: { sha256: "c".repeat(64), sha512: windows.sha512, sizeBytes: 256 },
  },
])("rejects incomplete, ambiguous, or cross-platform metadata: %o", (fields) => {
  expect(
    desktopCandidateManifestSchema.safeParse({ ...base, ...fields }).success
  ).toBe(false);
});
it("preserves the legacy Mac candidate's exact shape", () => {
  const mac = { ...base, platform: "macos-arm64" };
  expect(desktopCandidateManifestSchema.parse(mac)).toEqual(mac);
});
