import type { OpenMeldToolsUpdateAttempt } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
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
});
