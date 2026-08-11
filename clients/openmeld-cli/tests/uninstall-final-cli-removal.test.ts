import { describe, expect, it } from "vitest";
import {
  inferProductionCliInstallSourceFromPaths,
  resolveFinalCliRemovalCommand,
} from "../src/uninstall/final-cli-removal";

describe("uninstall final CLI removal", () => {
  it("returns the repo-local dev shortcut removal command", () => {
    expect(
      resolveFinalCliRemovalCommand({
        currentLane: "dev-local",
      })
    ).toEqual({
      kind: "command",
      command: "pnpm openmeld:dev:remove",
      reason: expect.stringContaining("still open"),
    });
  });

  it("returns the canary shortcut removal command", () => {
    expect(
      resolveFinalCliRemovalCommand({
        currentLane: "canary",
      })
    ).toEqual({
      kind: "command",
      command: "pnpm openmeld:canary:remove",
      reason: expect.stringContaining("still open"),
    });
  });

  it("returns the npm global uninstall command when production install source is known", () => {
    expect(
      resolveFinalCliRemovalCommand({
        currentLane: "prod",
        productionInstallSource: "npm-global",
      })
    ).toEqual({
      kind: "command",
      command: "npm uninstall -g openmeld",
      reason: expect.stringContaining("still open"),
    });
  });

  it("falls back to manual guidance when the production install source is unknown", () => {
    expect(
      resolveFinalCliRemovalCommand({
        currentLane: "prod",
        productionInstallSource: "unknown",
      })
    ).toEqual({
      kind: "manual",
      message:
        "Remove the production OpenMeld CLI with the same tool you used to install it originally.",
      reason: expect.stringContaining("still open"),
    });
  });

  it("recognizes npm-global production installs from the installed dist path", () => {
    expect(
      inferProductionCliInstallSourceFromPaths({
        cliScriptPath:
          "/Users/test/.nvm/versions/node/v25.1.0/lib/node_modules/openmeld/dist/openmeld.js",
        npmGlobalRootPath:
          "/Users/test/.nvm/versions/node/v25.1.0/lib/node_modules",
      })
    ).toBe("npm-global");
  });

  it("keeps repo-local and package-shaped paths as unknown production installs", () => {
    expect(
      inferProductionCliInstallSourceFromPaths({
        cliScriptPath:
          "/Users/test/projects/openmeld/clients/openmeld-cli/dist/openmeld.js",
        npmGlobalRootPath:
          "/Users/test/.nvm/versions/node/v25.1.0/lib/node_modules",
      })
    ).toBe("unknown");
    expect(
      inferProductionCliInstallSourceFromPaths({
        cliScriptPath:
          "/Users/test/.local/share/openmeld-canary/package-install/node_modules/openmeld/dist/openmeld.js",
        npmGlobalRootPath:
          "/Users/test/.nvm/versions/node/v25.1.0/lib/node_modules",
      })
    ).toBe("unknown");
  });
});
