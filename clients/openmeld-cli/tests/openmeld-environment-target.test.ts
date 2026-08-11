import { describe, expect, it } from "vitest";
import { resolveOpenMeldEnvironmentTarget } from "../src/config/openmeld-environment-target";
import { withTempHome } from "./helpers/fs";

describe("OpenMeld environment target", () => {
  it("resolves the packaged canary lane to the local OpenMeld environment", async () => {
    await withTempHome(async (home) => {
      await expect(
        resolveOpenMeldEnvironmentTarget({
          env: {
            OPENMELD_AUTH_URL: "",
            OPENMELD_ENV_PRESET: "canary",
            OPENMELD_GATEWAY_URL: "",
            OPENMELD_HOME: `${home}/.openmeld-canary`,
          },
        })
      ).resolves.toEqual({
        authBaseUrl: "http://localhost:8788",
        gatewayUrl: "http://localhost:8080",
        preset: "canary",
        userFacingCommand: "openmeld-canary",
      });
    });
  });

  it("keeps explicit Gateway/Auth overrides for remote smoke", async () => {
    await expect(
      resolveOpenMeldEnvironmentTarget({
        env: {
          OPENMELD_AUTH_URL: "https://auth.staging.openmeld.invalid",
          OPENMELD_ENV_PRESET: "canary",
          OPENMELD_GATEWAY_URL: "https://gateway.staging.openmeld.invalid",
        },
      })
    ).resolves.toEqual({
      authBaseUrl: "https://auth.staging.openmeld.invalid",
      gatewayUrl: "https://gateway.staging.openmeld.invalid",
      preset: "canary",
      userFacingCommand: "openmeld-canary",
    });
  });

  it("uses the explicit CLI Gateway over canary defaults", async () => {
    await expect(
      resolveOpenMeldEnvironmentTarget({
        env: {
          OPENMELD_AUTH_URL: "https://auth.staging.openmeld.invalid",
          OPENMELD_ENV_PRESET: "canary",
          OPENMELD_GATEWAY_URL: "http://localhost:8080",
        },
        gatewayUrl: "https://gateway.staging.openmeld.invalid",
      })
    ).resolves.toMatchObject({
      authBaseUrl: "https://auth.staging.openmeld.invalid",
      gatewayUrl: "https://gateway.staging.openmeld.invalid",
      preset: "canary",
    });
  });
});
