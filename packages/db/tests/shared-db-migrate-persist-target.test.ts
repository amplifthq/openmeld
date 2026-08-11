import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getRepoRootDirectoryPath, runSharedDbMigrate } from "../src/tooling";
import { getSharedLocalDevWranglerStateDirectoryPath } from "../src/tooling/wrangler-d1-target.ts";

const PERSIST_TO_ARG_REGEX = /--persist-to\s+(\S+)/u;
const DEV_WORKER_SERVICE_PATHS = [
  "services/auth",
  "services/core",
  "services/gateway",
  "services/remote-agent",
] as const;

const readDevPersistToDirectory = (
  serviceRelativePath: string
): string | null => {
  const packageJsonPath = path.resolve(
    getRepoRootDirectoryPath(),
    serviceRelativePath,
    "package.json"
  );
  const manifest = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
    scripts?: { dev?: string };
  };
  const devScript = String(manifest.scripts?.dev ?? "");
  const match = devScript.match(PERSIST_TO_ARG_REGEX);
  if (!match?.[1]) {
    return null;
  }
  return path.resolve(
    getRepoRootDirectoryPath(),
    serviceRelativePath,
    match[1]
  );
};

describe("shared db migrate persist target", () => {
  it("uses the isolated lane persist root when the dev launcher provides one", () => {
    const previousValue = process.env.OPENMELD_DEV_WRANGLER_STATE_DIR;
    const isolatedStateRoot = path.resolve(
      getRepoRootDirectoryPath(),
      ".wrangler-dev-state/isolated/test-lane"
    );

    try {
      process.env.OPENMELD_DEV_WRANGLER_STATE_DIR = isolatedStateRoot;
      expect(getSharedLocalDevWranglerStateDirectoryPath()).toBe(
        isolatedStateRoot
      );
    } finally {
      if (previousValue === undefined) {
        // biome-ignore lint/performance/noDelete: assignment coerces undefined into the string "undefined" in process.env.
        delete process.env.OPENMELD_DEV_WRANGLER_STATE_DIR;
      } else {
        process.env.OPENMELD_DEV_WRANGLER_STATE_DIR = previousValue;
      }
    }
  });

  it("applies dev migrations against the shared .wrangler-dev-state persist root", () => {
    const sharedStateRoot = getSharedLocalDevWranglerStateDirectoryPath();
    const capturedApplyArgs: string[][] = [];

    const summary = runSharedDbMigrate({
      mode: "dev",
      runner: ({ args }) => {
        if (args.includes("migrations") && args.includes("apply")) {
          capturedApplyArgs.push(args);
        }
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    expect(summary.result).toBe("applied");
    expect(capturedApplyArgs.length).toBeGreaterThan(0);
    for (const args of capturedApplyArgs) {
      expect(args).toContain("--local");
      const persistIndex = args.indexOf("--persist-to");
      expect(persistIndex).toBeGreaterThanOrEqual(0);
      expect(args[persistIndex + 1]).toBe(sharedStateRoot);
    }
  });

  it("keeps every dev worker persist root aligned with the tooling persist root", () => {
    const sharedStateRoot = getSharedLocalDevWranglerStateDirectoryPath();

    for (const serviceRelativePath of DEV_WORKER_SERVICE_PATHS) {
      const devPersistToDirectory =
        readDevPersistToDirectory(serviceRelativePath);
      expect(
        devPersistToDirectory,
        `${serviceRelativePath} dev script must pass --persist-to`
      ).not.toBeNull();
      expect(
        devPersistToDirectory,
        `${serviceRelativePath} dev worker persist root must match db tooling`
      ).toBe(sharedStateRoot);
    }
  });
});
