import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildLocalComponentsAvailabilityCatalog,
  CLI_STABLE_MANIFEST_OBJECT_KEY,
  LOCAL_COMPONENTS_RELEASE_OBJECT_KEY,
  readCoreLocalComponentsRelease,
  resetCoreLocalComponentsReleaseCacheForTests,
} from "../src/local-components/release-source";
import { resolveLocalComponentUpdateProjection } from "../src/local-components/update-projection";
import { PUBLISHED_LOCAL_COMPONENTS_MANIFEST } from "../test-support/published-local-components-release";

type Objects = Record<string, unknown>;

// R2Bucket.get returns null for a missing key and an object with json().
function createBucket(objects: Objects) {
  const get = vi.fn(async (key: string) => {
    await Promise.resolve();
    if (objects[key] instanceof Error) {
      throw objects[key];
    }
    return Object.hasOwn(objects, key)
      ? { json: async () => structuredClone(objects[key]) }
      : null;
  });
  return { get } as unknown as R2Bucket & { get: typeof get };
}

const STABLE_CHANNEL = {
  schemaVersion: 1,
  channels: {
    stable: {
      version: "0.3.264",
      minRequiredCliVersion: "0.3.200",
      platforms: {
        "darwin-arm64": {
          url: "https://openmeld.ai/cli/download/openmeld-cli-darwin-arm64-0.3.264",
          sha256: "a".repeat(64),
          sizeBytes: 1,
        },
      },
    },
  },
};

describe("published CLI release read by Core", () => {
  afterEach(() => {
    resetCoreLocalComponentsReleaseCacheForTests();
    vi.restoreAllMocks();
  });

  it("reads the published manifest and derives the stable availability catalog", async () => {
    const release = await readCoreLocalComponentsRelease(
      createBucket({
        [LOCAL_COMPONENTS_RELEASE_OBJECT_KEY]:
          PUBLISHED_LOCAL_COMPONENTS_MANIFEST,
        [CLI_STABLE_MANIFEST_OBJECT_KEY]: STABLE_CHANNEL,
      })
    );
    expect(release.manifest).toEqual(PUBLISHED_LOCAL_COMPONENTS_MANIFEST);
    expect(release.availabilityCatalog?.entries).toEqual([
      {
        channel: "stable",
        platform: "darwin-arm64",
        policy: {
          cli: PUBLISHED_LOCAL_COMPONENTS_MANIFEST.components.cli,
          service: PUBLISHED_LOCAL_COMPONENTS_MANIFEST.components.service,
        },
      },
    ]);
  });

  it("fails closed and blocks Wake when the manifest was never seeded", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const release = await readCoreLocalComponentsRelease(createBucket({}));
    expect(release.manifest).toBeNull();
    expect(error).toHaveBeenCalledWith(
      "[core.local_components.release_manifest_missing]",
      expect.objectContaining({
        next: expect.stringContaining("publish-cli.mjs seed-manifest"),
      })
    );
    const projection = resolveLocalComponentUpdateProjection({
      generatedAt: "2026-10-18T00:00:00.000Z",
      release,
      serviceConnected: true,
      serviceVersion: "0.3.264",
    });
    expect(projection.service).toMatchObject({
      wakeBlocked: true,
      reasonCodes: ["local_components.release_manifest_invalid"],
    });
  });

  it("rejects an invalid manifest instead of guessing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const release = await readCoreLocalComponentsRelease(
      createBucket({
        [LOCAL_COMPONENTS_RELEASE_OBJECT_KEY]: { schemaVersion: 2 },
      })
    );
    expect(release.manifest).toBeNull();
  });

  it("caches one read per minute and keeps the last valid manifest across a read failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const objects: Objects = {
      [LOCAL_COMPONENTS_RELEASE_OBJECT_KEY]:
        PUBLISHED_LOCAL_COMPONENTS_MANIFEST,
    };
    const bucket = createBucket(objects);
    await readCoreLocalComponentsRelease(bucket, 1000);
    await readCoreLocalComponentsRelease(bucket, 30_000);
    expect(bucket.get).toHaveBeenCalledTimes(3);

    objects[LOCAL_COMPONENTS_RELEASE_OBJECT_KEY] = new Error("R2 timeout");
    const retained = await readCoreLocalComponentsRelease(bucket, 70_000);
    expect(retained.manifest).toEqual(PUBLISHED_LOCAL_COMPONENTS_MANIFEST);
  });

  it("never borrows the global policy for a channel that selects other versions", () => {
    const stale = structuredClone(STABLE_CHANNEL);
    stale.channels.stable.version = "0.3.263";
    expect(
      buildLocalComponentsAvailabilityCatalog({
        release: PUBLISHED_LOCAL_COMPONENTS_MANIFEST,
        stableManifest: stale,
        previewManifest: null,
      })?.entries
    ).toEqual([]);
  });
});
