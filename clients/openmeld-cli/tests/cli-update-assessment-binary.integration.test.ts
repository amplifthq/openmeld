import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withTempHome } from "./helpers/fs";

const BINARY_MANIFEST_URL = "https://openmeld.test/cli/manifest.json";
const PROD_MANAGED_BINARY_PATH_PATTERN = /\/\.openmeld\/bin\/openmeld$/u;
const CLI_BINARY_MANIFEST_FIXTURE_URL = new URL(
  "./fixtures/cli-binary-manifest.stable.json",
  import.meta.url
);

describe("binary Service CLI update assessment", () => {
  afterEach(() => {
    vi.doUnmock("../src/runtime/distribution");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("checks the binary manifest from the installed production command spec", async () => {
    vi.resetModules();
    vi.doMock("../src/runtime/distribution", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/runtime/distribution")>()),
      isBinaryDistribution: () => true,
      resolveOpenMeldDistribution: () => "binary",
    }));
    vi.stubEnv("OPENMELD_CLI_BINARY_MANIFEST_URL", BINARY_MANIFEST_URL);

    const manifestRaw = await readFile(CLI_BINARY_MANIFEST_FIXTURE_URL, "utf8");
    const manifest = JSON.parse(manifestRaw) as {
      channels: { stable: { version: string; minRequiredCliVersion: string } };
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(manifestRaw, {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 200,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await withTempHome(async () => {
      const [
        { assessCliUpdate },
        { resolveOpenMeldEnvironmentTargetFromEnv },
        { openMeldManagedBinaryPath },
        { buildDaemonSystemServiceCommandSpec },
      ] = await Promise.all([
        import("../src/command-entry-checks/cli-update-assessment"),
        import("../src/config/openmeld-environment-target"),
        import("../src/config/paths"),
        import("../src/local-service/lifecycle/daemon-service-command-spec"),
      ]);
      const managedBinaryPath = openMeldManagedBinaryPath();
      const commandSpec = buildDaemonSystemServiceCommandSpec({
        controller: "launchd",
        distribution: "binary",
        environmentTarget: {
          authBaseUrl: "https://auth.openmeld.ai",
          gatewayUrl: "https://api.openmeld.ai",
          preset: "prod",
          userFacingCommand: managedBinaryPath,
        },
      });
      const serviceEnvironmentTarget = resolveOpenMeldEnvironmentTargetFromEnv({
        env: commandSpec.env,
      });

      expect(serviceEnvironmentTarget).toMatchObject({
        preset: "prod",
        userFacingCommand: managedBinaryPath,
      });
      expect(managedBinaryPath).toMatch(PROD_MANAGED_BINARY_PATH_PATTERN);

      const assessment = await assessCliUpdate({
        environmentTarget: serviceEnvironmentTarget,
        forceRefresh: true,
      });

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(fetchMock).toHaveBeenCalledWith(
        BINARY_MANIFEST_URL,
        expect.objectContaining({ method: "GET" })
      );
      expect(assessment).toMatchObject({
        checked: true,
        latestVersion: manifest.channels.stable.version,
        requiredFloor: manifest.channels.stable.minRequiredCliVersion,
      });
    });
  });
});
