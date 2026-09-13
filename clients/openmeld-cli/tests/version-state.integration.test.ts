import { readFile } from "node:fs/promises";
import type { CliBinaryManifest } from "@openmeld/schemas/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withTempHome } from "./helpers/fs";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const CLI_BINARY_MANIFEST_FIXTURE_URL = new URL(
  "./fixtures/cli-binary-manifest.stable.json",
  import.meta.url
);

describe("version state", () => {
  afterEach(() => {
    vi.doUnmock("../src/runtime/distribution");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.useRealTimers();
  });

  it("reuses cached latest version within TTL window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-25T00:00:00.000Z"));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: "1.2.3" }), {
        status: 200,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { fetchLatestPackageVersion } = await import(
      "../src/config/version-state"
    );
    const first = await fetchLatestPackageVersion("openmeld-cli-cache-test");

    vi.setSystemTime(new Date("2026-02-25T23:59:59.000Z"));
    const second = await fetchLatestPackageVersion("openmeld-cli-cache-test");

    expect(first).toBe("1.2.3");
    expect(second).toBe("1.2.3");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes latest version after cache TTL expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-25T00:00:00.000Z"));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ version: "1.2.3" }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ version: "1.2.4" }), {
          status: 200,
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const { fetchLatestPackageVersion } = await import(
      "../src/config/version-state"
    );

    const first = await fetchLatestPackageVersion("openmeld-cli-refresh-test");
    vi.setSystemTime(new Date(Date.now() + ONE_DAY_MS + 1000));
    const second = await fetchLatestPackageVersion("openmeld-cli-refresh-test");

    expect(first).toBe("1.2.3");
    expect(second).toBe("1.2.4");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("deduplicates concurrent in-flight version requests", async () => {
    let resolveFetch:
      | ((value: Response | PromiseLike<Response>) => void)
      | undefined;
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { fetchLatestPackageVersion } = await import(
      "../src/config/version-state"
    );

    const firstPromise = fetchLatestPackageVersion(
      "openmeld-cli-inflight-test"
    );
    const secondPromise = fetchLatestPackageVersion(
      "openmeld-cli-inflight-test"
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFetch?.(
      new Response(JSON.stringify({ version: "2.0.0" }), {
        status: 200,
      })
    );

    await expect(firstPromise).resolves.toBe("2.0.0");
    await expect(secondPromise).resolves.toBe("2.0.0");
  });

  it("does not cache failed fetch responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("registry unavailable", {
          status: 503,
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ version: "3.0.0" }), {
          status: 200,
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const { fetchLatestPackageVersion } = await import(
      "../src/config/version-state"
    );

    await expect(
      fetchLatestPackageVersion("openmeld-cli-failure-test")
    ).rejects.toThrow("version check failed");
    await expect(
      fetchLatestPackageVersion("openmeld-cli-failure-test")
    ).resolves.toBe("3.0.0");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reads version metadata with deprecated message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          version: "0.1.6",
          deprecated: "Use 0.1.7 instead.",
        }),
        {
          status: 200,
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const { fetchPackageVersionMetadata } = await import(
      "../src/config/version-state"
    );

    const metadata = await fetchPackageVersionMetadata({
      packageName: "openmeld",
      version: "0.1.6",
    });

    expect(metadata).toEqual({
      version: "0.1.6",
      deprecated: "Use 0.1.7 instead.",
    });
  });

  it("reads binary version gates from the CLI manifest route", async () => {
    vi.resetModules();
    vi.doMock("../src/runtime/distribution", () => ({
      isBinaryDistribution: () => true,
    }));
    vi.stubEnv(
      "OPENMELD_CLI_BINARY_MANIFEST_URL",
      "https://dev.openmeld.test/cli/manifest.json"
    );

    const manifestRaw = await readFile(CLI_BINARY_MANIFEST_FIXTURE_URL, "utf8");
    const manifest = JSON.parse(manifestRaw) as {
      channels: { stable: { version: string; minRequiredCliVersion: string } };
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(manifestRaw, {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { fetchLatestPackageInfo, fetchPackageVersionMetadata } =
      await import("../src/config/version-state");

    await expect(fetchLatestPackageInfo("openmeld")).resolves.toEqual({
      version: manifest.channels.stable.version,
      minRequiredCliVersion: manifest.channels.stable.minRequiredCliVersion,
    });
    await expect(
      fetchPackageVersionMetadata({
        packageName: "openmeld",
        version: manifest.channels.stable.version,
      })
    ).resolves.toEqual({
      version: manifest.channels.stable.version,
      deprecated: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://dev.openmeld.test/cli/manifest.json",
      expect.objectContaining({ method: "GET" })
    );
  });

  it.each([
    false,
    true,
  ])("reads binary release artifact metadata with an independent Service target: %s", async (independentService) => {
    vi.resetModules();
    vi.stubEnv(
      "OPENMELD_CLI_BINARY_MANIFEST_URL",
      "https://dev.openmeld.test/cli/manifest.json"
    );

    const manifestRaw = await readFile(CLI_BINARY_MANIFEST_FIXTURE_URL, "utf8");
    const manifest = JSON.parse(manifestRaw) as CliBinaryManifest;
    const cliArtifact = manifest.channels.stable.platforms["darwin-arm64"];
    if (!cliArtifact) {
      throw new Error("The captured manifest must include the test platform.");
    }
    if (independentService) {
      manifest.channels.stable.service = {
        version: "0.3.1",
        platforms: {
          "darwin-arm64": {
            ...cliArtifact,
            sha256: "b".repeat(64),
            url: "https://dev.openmeld.test/cli/download/openmeld-cli-darwin-arm64-0.3.1",
          },
        },
      };
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(manifest), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { fetchLatestCliBinaryRelease } = await import(
      "../src/config/version-state"
    );

    await expect(
      fetchLatestCliBinaryRelease({ platform: "darwin-arm64" })
    ).resolves.toEqual({
      version: manifest.channels.stable.version,
      minRequiredCliVersion: manifest.channels.stable.minRequiredCliVersion,
      platform: "darwin-arm64",
      ...manifest.channels.stable.platforms["darwin-arm64"],
      ...(independentService
        ? {
            service: {
              ...manifest.channels.stable.service?.platforms["darwin-arm64"],
              version: "0.3.1",
              platform: "darwin-arm64",
            },
          }
        : {}),
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://dev.openmeld.test/cli/manifest.json",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("rejects CLI manifests without the requested binary platform", async () => {
    vi.resetModules();
    vi.stubEnv(
      "OPENMELD_CLI_BINARY_MANIFEST_URL",
      "https://dev.openmeld.test/cli/manifest.json"
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            schemaVersion: 1,
            channels: {
              stable: {
                version: "9.9.9",
                minRequiredCliVersion: "0.1.3",
                platforms: {
                  "linux-x64": {
                    url: "https://openmeld.ai/cli/download/openmeld-cli-linux-x64-9.9.9",
                    sha256:
                      "95381a4f7a425eff7a79c05c446052c91eadd410af69249f912f60347918ebb0",
                    sizeBytes: 68_899_792,
                  },
                },
              },
            },
          }),
          { status: 200 }
        )
      )
    );

    const { fetchLatestCliBinaryRelease } = await import(
      "../src/config/version-state"
    );

    await expect(
      fetchLatestCliBinaryRelease({ platform: "darwin-arm64" })
    ).rejects.toThrow("missing platform darwin-arm64");
  });

  it("rejects malformed CLI manifests in binary distribution", async () => {
    vi.resetModules();
    vi.doMock("../src/runtime/distribution", () => ({
      isBinaryDistribution: () => true,
    }));
    vi.stubEnv(
      "OPENMELD_CLI_BINARY_MANIFEST_URL",
      "https://dev.openmeld.test/cli/manifest.json"
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ schemaVersion: 1, channels: {} }), {
          status: 200,
        })
      )
    );

    const { fetchLatestPackageInfo } = await import(
      "../src/config/version-state"
    );

    await expect(fetchLatestPackageInfo("openmeld")).rejects.toThrow(
      "invalid CLI manifest response"
    );
  });

  it("reuses cached version metadata within TTL window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-25T00:00:00.000Z"));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          version: "0.1.6",
          deprecated: "Use 0.1.7 instead.",
        }),
        {
          status: 200,
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const { fetchPackageVersionMetadata } = await import(
      "../src/config/version-state"
    );

    const first = await fetchPackageVersionMetadata({
      packageName: "openmeld-cli-meta-cache-test",
      version: "2.0.0",
    });
    vi.setSystemTime(new Date("2026-02-25T12:00:00.000Z"));
    const second = await fetchPackageVersionMetadata({
      packageName: "openmeld-cli-meta-cache-test",
      version: "2.0.0",
    });

    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("orders prerelease versions below stable release", async () => {
    const { compareSemver } = await import("../src/config/version-state");
    expect(compareSemver("1.0.0-beta", "1.0.0")).toBeLessThan(0);
    expect(compareSemver("1.0.0", "1.0.0-beta")).toBeGreaterThan(0);
  });

  it("compares prerelease identifiers with semver rules", async () => {
    const { compareSemver } = await import("../src/config/version-state");
    expect(compareSemver("1.0.0-alpha", "1.0.0-alpha.1")).toBeLessThan(0);
    expect(compareSemver("1.0.0-alpha.1", "1.0.0-alpha.beta")).toBeLessThan(0);
    expect(compareSemver("1.0.0-beta.2", "1.0.0-beta.11")).toBeLessThan(0);
    expect(compareSemver("1.0.0-beta", "1.0.0-alpha")).toBeGreaterThan(0);
    expect(compareSemver("1.0.0-rc.1", "1.0.0")).toBeLessThan(0);
  });

  it("falls back to lexical compare for non-semver values", async () => {
    const { compareSemver } = await import("../src/config/version-state");
    expect(compareSemver("latest", "1.0.0")).toBeGreaterThan(0);
  });

  it("initializes version state when metadata is missing", async () => {
    await withTempHome(async () => {
      const { ensureVersionStateReady, readVersionState } = await import(
        "../src/config/version-state"
      );

      expect(await readVersionState()).toBeNull();

      const versionState = await ensureVersionStateReady({
        currentVersion: "4.5.6",
      });

      expect(versionState.last_version).toBe("4.5.6");
      expect(versionState.latest_version).toBe("4.5.6");
      expect(await readVersionState()).toEqual(versionState);
    });
  });
});
