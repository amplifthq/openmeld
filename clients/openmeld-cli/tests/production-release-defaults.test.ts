import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyProductionReleaseDefaultsToEnvironment,
  shouldUseProductionReleaseDefaults,
} from "../src/commands/production-release-defaults";
import {
  DEFAULT_AUTH_BASE_URL,
  resolveAuthBaseUrl,
} from "../src/config/auth-url";
import {
  DEFAULT_GATEWAY_BASE_URL,
  resolveBaseUrl,
} from "../src/config/base-url";
import { resolveOpenMeldRootDir } from "../src/config/paths";
import { withTempHome } from "./helpers/fs";

const FULL_PACKAGE_RELEASE_ARGV = [
  "/usr/local/bin/node",
  "/usr/local/bin/openmeld",
];
const DEV_ARGV = ["/usr/local/bin/node", "/usr/local/bin/openmeld-dev"];
const RELEASE_DEFAULT_ENV_KEYS = [
  "OPENMELD_GATEWAY_URL",
  "OPENMELD_AUTH_URL",
  "OPENMELD_AUTH_CLIENT_ID",
  "OPENMELD_ENV_PRESET",
  "OPENMELD_DEV_MODE",
  "OPENMELD_USER_FACING_CLI_COMMAND",
] as const;

describe("production release defaults", () => {
  it("uses production endpoints without discarding an explicit OPENMELD_HOME", async () => {
    await withTempHome(async (home) => {
      const env: NodeJS.ProcessEnv = {
        OPENMELD_HOME: join(home, ".openmeld-dev"),
        OPENMELD_GATEWAY_URL: "http://localhost:8080",
        OPENMELD_AUTH_URL: "http://localhost:8788",
        OPENMELD_AUTH_CLIENT_ID: "openmeld-cli-dev",
        OPENMELD_ENV_PRESET: "dev-local",
        OPENMELD_DEV_MODE: "1",
        OPENMELD_SETUP_FOLLOW_UP_CLI_COMMAND: "openmeld",
        OPENMELD_USER_FACING_CLI_COMMAND: "openmeld-dev",
      };

      applyProductionReleaseDefaultsToEnvironment({
        argv: FULL_PACKAGE_RELEASE_ARGV,
        env,
      });

      for (const key of RELEASE_DEFAULT_ENV_KEYS) {
        expect(env[key]).toBeUndefined();
      }
      expect(env.OPENMELD_HOME).toBe(join(home, ".openmeld-dev"));
      expect(env.OPENMELD_SETUP_FOLLOW_UP_CLI_COMMAND).toBe("openmeld");
      expect(
        resolveOpenMeldRootDir({
          argv: FULL_PACKAGE_RELEASE_ARGV,
          env,
          homeDir: home,
        })
      ).toBe(join(home, ".openmeld-dev"));
      await expect(resolveBaseUrl(undefined, { env })).resolves.toBe(
        DEFAULT_GATEWAY_BASE_URL
      );
      expect(resolveAuthBaseUrl(undefined, { env })).toBe(
        DEFAULT_AUTH_BASE_URL
      );
    });
  });

  it("does not clean dev-local commands", () => {
    const devEnv = createNonDefaultEnv();
    applyProductionReleaseDefaultsToEnvironment({
      argv: DEV_ARGV,
      env: devEnv,
    });
    expect(devEnv).toEqual(createNonDefaultEnv());
  });

  it("only gates the full package release entry", () => {
    expect(
      shouldUseProductionReleaseDefaults({
        argv: FULL_PACKAGE_RELEASE_ARGV,
      })
    ).toBe(true);
    expect(
      shouldUseProductionReleaseDefaults({
        argv: DEV_ARGV,
      })
    ).toBe(false);
  });
});

function createNonDefaultEnv(): NodeJS.ProcessEnv {
  return {
    OPENMELD_HOME: "/tmp/openmeld-dev-home",
    OPENMELD_GATEWAY_URL: "http://localhost:8080",
    OPENMELD_AUTH_URL: "http://localhost:8788",
    OPENMELD_AUTH_CLIENT_ID: "openmeld-cli-dev",
    OPENMELD_ENV_PRESET: "dev-local",
    OPENMELD_DEV_MODE: "1",
    OPENMELD_USER_FACING_CLI_COMMAND: "openmeld-dev",
  };
}
