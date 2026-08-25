import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenMeldToolsUpdateAttempt } from "@openmeld/schemas/types";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenMeldPathResolutionInput } from "../src/config/paths";
import { persistPendingDaemonServiceUpdate } from "../src/local-service/lifecycle/daemon-service-update-state";
import {
  completeOpenMeldToolsUpdateAttempt,
  persistOpenMeldToolsUpdateAttempt,
  readLastOpenMeldToolsUpdateAttempt,
  readPendingOpenMeldToolsUpdateAttempt,
} from "../src/local-service/maintenance/openmeld-tools-update-attempt-state";
import { resolveOpenMeldToolsUpdateOperation } from "../src/local-service/maintenance/openmeld-tools-update-operation";

const NOW = "2026-08-25T08:00:00.000Z";
const attempt: OpenMeldToolsUpdateAttempt = {
  v: 1,
  attempts: 1,
  errorMessage: null,
  operation: {
    operationId: "update-1",
    phase: "updating",
    requestSource: "automatic",
    requestedAt: NOW,
    targetVersion: "0.3.105",
    updatedAt: NOW,
    urgency: "available",
  },
};

describe("OpenMeld Tools update attempt state", () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryRoots.splice(0).map(async (path) => {
        await rm(path, { force: true, recursive: true });
      })
    );
  });

  it("survives a Service restart and moves completed work to history", async () => {
    const root = await mkdtemp(join(tmpdir(), "openmeld-tools-update-"));
    temporaryRoots.push(root);
    const pathInput: OpenMeldPathResolutionInput = {
      env: {
        OPENMELD_ENV_PRESET: "dev-local",
        OPENMELD_HOME: root,
      },
      homeDir: root,
    };

    await persistOpenMeldToolsUpdateAttempt(attempt, pathInput);
    await expect(
      readPendingOpenMeldToolsUpdateAttempt(pathInput)
    ).resolves.toEqual(attempt);

    const completed = {
      ...attempt,
      operation: { ...attempt.operation, phase: "updated" as const },
    };
    await completeOpenMeldToolsUpdateAttempt(completed, pathInput);

    await expect(
      readPendingOpenMeldToolsUpdateAttempt(pathInput)
    ).resolves.toBeNull();
    await expect(
      readLastOpenMeldToolsUpdateAttempt(pathInput)
    ).resolves.toEqual(completed);
  });

  it("shows the Service switch after the CLI update hands off", async () => {
    const root = await mkdtemp(join(tmpdir(), "openmeld-tools-update-"));
    temporaryRoots.push(root);
    const pathInput: OpenMeldPathResolutionInput = {
      env: {
        OPENMELD_ENV_PRESET: "dev-local",
        OPENMELD_HOME: root,
      },
      homeDir: root,
    };
    await persistOpenMeldToolsUpdateAttempt(attempt, pathInput);
    await persistPendingDaemonServiceUpdate(
      {
        v: 2,
        schema: "openmeld-daemon-service-update-job-v2",
        attempts: 0,
        desiredState: "background",
        errorMessage: null,
        jobId: "update-1",
        phase: "waiting_for_work",
        preparedBundle: {
          v: 2,
          schema: "openmeld-daemon-active-bundle-v2",
          bundleId: "0.3.105-bundle",
          daemonVersion: "0.3.105",
          entryScriptRelativePath: "openmeld",
          bundleFormat: "binary_v1",
          sourceEntryScriptPath: "/tmp/openmeld",
          sourcePackageRootPath: "/tmp",
          sourceDistRootPath: "/tmp",
          sourceDistFingerprint: "abc123",
          sourceKind: "package_install",
          createdAt: NOW,
          updatedAt: NOW,
        },
        requestedAt: NOW,
        requestSource: "automatic",
        targetVersion: "0.3.105",
        updatedAt: NOW,
        urgency: "available",
      },
      pathInput
    );

    await expect(
      resolveOpenMeldToolsUpdateOperation(pathInput, Date.parse(NOW))
    ).resolves.toMatchObject({
      operationId: "update-1",
      phase: "waiting_for_work",
    });
  });
});
