import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import packageJson from "../package.json";
import {
  assessCliUpdate,
  isCliUpdateCheckApplicable,
} from "../src/command-entry-checks/cli-update-assessment";
import type { OpenMeldEnvironmentTarget } from "../src/config/openmeld-environment-target";
import {
  readVersionState,
  resetVersionCheckCacheForTests,
  writeVersionState,
} from "../src/config/version-state";
import { withTempHome } from "./helpers/fs";

const PROD_TARGET: OpenMeldEnvironmentTarget = {
  authBaseUrl: "https://auth.openmeld.invalid",
  gatewayUrl: "https://gateway.openmeld.invalid",
  preset: "prod",
  userFacingCommand: "openmeld",
};

const DEV_TARGET: OpenMeldEnvironmentTarget = {
  authBaseUrl: "http://localhost:8788",
  gatewayUrl: "http://localhost:8080",
  preset: "dev-local",
  userFacingCommand: "openmeld-dev",
};

const CANARY_TARGET: OpenMeldEnvironmentTarget = {
  authBaseUrl: "https://auth.staging.openmeld.ai",
  gatewayUrl: "https://gateway.staging.openmeld.ai",
  preset: "canary",
  userFacingCommand: "openmeld-canary",
};

function npmLatestResponse(input: {
  version: string;
  minRequiredCliVersion?: string;
}): Response {
  const body: Record<string, unknown> = { version: input.version };
  if (input.minRequiredCliVersion) {
    body.openmeld = { minRequiredCliVersion: input.minRequiredCliVersion };
  }
  return new Response(JSON.stringify(body), { status: 200 });
}

function stubFetch(response: Response | Error): void {
  vi.stubGlobal(
    "fetch",
    response instanceof Error
      ? vi.fn().mockRejectedValue(response)
      : vi.fn().mockResolvedValue(response)
  );
  resetVersionCheckCacheForTests();
}

describe("assessCliUpdate", () => {
  beforeEach(() => {
    resetVersionCheckCacheForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("flags a floor breach when the running version is below the published floor", async () => {
    await withTempHome(async () => {
      stubFetch(
        npmLatestResponse({ version: "9.9.9", minRequiredCliVersion: "9.0.0" })
      );

      const assessment = await assessCliUpdate({
        environmentTarget: PROD_TARGET,
      });

      expect(assessment).toMatchObject({
        checked: true,
        latestVersion: "9.9.9",
        requiredFloor: "9.0.0",
        updateAvailable: true,
        floorBreached: true,
      });
      // The floor is cached so later machine-mode commands need no network.
      expect(await readVersionState()).toMatchObject({
        latest_version: "9.9.9",
        required_floor: "9.0.0",
      });
    });
  });

  it("does not flag a floor breach for an optional update with no floor", async () => {
    await withTempHome(async () => {
      stubFetch(npmLatestResponse({ version: "9.9.9" }));

      const assessment = await assessCliUpdate({
        environmentTarget: PROD_TARGET,
      });

      expect(assessment).toMatchObject({
        checked: true,
        requiredFloor: null,
        updateAvailable: true,
        floorBreached: false,
      });
    });
  });

  it("does not flag a floor breach when the running version meets the floor", async () => {
    await withTempHome(async () => {
      stubFetch(
        npmLatestResponse({
          version: packageJson.version,
          minRequiredCliVersion: packageJson.version,
        })
      );

      const assessment = await assessCliUpdate({
        environmentTarget: PROD_TARGET,
      });

      expect(assessment).toMatchObject({
        checked: true,
        updateAvailable: false,
        floorBreached: false,
      });
    });
  });

  it("skips the check entirely for non-prod lanes", async () => {
    await withTempHome(async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      resetVersionCheckCacheForTests();

      const assessment = await assessCliUpdate({
        environmentTarget: DEV_TARGET,
      });

      expect(assessment.checked).toBe(false);
      expect(assessment.floorBreached).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("checks an isolated binary canary only when it has an explicit manifest", () => {
    expect(
      isCliUpdateCheckApplicable(CANARY_TARGET, {
        distribution: "binary",
        manifestUrl: "https://staging.openmeld.ai/cli/manifest.json",
      })
    ).toBe(true);
    expect(
      isCliUpdateCheckApplicable(CANARY_TARGET, {
        distribution: "npm",
        manifestUrl: "https://staging.openmeld.ai/cli/manifest.json",
      })
    ).toBe(false);
    expect(
      isCliUpdateCheckApplicable(CANARY_TARGET, {
        distribution: "binary",
        manifestUrl: null,
      })
    ).toBe(false);
  });

  // A floor must be a plain published release version. Anything else — garbage,
  // build metadata (which `compareSemver` ignores, so it could wrongly gate),
  // or a prerelease — is treated as no signal so it fails open.
  for (const badFloor of ["1.2.3oops", "9.0.0+bad meta", "9.0.0-rc.1"]) {
    it(`treats a non-plain floor (${badFloor}) as no signal (fails open)`, async () => {
      await withTempHome(async () => {
        stubFetch(
          npmLatestResponse({
            version: "9.9.9",
            minRequiredCliVersion: badFloor,
          })
        );

        const assessment = await assessCliUpdate({
          environmentTarget: PROD_TARGET,
        });

        expect(assessment).toMatchObject({
          checked: true,
          requiredFloor: null,
          floorBreached: false,
        });
      });
    });
  }

  it("fails open when the registry cannot be reached", async () => {
    await withTempHome(async () => {
      stubFetch(new Error("offline"));

      const assessment = await assessCliUpdate({
        environmentTarget: PROD_TARGET,
      });

      expect(assessment).toMatchObject({
        checked: true,
        latestVersion: null,
        floorBreached: false,
      });
    });
  });

  it("clears a stale cached floor when the latest manifest no longer ships one", async () => {
    await withTempHome(async () => {
      // A previously-cached floor that is now stale (forces a refetch).
      await writeVersionState({
        v: 1,
        last_version: packageJson.version,
        latest_version: "9.9.9",
        last_checked_at: "2000-01-01T00:00:00.000Z",
        dismissed_version: null,
        required_floor: "9.0.0",
        updated_at: "2000-01-01T00:00:00.000Z",
      });
      // The latest manifest no longer advertises a floor.
      stubFetch(npmLatestResponse({ version: "9.9.9" }));

      const assessment = await assessCliUpdate({
        environmentTarget: PROD_TARGET,
      });

      expect(assessment).toMatchObject({
        checked: true,
        requiredFloor: null,
        floorBreached: false,
      });
      // The stale floor must be dropped, never carried forward.
      const state = await readVersionState();
      expect(state?.required_floor).toBeUndefined();
    });
  });

  it("reuses the cached floor without a network probe", async () => {
    await withTempHome(async () => {
      const checkedAt = new Date().toISOString();
      await writeVersionState({
        v: 1,
        last_version: packageJson.version,
        latest_version: "9.9.9",
        last_checked_at: checkedAt,
        dismissed_version: null,
        required_floor: "9.0.0",
        updated_at: checkedAt,
      });
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      resetVersionCheckCacheForTests();

      const assessment = await assessCliUpdate({
        environmentTarget: PROD_TARGET,
      });

      expect(assessment).toMatchObject({
        checked: true,
        latestVersion: "9.9.9",
        requiredFloor: "9.0.0",
        floorBreached: true,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("refreshes a fresh cache when an update action needs the current release", async () => {
    await withTempHome(async () => {
      const checkedAt = new Date().toISOString();
      await writeVersionState({
        v: 1,
        last_version: packageJson.version,
        latest_version: packageJson.version,
        last_checked_at: checkedAt,
        dismissed_version: null,
        required_floor: null,
        updated_at: checkedAt,
      });
      const fetchMock = vi
        .fn()
        .mockResolvedValue(npmLatestResponse({ version: "9.9.9" }));
      vi.stubGlobal("fetch", fetchMock);
      resetVersionCheckCacheForTests();

      const assessment = await assessCliUpdate({
        environmentTarget: PROD_TARGET,
        forceRefresh: true,
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(assessment).toMatchObject({
        checked: true,
        latestVersion: "9.9.9",
        updateAvailable: true,
      });
    });
  });

  it("refreshes a fresh cached update when the cached floor is malformed", async () => {
    await withTempHome(async () => {
      const checkedAt = new Date().toISOString();
      await writeVersionState({
        v: 1,
        last_version: packageJson.version,
        latest_version: "9.9.9",
        last_checked_at: checkedAt,
        dismissed_version: null,
        required_floor: "9.0.0+bad meta",
        updated_at: checkedAt,
      });
      const fetchMock = vi
        .fn()
        .mockResolvedValue(npmLatestResponse({ version: packageJson.version }));
      vi.stubGlobal("fetch", fetchMock);
      resetVersionCheckCacheForTests();

      const assessment = await assessCliUpdate({
        environmentTarget: PROD_TARGET,
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(assessment).toMatchObject({
        checked: true,
        latestVersion: packageJson.version,
        requiredFloor: null,
        updateAvailable: false,
        floorBreached: false,
      });
      const state = await readVersionState();
      expect(state).toMatchObject({
        latest_version: packageJson.version,
      });
      expect(state?.required_floor).toBeUndefined();
    });
  });
});
