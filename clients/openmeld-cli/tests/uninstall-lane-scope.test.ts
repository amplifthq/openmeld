import { describe, expect, it } from "vitest";
import {
  ALL_UNINSTALL_LANES,
  listScopeLanes,
  resolveCurrentUninstallLane,
  resolveLaneUserFacingCommand,
  resolveUninstallScope,
} from "../src/uninstall/lane-scope";

describe("uninstall lane scope", () => {
  it("resolves the current lane from the active CLI entry", () => {
    expect(
      resolveCurrentUninstallLane({
        env: {},
        argv: ["/usr/local/bin/node", "/usr/local/bin/openmeld-dev"],
      })
    ).toBe("dev-local");
    expect(
      resolveCurrentUninstallLane({
        env: {},
        argv: ["/usr/local/bin/node", "/usr/local/bin/openmeld-canary"],
      })
    ).toBe("canary");
  });

  it("resolves all-lanes in a fixed order", () => {
    const scope = resolveUninstallScope({
      allLanes: true,
    });

    expect(scope).toEqual({
      kind: "all-lanes",
      lanes: [...ALL_UNINSTALL_LANES],
    });
    expect(listScopeLanes(scope)).toEqual(["prod", "dev-local", "canary"]);
  });

  it("uses the current lane by default", () => {
    const scope = resolveUninstallScope({
      env: {},
      argv: ["/usr/local/bin/node", "/usr/local/bin/openmeld-canary"],
    });

    expect(scope).toEqual({
      kind: "current-lane",
      lane: "canary",
    });
    expect(listScopeLanes(scope)).toEqual(["canary"]);
  });

  it("resolves the user-facing command for each lane", () => {
    expect(resolveLaneUserFacingCommand("prod")).toBe("openmeld");
    expect(resolveLaneUserFacingCommand("dev-local")).toBe("openmeld-dev");
    expect(resolveLaneUserFacingCommand("canary")).toBe("openmeld-canary");
  });
});
