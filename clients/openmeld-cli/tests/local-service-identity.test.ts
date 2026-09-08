import { describe, expect, it } from "vitest";
import { resolveDaemonServiceUpdateWorkerIdentity } from "../src/config/daemon-service-update-worker-registration";
import {
  resolveOpenMeldRootDir,
  resolveOpenMeldServiceOwnedPathInput,
} from "../src/config/paths";
import { resolveDaemonServiceIdentity } from "../src/local-service/lifecycle/daemon-service-identity";

const DEV_SERVICE_LABEL =
  /^com\.openmeld\.openmeld-background-service\.dev-local\.[a-f0-9]{16}$/u;

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
    const a = {
      env: { OPENMELD_ENV_PRESET: "dev-local", OPENMELD_HOME: "/tmp/lane-a" },
    };
    const b = {
      env: { OPENMELD_ENV_PRESET: "dev-local", OPENMELD_HOME: "/tmp/lane-b" },
    };
    const first = resolveDaemonServiceIdentity(a);
    const second = resolveDaemonServiceIdentity(b);
    for (const key of [
      "launchdLabel",
      "serviceName",
      "windowsServiceName",
    ] as const) {
      expect(first[key]).not.toBe(second[key]);
      expect(resolveDaemonServiceIdentity(a)[key]).toBe(first[key]);
      expect(resolveDaemonServiceUpdateWorkerIdentity(a)[key]).not.toBe(
        resolveDaemonServiceUpdateWorkerIdentity(b)[key]
      );
    }
    expect(first.launchdLabel).toMatch(DEV_SERVICE_LABEL);
    expect(
      resolveOpenMeldRootDir(resolveOpenMeldServiceOwnedPathInput(a))
    ).toBe("/tmp/lane-a");
    expect(
      resolveOpenMeldRootDir(resolveOpenMeldServiceOwnedPathInput(b))
    ).toBe("/tmp/lane-b");
    expect(
      resolveDaemonServiceIdentity({
        env: { ...a.env, OPENMELD_HOME: "/tmp/lane-a/../lane-a" },
      })
    ).toEqual(first);
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
