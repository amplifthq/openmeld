import { describe, expect, it } from "vitest";
import { resolveAuthTokenCleanupWarnings } from "../src/uninstall/auth-token-impact";

describe("uninstall auth token impact", () => {
  const sharedRemoteIdentities = [
    {
      lane: "prod",
      authBaseUrl: "https://auth.openmeld.invalid/",
      clientId: "openmeld-cli",
    },
    {
      lane: "canary",
      authBaseUrl: "https://auth.openmeld.invalid",
      clientId: "openmeld-cli",
    },
    {
      lane: "dev-local",
      authBaseUrl: "http://localhost:8788",
      clientId: "openmeld-cli-dev",
    },
  ] as const;

  it("warns when removing production auth tokens would also affect canary", () => {
    expect(
      resolveAuthTokenCleanupWarnings({
        scope: {
          kind: "current-lane",
          lane: "prod",
        },
        currentLane: "prod",
        authTokenAction: "remove",
        laneIdentities: sharedRemoteIdentities,
      })
    ).toEqual([
      {
        code: "shared_auth_tokens",
        message:
          "This sign-in is also used by another OpenMeld lane on this device.",
        affectedLanes: ["canary"],
      },
    ]);
  });

  it("warns when removing canary auth tokens would also affect production", () => {
    expect(
      resolveAuthTokenCleanupWarnings({
        scope: {
          kind: "current-lane",
          lane: "canary",
        },
        currentLane: "canary",
        authTokenAction: "remove",
        laneIdentities: sharedRemoteIdentities,
      })
    ).toEqual([
      {
        code: "shared_auth_tokens",
        message:
          "This sign-in is also used by another OpenMeld lane on this device.",
        affectedLanes: ["prod"],
      },
    ]);
  });

  it("does not warn for the local dev lane because its auth identity is separate", () => {
    expect(
      resolveAuthTokenCleanupWarnings({
        scope: {
          kind: "current-lane",
          lane: "dev-local",
        },
        currentLane: "dev-local",
        authTokenAction: "remove",
        laneIdentities: sharedRemoteIdentities,
      })
    ).toEqual([]);
  });

  it("does not warn when all lanes are already being uninstalled together", () => {
    expect(
      resolveAuthTokenCleanupWarnings({
        scope: {
          kind: "all-lanes",
          lanes: ["prod", "dev-local", "canary"],
        },
        currentLane: "prod",
        authTokenAction: "remove",
        laneIdentities: sharedRemoteIdentities,
      })
    ).toEqual([]);
  });
});
