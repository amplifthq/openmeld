import type { OpenMeldToolsUpdateAttempt } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import {
  installDaemon,
  readDaemonControlPlaneToken,
} from "../src/config/daemon-state";
import { startLocalDaemonControlPlaneServer } from "../src/local-service/control-plane/server";
import {
  completePendingDaemonServiceUpdate,
  type DaemonServiceUpdateJob,
  persistPendingDaemonServiceUpdate,
} from "../src/local-service/lifecycle/daemon-service-update-state";
import {
  completeOpenMeldToolsUpdateAttempt,
  discardPendingOpenMeldToolsUpdateAttempt,
  persistOpenMeldToolsUpdateAttempt,
} from "../src/local-service/maintenance/openmeld-tools-update-attempt-state";
import {
  resolveExternalOpenMeldToolsUpdate,
  waitForExternalOpenMeldToolsUpdate,
  waitForOpenMeldToolsUpdateCompletion,
} from "../src/local-service/maintenance/openmeld-tools-update-join";
import { withTempHome } from "./helpers/fs";

const attempt: OpenMeldToolsUpdateAttempt = {
  v: 1,
  attempts: 1,
  errorMessage: null,
  operation: {
    operationId: "update-operation-1",
    phase: "updating",
    requestSource: "automatic",
    requestedAt: "2026-09-01T12:27:00.000Z",
    targetVersion: "0.3.139",
    updatedAt: "2026-09-01T12:27:01.000Z",
    urgency: "required",
  },
};

describe("OpenMeld Tools update join", () => {
  it("bounds observation without changing the pending update", async () => {
    await withTempHome(async () => {
      await persistOpenMeldToolsUpdateAttempt(attempt);
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        await expect(
          waitForOpenMeldToolsUpdateCompletion({
            timeoutMs: 30 * 60_000,
            pollIntervalMs: 1,
            onObservation: () => vi.setSystemTime(Date.now() + 30 * 60_000),
          })
        ).rejects.toThrow("Current tasks and the update continue");
        expect(await resolveExternalOpenMeldToolsUpdate()).toMatchObject({
          operationId: attempt.operation.operationId,
          phase: "updating",
        });
      } finally {
        vi.useRealTimers();
      }
    });
  });
  it("reads accepted work through the Service control socket while the durable phase remains updating", async () => {
    await withTempHome(async () => {
      const now = new Date().toISOString();
      await installDaemon({
        daemonVersion: "0.3.264",
        source: "daemon.command.install",
      });
      const job: DaemonServiceUpdateJob = {
        v: 2,
        schema: "openmeld-daemon-service-update-job-v2",
        attempts: 1,
        desiredState: "background",
        errorMessage: null,
        jobId: "draining-update",
        phase: "updating",
        requestedAt: now,
        requestSource: "cli",
        targetVersion: "0.3.264",
        updatedAt: now,
        urgency: "required",
        preparedBundle: {
          v: 2,
          schema: "openmeld-daemon-active-bundle-v2",
          bundleId: "test-bundle",
          daemonVersion: "0.3.264",
          entryScriptRelativePath: "openmeld",
          bundleFormat: "binary_v1",
          sourceKind: "package_install",
          sourceEntryScriptPath: "/test-owned/openmeld",
          sourcePackageRootPath: "/test-owned",
          sourceDistRootPath: "/test-owned",
          sourceDistFingerprint: "test",
          createdAt: now,
          updatedAt: now,
        },
      };
      await persistPendingDaemonServiceUpdate(job);
      let acceptedWakeCount = 2;
      const observed: number[] = [];
      const server = await startLocalDaemonControlPlaneServer({
        expectedToken: (await readDaemonControlPlaneToken()) ?? "missing",
        getContext: () => ({
          healthPayload: {
            checkedAt: now,
            reasonCode: "ok",
            runtimeState: "healthy",
            state: "ok",
          },
          historyEntries: [],
          statusPayload: {
            checkedAt: now,
            daemonVersion: "0.3.264",
            installed: true,
            running: true,
            runtimeRoot: "/test-owned",
          },
          serviceUpdateReadinessHandler: async () => ({
            acceptedWakeCount,
            safeToSwitch: acceptedWakeCount === 0,
            unacknowledgedResultCount: 0,
          }),
        }),
      });
      let complete: Promise<void> | undefined;
      try {
        await waitForOpenMeldToolsUpdateCompletion({
          pollIntervalMs: 1,
          onObservation: (operation, readiness) => {
            expect(operation.phase).toBe("updating");
            expect(readiness).not.toBeNull();
            observed.push(readiness?.acceptedWakeCount ?? -1);
            if (acceptedWakeCount > 0) {
              acceptedWakeCount = 0;
            } else {
              complete ??= completePendingDaemonServiceUpdate({
                ...job,
                phase: "updated",
              });
            }
          },
        });
        await complete;
        expect(observed[0]).toBe(2);
        expect(observed).toContain(0);
      } finally {
        await server.close();
      }
    });
  });
  it.each([
    "updated",
    "restored",
    "needs_help",
    "missing",
    "another_operation",
  ] as const)("accepts only the joined operation's successful durable completion: %s", async (outcome) => {
    await withTempHome(async () => {
      const now = new Date().toISOString();
      const pending = {
        ...attempt,
        operation: { ...attempt.operation, requestedAt: now, updatedAt: now },
      };
      await persistOpenMeldToolsUpdateAttempt(pending);
      const waiting = waitForOpenMeldToolsUpdateCompletion({
        operationId: pending.operation.operationId,
        pollIntervalMs: 1,
        onWaiting: async () => {
          if (outcome === "missing") {
            await discardPendingOpenMeldToolsUpdateAttempt();
            return;
          }
          await completeOpenMeldToolsUpdateAttempt({
            ...pending,
            operation: {
              ...pending.operation,
              operationId:
                outcome === "another_operation"
                  ? "different-update"
                  : pending.operation.operationId,
              phase: outcome === "another_operation" ? "updated" : outcome,
            },
          });
        },
      });
      if (outcome === "updated") {
        await expect(waiting).resolves.toMatchObject({
          operationId: pending.operation.operationId,
          phase: "updated",
        });
      } else {
        await expect(waiting).rejects.toThrow("did not finish successfully");
      }
    });
  });
  it("joins an update waiting for work instead of racing its worker", async () => {
    await withTempHome(async () => {
      const waiting = {
        ...attempt,
        operation: { ...attempt.operation, phase: "waiting_for_work" as const },
      };
      await persistOpenMeldToolsUpdateAttempt(waiting);
      const onWaiting = vi.fn(async () => {
        expect(await resolveExternalOpenMeldToolsUpdate()).toEqual(
          waiting.operation
        );
        await discardPendingOpenMeldToolsUpdateAttempt();
      });
      await waitForExternalOpenMeldToolsUpdate({
        onWaiting,
        pollIntervalMs: 1,
      });
      expect(onWaiting).toHaveBeenCalledOnce();
    });
  });
  it("finds a pending update but excludes the process that owns it", async () => {
    await withTempHome(async () => {
      await persistOpenMeldToolsUpdateAttempt(attempt);

      await expect(resolveExternalOpenMeldToolsUpdate()).resolves.toEqual(
        attempt.operation
      );
      await expect(
        resolveExternalOpenMeldToolsUpdate({
          currentOperationId: attempt.operation.operationId,
        })
      ).resolves.toBeNull();
    });
  });

  it("waits for the existing durable operation instead of starting alongside it", async () => {
    await withTempHome(async () => {
      await persistOpenMeldToolsUpdateAttempt(attempt);
      const onWaiting = vi.fn(async () => {
        await discardPendingOpenMeldToolsUpdateAttempt();
      });

      await expect(
        waitForExternalOpenMeldToolsUpdate({
          onWaiting,
          pollIntervalMs: 1,
        })
      ).resolves.toBeUndefined();

      expect(onWaiting).toHaveBeenCalledTimes(1);
      expect(onWaiting).toHaveBeenCalledWith(attempt.operation);
    });
  });
  it("stops waiting when a persisted update is never claimed by its worker", async () => {
    await withTempHome(async () => {
      await persistOpenMeldToolsUpdateAttempt({ ...attempt, attempts: 0 });
      await expect(
        waitForExternalOpenMeldToolsUpdate({
          pollIntervalMs: 1,
          unclaimedTimeoutMs: 1,
        })
      ).rejects.toThrow("background updater did not start");
      expect((await resolveExternalOpenMeldToolsUpdate())?.operationId).toBe(
        attempt.operation.operationId
      );
    });
  });
});
