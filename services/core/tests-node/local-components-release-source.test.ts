import { waitUntil } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildLocalComponentsAvailabilityCatalog,
  CLI_STABLE_MANIFEST_OBJECT_KEY,
  CLI_WINDOWS_PREVIEW_MANIFEST_OBJECT_KEY,
  getCachedCoreLocalComponentsRelease,
  LOCAL_COMPONENTS_RELEASE_OBJECT_KEY,
  readCoreLocalComponentsRelease,
  resetCoreLocalComponentsReleaseCacheForTests,
} from "../src/local-components/release-source";
import { resolveLocalComponentUpdateProjection } from "../src/local-components/update-projection";
import { PUBLISHED_LOCAL_COMPONENTS_MANIFEST } from "../test-support/published-local-components-release";

type Objects = Record<string, unknown>;

// R2Bucket.get returns null for a missing key and an object with json().
function createBucket(
  objects: Objects,
  beforeGet: (key: string) => Promise<unknown> = () => Promise.resolve()
) {
  const get = vi.fn(async (key: string) => {
    await beforeGet(key);
    if (objects[key] instanceof Error) {
      throw objects[key];
    }
    return Object.hasOwn(objects, key)
      ? { json: async () => structuredClone(objects[key]) }
      : null;
  });
  return { get } as unknown as R2Bucket & { get: typeof get };
}

function finishRefreshes() {
  return Promise.all(
    vi.mocked(waitUntil).mock.calls.map(([promise]) => promise)
  );
}

function projectService(
  release: Awaited<ReturnType<typeof readCoreLocalComponentsRelease>>
) {
  return resolveLocalComponentUpdateProjection({
    generatedAt: new Date().toISOString(),
    release,
    serviceConnected: true,
    serviceVersion: "0.3.264",
  }).service;
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
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T00:00:00.000Z"));
  });

  afterEach(() => {
    resetCoreLocalComponentsReleaseCacheForTests();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each([
    CLI_STABLE_MANIFEST_OBJECT_KEY,
    CLI_WINDOWS_PREVIEW_MANIFEST_OBJECT_KEY,
  ])("returns required policy without waiting for %s, then derives availability", async (slowKey) => {
    const channelRead = Promise.withResolvers<void>();
    const bucket = createBucket(
      {
        [LOCAL_COMPONENTS_RELEASE_OBJECT_KEY]:
          PUBLISHED_LOCAL_COMPONENTS_MANIFEST,
        [CLI_STABLE_MANIFEST_OBJECT_KEY]: STABLE_CHANNEL,
      },
      (key) => (key === slowKey ? channelRead.promise : Promise.resolve())
    );
    const release = await readCoreLocalComponentsRelease(bucket);
    expect(release.manifest).toEqual(PUBLISHED_LOCAL_COMPONENTS_MANIFEST);
    expect(release.availabilityCatalog).toBeNull();
    channelRead.resolve();
    await finishRefreshes();
    expect(
      (await readCoreLocalComponentsRelease(bucket)).availabilityCatalog
        ?.entries
    ).toEqual([
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
    expect(projectService(release)).toMatchObject({
      wakeBlocked: true,
      reasonCodes: ["local_components.release_manifest_invalid"],
    });
  });

  it.each([
    { schemaVersion: 2 },
    new Error("R2 timeout"),
  ])("fails closed without a validated policy (%s)", async (source) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const release = await readCoreLocalComponentsRelease(
      createBucket({
        [LOCAL_COMPONENTS_RELEASE_OBJECT_KEY]: source,
      })
    );
    expect(release.manifest).toBeNull();
    expect(projectService(release).wakeBlocked).toBe(true);
  });

  it("serves valid policy during one shared refresh and never extends its expiry on repeated failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const objects: Objects = {
      [LOCAL_COMPONENTS_RELEASE_OBJECT_KEY]:
        PUBLISHED_LOCAL_COMPONENTS_MANIFEST,
    };
    let blockPolicy = false;
    const policyRead = Promise.withResolvers<void>();
    const bucket = createBucket(objects, (key) =>
      blockPolicy && key === LOCAL_COMPONENTS_RELEASE_OBJECT_KEY
        ? policyRead.promise
        : Promise.resolve()
    );
    await readCoreLocalComponentsRelease(bucket);
    await finishRefreshes();
    vi.setSystemTime(Date.now() + 29_999);
    await readCoreLocalComponentsRelease(bucket);
    expect(bucket.get).toHaveBeenCalledTimes(3);

    blockPolicy = true;
    vi.setSystemTime(Date.now() + 1);
    const duringRefresh = await Promise.all(
      Array.from({ length: 5 }, () => readCoreLocalComponentsRelease(bucket))
    );
    expect(duringRefresh.every(({ manifest }) => manifest !== null)).toBe(true);
    expect(
      bucket.get.mock.calls.filter(
        ([key]) => key === LOCAL_COMPONENTS_RELEASE_OBJECT_KEY
      )
    ).toHaveLength(2);

    objects[LOCAL_COMPONENTS_RELEASE_OBJECT_KEY] = new Error("R2 timeout");
    policyRead.resolve();
    await finishRefreshes();
    vi.setSystemTime(Date.now() + 20_000);
    expect(
      (await readCoreLocalComponentsRelease(bucket)).manifest
    ).not.toBeNull();
    await finishRefreshes();
    vi.setSystemTime(Date.now() + 10_000);
    expect(
      projectService(getCachedCoreLocalComponentsRelease()).wakeBlocked
    ).toBe(true);
    expect(
      projectService(await readCoreLocalComponentsRelease(bucket)).wakeBlocked
    ).toBe(true);
    await finishRefreshes();
    vi.setSystemTime(Date.now() + 10_000);
    expect(
      projectService(await readCoreLocalComponentsRelease(bucket)).wakeBlocked
    ).toBe(true);
    await finishRefreshes();

    objects[LOCAL_COMPONENTS_RELEASE_OBJECT_KEY] =
      PUBLISHED_LOCAL_COMPONENTS_MANIFEST;
    vi.setSystemTime(Date.now() + 10_000);
    expect((await readCoreLocalComponentsRelease(bucket)).manifest).toEqual(
      PUBLISHED_LOCAL_COMPONENTS_MANIFEST
    );
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

  it.each([
    "pending",
    "failed",
  ] as const)("refreshes required policy independently of a %s preview channel", async (channelState) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const objects: Objects = {
      [LOCAL_COMPONENTS_RELEASE_OBJECT_KEY]:
        PUBLISHED_LOCAL_COMPONENTS_MANIFEST,
    };
    const channelRead = Promise.withResolvers<void>();
    const bucket = createBucket(objects, (key) =>
      key === CLI_WINDOWS_PREVIEW_MANIFEST_OBJECT_KEY
        ? channelRead.promise
        : Promise.resolve()
    );
    await readCoreLocalComponentsRelease(bucket);
    const required = structuredClone(PUBLISHED_LOCAL_COMPONENTS_MANIFEST);
    required.components.service.bundleVersion = "0.3.265";
    required.components.service.updatePolicy = "required";
    objects[LOCAL_COMPONENTS_RELEASE_OBJECT_KEY] = required;
    vi.setSystemTime(Date.now() + 30_000);
    const previousTaskCount = vi.mocked(waitUntil).mock.calls.length;
    expect((await readCoreLocalComponentsRelease(bucket)).manifest).toEqual(
      PUBLISHED_LOCAL_COMPONENTS_MANIFEST
    );
    await Promise.all(
      vi
        .mocked(waitUntil)
        .mock.calls.slice(previousTaskCount)
        .map(([promise]) => promise)
    );
    const release = await readCoreLocalComponentsRelease(bucket);
    expect(release.manifest).toEqual(required);
    expect(release.availabilityCatalog).toBeNull();
    const projection = resolveLocalComponentUpdateProjection({
      generatedAt: "2026-10-18T00:00:00.000Z",
      release,
      serviceConnected: true,
      serviceVersion: "0.3.264",
    });
    expect(projection.service.wakeBlocked).toBe(true);
    if (channelState === "failed") {
      objects[CLI_WINDOWS_PREVIEW_MANIFEST_OBJECT_KEY] = new Error(
        "R2 timeout"
      );
    }
    channelRead.resolve();
    await finishRefreshes();
    expect(getCachedCoreLocalComponentsRelease().manifest).toEqual(required);
    vi.setSystemTime(Date.now() + 30_000);
    expect(
      getCachedCoreLocalComponentsRelease().availabilityCatalog
    ).toBeNull();
  });
});
