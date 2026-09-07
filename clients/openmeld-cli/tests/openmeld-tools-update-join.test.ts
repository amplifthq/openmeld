import type { OpenMeldToolsUpdateAttempt } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import {
  discardPendingOpenMeldToolsUpdateAttempt,
  persistOpenMeldToolsUpdateAttempt,
} from "../src/local-service/maintenance/openmeld-tools-update-attempt-state";
import {
  resolveExternalOpenMeldToolsUpdate,
  waitForExternalOpenMeldToolsUpdate,
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
  it("allows recovery while an update waits for work without discarding the update", async () => {
    await withTempHome(async () => {
      const waiting = {
        ...attempt,
        operation: { ...attempt.operation, phase: "waiting_for_work" as const },
      };
      await persistOpenMeldToolsUpdateAttempt(waiting);
      await waitForExternalOpenMeldToolsUpdate({
        allowRecoveryWhileWaitingForWork: true,
      });
      expect(await resolveExternalOpenMeldToolsUpdate()).toEqual(
        waiting.operation
      );
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
          allowRecoveryWhileWaitingForWork: true,
          onWaiting,
          pollIntervalMs: 1,
        })
      ).resolves.toBeUndefined();

      expect(onWaiting).toHaveBeenCalledTimes(1);
      expect(onWaiting).toHaveBeenCalledWith(attempt.operation);
    });
  });
});
