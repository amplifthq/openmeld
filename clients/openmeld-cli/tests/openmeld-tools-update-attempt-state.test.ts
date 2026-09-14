import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  DaemonServiceUpdateJob,
  OpenMeldToolsUpdateAttempt,
} from "@openmeld/schemas/types";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenMeldPathResolutionInput } from "../src/config/paths";
import {
  completePendingDaemonServiceUpdate,
  persistPendingDaemonServiceUpdate,
} from "../src/local-service/lifecycle/daemon-service-update-state";
import {
  completeOpenMeldToolsUpdateAttempt,
  persistOpenMeldToolsUpdateAttempt,
  readLastOpenMeldToolsUpdateAttempt,
  readPendingOpenMeldToolsUpdateAttempt,
} from "../src/local-service/maintenance/openmeld-tools-update-attempt-state";
import { encodePersistedOpenMeldToolsUpdateFailure } from "../src/local-service/maintenance/openmeld-tools-update-failure";
import {
  resolveOpenMeldToolsUpdateOperation,
  resolveOpenMeldToolsUpdateOperationProjection,
} from "../src/local-service/maintenance/openmeld-tools-update-operation";

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
const serviceJob: DaemonServiceUpdateJob = {
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
    await completeOpenMeldToolsUpdateAttempt(
      {
        ...attempt,
        operation: { ...attempt.operation, phase: "updated" },
      },
      pathInput
    );
    await persistPendingDaemonServiceUpdate(serviceJob, pathInput);

    await expect(
      resolveOpenMeldToolsUpdateOperation(pathInput, Date.parse(NOW))
    ).resolves.toMatchObject({
      operationId: "update-1",
      phase: "waiting_for_work",
    });
    await expect(
      resolveOpenMeldToolsUpdateOperationProjection(pathInput, Date.parse(NOW))
    ).resolves.toMatchObject({
      failureCode: null,
      operation: {
        operationId: "update-1",
        phase: "waiting_for_work",
      },
    });

    const restoredAt = "2026-08-25T08:00:01.000Z";
    await completePendingDaemonServiceUpdate(
      { ...serviceJob, phase: "restored", updatedAt: restoredAt },
      pathInput
    );
    await expect(
      resolveOpenMeldToolsUpdateOperationProjection(
        pathInput,
        Date.parse(restoredAt)
      )
    ).resolves.toMatchObject({
      failureCode: "cli.update.service_alignment_failed",
      operation: {
        operationId: "update-1",
        phase: "restored",
      },
    });
  });

  it.each([
    "needs_help",
    "restored",
  ] as const)("projects a standalone terminal Service %s outcome without inferring CLI state", async (phase) => {
    const root = await mkdtemp(join(tmpdir(), "openmeld-tools-update-"));
    temporaryRoots.push(root);
    const pathInput: OpenMeldPathResolutionInput = {
      env: {
        OPENMELD_ENV_PRESET: "dev-local",
        OPENMELD_HOME: root,
      },
      homeDir: root,
    };
    await persistPendingDaemonServiceUpdate(serviceJob, pathInput);
    await completePendingDaemonServiceUpdate(
      { ...serviceJob, phase },
      pathInput
    );

    await expect(
      resolveOpenMeldToolsUpdateOperationProjection(pathInput, Date.parse(NOW))
    ).resolves.toMatchObject({
      failureCode: "cli.update.service_alignment_failed",
      operation: { operationId: "update-1", phase },
    });
  });

  it("projects a bounded safe failure while retaining raw detail only on disk", async () => {
    const root = await mkdtemp(join(tmpdir(), "openmeld-tools-update-"));
    temporaryRoots.push(root);
    const pathInput: OpenMeldPathResolutionInput = {
      env: {
        OPENMELD_ENV_PRESET: "dev-local",
        OPENMELD_HOME: root,
      },
      homeDir: root,
    };
    await completeOpenMeldToolsUpdateAttempt(
      {
        ...attempt,
        errorMessage: encodePersistedOpenMeldToolsUpdateFailure({
          detail: "download failed at /private/local/path",
          failureCode: "cli.update.download_stalled",
        }),
        operation: {
          ...attempt.operation,
          phase: "needs_help",
        },
      },
      pathInput
    );

    const stored = await readLastOpenMeldToolsUpdateAttempt(pathInput);
    expect(stored?.errorMessage).toContain("/private/local/path");
    expect(stored?.operation).not.toHaveProperty("failure");
    await expect(
      resolveOpenMeldToolsUpdateOperation(pathInput, Date.parse(NOW))
    ).resolves.toMatchObject({
      operationId: "update-1",
      phase: "needs_help",
    });
    const projected = await resolveOpenMeldToolsUpdateOperationProjection(
      pathInput,
      Date.parse(NOW)
    );
    expect(projected?.failureCode).toBe("cli.update.download_stalled");
    expect(JSON.stringify(projected)).not.toContain("/private/local/path");
  });

  it("uses a generic code for older failed attempts without a typed prefix", async () => {
    const root = await mkdtemp(join(tmpdir(), "openmeld-tools-update-"));
    temporaryRoots.push(root);
    const pathInput: OpenMeldPathResolutionInput = {
      env: {
        OPENMELD_ENV_PRESET: "dev-local",
        OPENMELD_HOME: root,
      },
      homeDir: root,
    };
    await completeOpenMeldToolsUpdateAttempt(
      {
        ...attempt,
        errorMessage: "legacy update failure detail",
        operation: {
          ...attempt.operation,
          phase: "needs_help",
        },
      },
      pathInput
    );

    await expect(
      resolveOpenMeldToolsUpdateOperationProjection(pathInput, Date.parse(NOW))
    ).resolves.toMatchObject({
      failureCode: "cli.update.failed",
      operation: { operationId: "update-1", phase: "needs_help" },
    });
  });
});
