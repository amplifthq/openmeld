import { describe, expect, it } from "vitest";
import { resolveDaemonServiceIdentity } from "../src/local-service/lifecycle/daemon-service-identity";

describe("local service identity", () => {
  it("keeps production on the historical service identity", () => {
    expect(
      resolveDaemonServiceIdentity({
        env: {
          OPENMELD_ENV_PRESET: "prod",
        },
      })
    ).toEqual({
      envPreset: "prod",
      serviceName: "openmeld-daemon",
      launchdLabel: "com.openmeld.openmeld-background-service",
      windowsServiceName: "OpenMeld-Daemon",
      windowsDisplayName: "OpenMeld Daemon Service",
      cliEntryAliases: ["openmeld"],
    });
  });

  it("uses a dedicated service identity for local development", () => {
    expect(
      resolveDaemonServiceIdentity({
        env: {
          OPENMELD_ENV_PRESET: "dev-local",
        },
      })
    ).toEqual({
      envPreset: "dev-local",
      serviceName: "openmeld-daemon-dev-local",
      launchdLabel: "com.openmeld.openmeld-background-service.dev-local",
      windowsServiceName: "OpenMeld-Daemon-DevLocal",
      windowsDisplayName: "OpenMeld Daemon Service (Dev Local)",
      cliEntryAliases: ["openmeld-dev"],
    });
  });

  it("uses a dedicated service identity for canary", () => {
    expect(
      resolveDaemonServiceIdentity({
        env: {
          OPENMELD_ENV_PRESET: "canary",
        },
      })
    ).toEqual({
      envPreset: "canary",
      serviceName: "openmeld-daemon-canary",
      launchdLabel: "com.openmeld.openmeld-background-service.canary",
      windowsServiceName: "OpenMeld-Daemon-Canary",
      windowsDisplayName: "OpenMeld Daemon Service (Canary)",
      cliEntryAliases: ["openmeld-canary"],
    });
  });
});
