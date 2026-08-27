import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readDaemonServiceUpdateWorkerProtectedManagedVersions,
  readManagedVersionsFromUpdateWorkerRegistration,
  resolveDaemonServiceUpdateWorkerLaunchdPlistPath,
} from "../src/config/daemon-service-update-worker-registration";

describe("daemon service update worker registration", () => {
  const temporaryHomes: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryHomes
        .splice(0)
        .map((home) => rm(home, { force: true, recursive: true }))
    );
  });

  it("recognizes a versioned worker executable that must survive migration", async () => {
    const homeDir = join(tmpdir(), `openmeld-worker-${randomUUID()}`);
    temporaryHomes.push(homeDir);
    const plistPath = resolveDaemonServiceUpdateWorkerLaunchdPlistPath({
      homeDir,
    });
    await mkdir(join(homeDir, "Library", "LaunchAgents"), { recursive: true });
    await writeFile(
      plistPath,
      "<array><string>/Users/test/.openmeld/versions/0.3.120/openmeld</string><string>service</string><string>update-worker</string></array>",
      "utf8"
    );

    await expect(
      readDaemonServiceUpdateWorkerProtectedManagedVersions(
        { homeDir },
        "darwin"
      )
    ).resolves.toEqual(new Set(["0.3.120"]));
  });

  it("does not treat the stable worker carrier as a managed version", () => {
    expect(
      readManagedVersionsFromUpdateWorkerRegistration(
        "/Users/test/.openmeld/runtime/daemon/service-manager/OpenMeld Update Worker Binary"
      )
    ).toEqual(new Set());
  });
});
