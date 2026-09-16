import { describe, expect, it } from "vitest";
import {
  cliBinaryCompressedReleaseSchema,
  cliBinaryDeltaPatchSchema,
  cliBinaryManifestSchema,
} from "../../src/schemas";

const RELEASE = {
  sha256: "a".repeat(64),
  sizeBytes: 73_287_266,
  url: "https://openmeld.ai/cli/download/openmeld-cli-darwin-arm64-0.3.19",
};

describe("CLI binary manifest schema", () => {
  it("preserves a separately selected Service artifact and rejects incomplete targets", () => {
    const legacy = buildManifest(RELEASE);
    const service = {
      version: "0.3.18",
      platforms: {
        "darwin-arm64": {
          ...RELEASE,
          sha256: "c".repeat(64),
          url: "https://openmeld.ai/cli/download/openmeld-cli-darwin-arm64-0.3.18",
        },
      },
    };
    const manifest = {
      ...legacy,
      channels: { stable: { ...legacy.channels.stable, service } },
    };
    const parsed = cliBinaryManifestSchema.parse(manifest);
    expect(parsed.channels.stable.version).toBe("0.3.19");
    expect(parsed.channels.stable.service).toEqual(service);
    expect(
      cliBinaryManifestSchema.safeParse({
        ...manifest,
        channels: {
          stable: {
            ...manifest.channels.stable,
            service: { version: "0.3.18" },
          },
        },
      }).success
    ).toBe(false);
    expect(
      cliBinaryManifestSchema.safeParse({
        ...manifest,
        channels: {
          stable: {
            ...manifest.channels.stable,
            service: {
              ...service,
              platforms: { "linux-x64": RELEASE },
            },
          },
        },
      }).success
    ).toBe(false);
  });
  it("accepts both legacy raw releases and the additive gzip transport", () => {
    const legacy = buildManifest(RELEASE);
    const compressed = buildManifest({
      ...RELEASE,
      archiveFormat: "gzip",
      archiveSha256: "b".repeat(64),
      archiveSizeBytes: 26_482_975,
      archiveUrl: `${RELEASE.url}.gz`,
    });

    expect(cliBinaryManifestSchema.safeParse(legacy).success).toBe(true);
    expect(cliBinaryManifestSchema.safeParse(compressed).success).toBe(true);
  });

  it("rejects an empty platform map", () => {
    expect(
      cliBinaryManifestSchema.safeParse(buildManifest(undefined)).success
    ).toBe(false);
  });

  it("rejects a partial gzip transport record", () => {
    expect(
      cliBinaryManifestSchema.safeParse(
        buildManifest({
          ...RELEASE,
          archiveFormat: "gzip",
          archiveUrl: `${RELEASE.url}.gz`,
        })
      ).success
    ).toBe(false);
  });

  it("requires every gzip field when a release gate needs compressed transport", () => {
    expect(cliBinaryCompressedReleaseSchema.safeParse(RELEASE).success).toBe(
      false
    );
    expect(
      cliBinaryCompressedReleaseSchema.safeParse({
        ...RELEASE,
        archiveFormat: "gzip",
        archiveSha256: "b".repeat(64),
        archiveSizeBytes: 26_482_975,
        archiveUrl: `${RELEASE.url}.gz`,
      }).success
    ).toBe(true);
  });

  it("accepts an exact-base delta and signed target identity", () => {
    const manifest = buildManifest({
      ...RELEASE,
      codeIdentifier: "sh.openmeld.cli",
      teamIdentifier: "38FFHDPA3B",
      deltas: [
        {
          fromSha256: "b".repeat(64),
          fromSizeBytes: 72_000_000,
          fromVersion: "0.3.18",
          patchCompression: "gzip",
          patchFormat: "block-ranges-v1",
          patchPayloadSizeBytes: 4_100_000,
          patchSha256: "c".repeat(64),
          patchSizeBytes: 990_000,
          patchUrl: `${RELEASE.url}-delta-from-0.3.18.gz`,
        },
      ],
    });

    expect(cliBinaryManifestSchema.safeParse(manifest).success).toBe(true);
    expect(
      cliBinaryDeltaPatchSchema.safeParse({
        baseSha256: "b".repeat(64),
        baseSizeBytes: 72_000_000,
        blockSizeBytes: 4096,
        patchFormat: "block-ranges-v1",
        schemaVersion: 1,
        segments: [{ dataBase64: "d2FrZWxvb3A=", offset: 4096 }],
        targetSha256: "a".repeat(64),
        targetSizeBytes: RELEASE.sizeBytes,
      }).success
    ).toBe(true);
  });

  it("rejects partial signature identity and duplicate delta bases", () => {
    expect(
      cliBinaryManifestSchema.safeParse(
        buildManifest({ ...RELEASE, codeIdentifier: "sh.openmeld.cli" })
      ).success
    ).toBe(false);

    const delta = {
      fromSha256: "b".repeat(64),
      fromSizeBytes: 72_000_000,
      fromVersion: "0.3.18",
      patchCompression: "gzip",
      patchFormat: "block-ranges-v1",
      patchPayloadSizeBytes: 4_100_000,
      patchSha256: "c".repeat(64),
      patchSizeBytes: 990_000,
      patchUrl: `${RELEASE.url}-delta-from-0.3.18.gz`,
    } as const;
    expect(
      cliBinaryManifestSchema.safeParse(
        buildManifest({ ...RELEASE, deltas: [delta, delta] })
      ).success
    ).toBe(false);
  });

  it("validates a release-sized base64 segment without overflowing the parser", () => {
    const releaseSizedBase64 = Buffer.alloc(4 * 1024 * 1024, 0x61).toString(
      "base64"
    );

    expect(() =>
      cliBinaryDeltaPatchSchema.parse({
        baseSha256: "b".repeat(64),
        baseSizeBytes: 72_000_000,
        blockSizeBytes: 4096,
        patchFormat: "block-ranges-v1",
        schemaVersion: 1,
        segments: [{ dataBase64: releaseSizedBase64, offset: 0 }],
        targetSha256: "a".repeat(64),
        targetSizeBytes: 73_000_000,
      })
    ).not.toThrow();
  });
});

function buildManifest(release: unknown) {
  return {
    channels: {
      stable: {
        minRequiredCliVersion: "0.3.8",
        platforms: release === undefined ? {} : { "darwin-arm64": release },
        version: "0.3.19",
      },
    },
    schemaVersion: 1,
  };
}
