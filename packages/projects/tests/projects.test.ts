import { describe, expect, it } from "vitest";
import {
  buildCanonicalRepositoryUrl,
  buildRepositoryFingerprint,
  generateProjectSlug,
  normalizeRepositoryRemote,
} from "../src/index";

describe("generateProjectSlug", () => {
  it.each([
    ["  OpenMeld Web  ", "openmeld-web"],
    ["Café Tools", "cafe-tools"],
    ["Project !!!", "project"],
    ["中文", "project"],
    ["one___two...three", "one-two-three"],
  ])("normalizes %j to %j", (name, expected) => {
    expect(generateProjectSlug(name)).toBe(expected);
  });

  it("limits the slug to 80 characters without leaving a trailing hyphen", () => {
    expect(generateProjectSlug(`${"a".repeat(79)} tail`)).toBe("a".repeat(79));
    expect(generateProjectSlug("a".repeat(100))).toBe("a".repeat(80));
  });

  it("counts automatic conflict suffixes within the 80-character limit", () => {
    expect(generateProjectSlug("a".repeat(100), 2)).toBe(`${"a".repeat(78)}-2`);
    expect(generateProjectSlug("a".repeat(100), 99)).toBe(
      `${"a".repeat(77)}-99`
    );
    expect(generateProjectSlug("openmeld", 100)).toBeNull();
  });
});

describe("normalizeRepositoryRemote", () => {
  it.each([
    [
      "https://github.com/OpenMeld/OpenMeld.git",
      "github.com/openmeld/openmeld",
    ],
    [
      "ssh://git@github.com/OpenMeld/OpenMeld.git",
      "github.com/openmeld/openmeld",
    ],
    ["git@github.com:OpenMeld/OpenMeld.git", "github.com/openmeld/openmeld"],
    ["git://github.com/OpenMeld/OpenMeld.GIT/", "github.com/openmeld/openmeld"],
    [
      "https://token:secret@github.com/OpenMeld/OpenMeld.git",
      "github.com/openmeld/openmeld",
    ],
    [
      "https://github.com/OpenMeld/OpenMeld.git?ref=main#readme",
      "github.com/openmeld/openmeld",
    ],
    ["https://example.com:8443/Org/Repo.git", "example.com:8443/Org/Repo"],
    ["https://example.com:443/Org/Repo.git", "example.com/Org/Repo"],
    ["ssh://git@example.com:2222/Org/Repo.git", "example.com:2222/Org/Repo"],
    ["https://gitlab.com/Group/Repo.git", "gitlab.com/group/repo"],
    ["https://bitbucket.org/Team/Repo.git", "bitbucket.org/team/repo"],
    ["https://example.com/Team/Repo.git", "example.com/Team/Repo"],
    ["https://example.com/Cafe\u0301/Repo.git", "example.com/Café/Repo"],
  ])("normalizes %j", (remote, expected) => {
    expect(normalizeRepositoryRemote(remote)).toBe(expected);
  });

  it.each([
    "file:///Users/felix/private/repo",
    "file:/Users/felix/private/repo",
    "file:relative/repo",
    "/Users/felix/private/repo",
    "C:\\Users\\felix\\private\\repo",
    "\\\\server\\share\\private",
    "relative/repository",
    "ftp://example.com/team/repository.git",
  ])("rejects non-network remote %j", (remote) => {
    expect(normalizeRepositoryRemote(remote)).toBeNull();
  });

  it("preserves path case for unknown hosts while normalizing Unicode to NFC", () => {
    expect(
      normalizeRepositoryRemote("git@example.com:Team/Cafe\u0301.git")
    ).toBe("example.com/Team/Café");
  });
});

describe("buildCanonicalRepositoryUrl", () => {
  it.each([
    [
      "git@GitHub.com:AmpliftHQ/OpenMeld.git",
      "https://github.com/amplifthq/openmeld",
    ],
    [
      "https://token:secret@example.com:8443/Team/Repo.git?ref=main#readme",
      "https://example.com:8443/Team/Repo",
    ],
  ])("returns a safe display URL for %j", (remote, expected) => {
    expect(buildCanonicalRepositoryUrl(remote)).toBe(expected);
  });

  it("rejects local paths instead of turning them into cloud identity", () => {
    expect(
      buildCanonicalRepositoryUrl("/Users/felix/work/openmeld")
    ).toBeNull();
  });
});

describe("buildRepositoryFingerprint", () => {
  it("returns one stable Web Crypto fingerprint across supported remote forms", async () => {
    const expected =
      "sha256:e30476efa5330cb21783194d8f716f4da5df2deafb1f425906395eb5f8f09cd9";
    await expect(
      buildRepositoryFingerprint("https://github.com/OpenMeld/OpenMeld.git")
    ).resolves.toBe(expected);
    await expect(
      buildRepositoryFingerprint("ssh://git@github.com/OpenMeld/OpenMeld.git")
    ).resolves.toBe(expected);
    await expect(
      buildRepositoryFingerprint("git@github.com:OpenMeld/OpenMeld.git")
    ).resolves.toBe(expected);
  });

  it("returns null for a rejected remote", async () => {
    await expect(
      buildRepositoryFingerprint("/tmp/repository")
    ).resolves.toBeNull();
  });
});
