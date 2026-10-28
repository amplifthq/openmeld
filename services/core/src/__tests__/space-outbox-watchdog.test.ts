import type { PostgreSQLBinding } from "@openmeld/db/postgresql";
import type { SignalEnvelope } from "@openmeld/protocol";
import {
  CORE_READINESS_FACTS_CHANGED_MARKER_KIND,
  HOSTED_CENTER_AGENT_CONTROLLER_REF,
} from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import { createProjectionPostgresBinding } from "../../test-support/postgresql-query.test-support";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as dispatchQueueService from "../dispatch/application/dispatch-queue-service";
import { createDispatchOutboxRecord } from "../space/infrastructure/outbox/dispatch-outbox-repo";
import { Space } from "../space/transport/do/space";

const handedOffOutboxCandidate = {
  createdAtMs: 1_700_000_000_000,
  dispatchId: "dispatch-1",
  idempotencyKey: "space-1:signal-1:agt-1",
  outboxStatus: "handed_off",
  handedOffAtMs: 1_700_000_000_100,
  sourceClientMessageId: "client-message-1",
  sourceEventId: "signal-1",
  sourceSignalSnapshot: {
    profileId: "human-1",
    profileKind: "human",
    text: "@agent(wake) hello",
  },
  spaceId: "space-1",
  spaceNameSnapshot: null,
  targetProfileId: "agt-1",
  targetProfileNameSnapshot: "Codex Agent",
};

const createRuntimeCoordinatorRedriveOutboxRecord = () =>
  createDispatchOutboxRecord({
    bindingEnabled: true,
    bindingState: "bound",
    dispatchPolicy: "mention_only",
    nowMs: 1_700_000_000_000,
    ruleId: "registry.default.all_members.v1",
    ruleReason: "default allow all members mention",
    ruleSource: "registry",
    senderProfileId: "human-1",
    sourceClientMessageId: "client-message-1",
    sourceEventId: "signal-1",
    sourceSignalSnapshot: {
      profileId: "human-1",
      profileKind: "human",
      text: "@agent(wake) hello",
    },
    spaceId: "space-1",
    targetProfileId: "agt-1",
    targetProfileNameSnapshot: "Codex Agent",
  });

describe("space outbox watchdog", () => {
  it.each([
    false,
    true,
  ])("retains the handoff recovery alarm only for hosted admission (hosted=%s)", async (hosted) => {
    const deleteAlarm = vi.fn(async () => undefined);
    const setAlarm = vi.fn(async () => undefined);
    const getAlarm = vi.fn(async () => 1_700_000_015_000);
    const exec = vi.fn((_query: string, ...params: unknown[]) => ({
      toArray: () =>
        hosted && params.includes(HOSTED_CENTER_AGENT_CONTROLLER_REF)
          ? [{ dispatch_id: "dispatch-queued" }]
          : [],
    }));
    const space = createSpaceAlarmHarness({
      deleteAlarm,
      getAlarm,
      setAlarm,
      sql: { exec },
    });

    await space.syncDispatchOutboxAlarm();

    if (hosted) {
      expect(deleteAlarm).not.toHaveBeenCalled();
      expect(setAlarm).toHaveBeenCalledTimes(1);
    } else {
      expect(deleteAlarm).toHaveBeenCalledTimes(1);
      expect(setAlarm).not.toHaveBeenCalled();
    }
  });

  it("does not keep the dispatch outbox alarm alive without Queue or direct delivery", async () => {
    const deleteAlarm = vi.fn(async () => undefined);
    const setAlarm = vi.fn(async () => undefined);
    const getAlarm = vi.fn(async () => 1_700_000_015_000);
    const exec = vi.fn((query: string) => ({
      toArray: () =>
        query.includes("FROM openMeldDaemon_outbox")
          ? [{ dispatch_id: "dispatch-pending" }]
          : [],
    }));
    const space = createSpaceAlarmHarness({
      bindings: {},
      deleteAlarm,
      getAlarm,
      setAlarm,
      sql: { exec },
    });

    await space.syncDispatchOutboxAlarm();

    expect(deleteAlarm).toHaveBeenCalledTimes(1);
    expect(setAlarm).not.toHaveBeenCalled();
  });

  it("keeps the dispatch outbox alarm alive in direct delivery mode without Queue", async () => {
    const deleteAlarm = vi.fn(async () => undefined);
    const setAlarm = vi.fn(async () => undefined);
    const getAlarm = vi.fn(async () => null);
    const exec = vi.fn((query: string) => ({
      toArray: () =>
        query.includes("FROM openMeldDaemon_outbox")
          ? [{ dispatch_id: "dispatch-pending" }]
          : [],
    }));
    const space = createSpaceAlarmHarness({
      bindings: {
        OPENMELD_DAEMON_DISPATCH_OUTBOX_DELIVERY_MODE: "direct",
      },
      deleteAlarm,
      getAlarm,
      setAlarm,
      sql: { exec },
    });

    await space.syncDispatchOutboxAlarm();

    expect(deleteAlarm).not.toHaveBeenCalled();
    expect(setAlarm).toHaveBeenCalledTimes(1);
    expect(setAlarm).toHaveBeenCalledWith(expect.any(Number));
  });

  it("keeps production direct delivery armed without Queue", async () => {
    const deleteAlarm = vi.fn(async () => undefined);
    const setAlarm = vi.fn(async () => undefined);
    const getAlarm = vi.fn(async () => 1_700_000_015_000);
    const exec = vi.fn((query: string) => ({
      toArray: () =>
        query.includes("FROM openMeldDaemon_outbox")
          ? [{ dispatch_id: "dispatch-pending" }]
          : [],
    }));
    const space = createSpaceAlarmHarness({
      bindings: {
        OPENMELD_DAEMON_DISPATCH_OUTBOX_DELIVERY_MODE: "direct",
        OPENMELD_WORKER_ENVIRONMENT: "prod",
      },
      deleteAlarm,
      getAlarm,
      setAlarm,
      sql: { exec },
    });

    await space.syncDispatchOutboxAlarm();

    expect(deleteAlarm).not.toHaveBeenCalled();
    expect(setAlarm).toHaveBeenCalledTimes(1);
    expect(setAlarm).toHaveBeenCalledWith(expect.any(Number));
  });

  it("falls back to Queue with the same message when hosted direct delivery needs recovery", async () => {
    const queueSend = vi.fn(async () => undefined);
    const syncDispatchOutboxAlarm = vi.fn(async () => undefined);
    const sqlExec = vi.fn(() => ({ toArray: () => [] }));
    const directDelivery = vi
      .spyOn(dispatchQueueService, "dispatchOutboxMessageDirectly")
      .mockResolvedValue({
        reasonCode: "dispatch_direct_retry_requested",
        recoveryTransport: "queue",
        retryDelaySeconds: 1,
        status: "retry_scheduled",
      });
    const message = createRuntimeCoordinatorRedriveOutboxRecord();
    const space = createSpaceSubmissionHarness({
      bindings: {
        OPENMELD_DAEMON_DISPATCH_OUTBOX_DELIVERY_MODE: "direct",
        OPENMELD_DAEMON_DISPATCH_QUEUE: { send: queueSend },
        OPENMELD_WORKER_ENVIRONMENT: "prod",
      },
      sqlExec,
      syncDispatchOutboxAlarm,
    });

    const submission = await space.submitDispatchOutboxMessage(
      message,
      "flush_pending_outbox"
    );

    expect(submission).toEqual({ status: "enqueued" });
    expect(directDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ message })
    );
    expect(queueSend).toHaveBeenCalledWith(message);
    expect(syncDispatchOutboxAlarm).toHaveBeenCalled();
  });

  it.each([
    "local",
    "stg",
    "prod",
  ])("keeps workstation direct retries in the same durable outbox in %s", async (workerEnvironment) => {
    const queueSend = vi.fn(async () => undefined);
    const syncDispatchOutboxAlarm = vi.fn(async () => undefined);
    const sqlExec = vi.fn(() => ({ toArray: () => [] }));
    const directDelivery = vi
      .spyOn(dispatchQueueService, "dispatchOutboxMessageDirectly")
      .mockResolvedValue({
        reasonCode: "dispatch_direct_retry_requested",
        recoveryTransport: "outbox",
        retryDelaySeconds: 1,
        status: "retry_scheduled",
      });
    const message = createRuntimeCoordinatorRedriveOutboxRecord();
    const space = createSpaceSubmissionHarness({
      bindings: {
        OPENMELD_DAEMON_DISPATCH_OUTBOX_DELIVERY_MODE: "direct",
        OPENMELD_DAEMON_DISPATCH_QUEUE: { send: queueSend },
        OPENMELD_WORKER_ENVIRONMENT: workerEnvironment,
      },
      sqlExec,
      syncDispatchOutboxAlarm,
    });

    const submission = await space.submitDispatchOutboxMessage(
      message,
      "flush_pending_outbox"
    );

    expect(submission).toEqual({ status: "retry_scheduled" });
    expect(directDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ message })
    );
    expect(queueSend).not.toHaveBeenCalled();
    expect(syncDispatchOutboxAlarm).toHaveBeenCalled();
  });

  it("logs every owner deadline when a stale background alarm is rescheduled", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {
      // capture the persistent alarm-owner diagnostic
    });
    const space = createSpaceAlarmHarness({
      deleteAlarm: vi.fn(async () => undefined),
      getAlarm: vi.fn(async () => 1),
      setAlarm: vi.fn(async () => undefined),
      sql: {
        exec: (query: string) => ({
          toArray: () =>
            query.includes("FROM openMeldDaemon_outbox")
              ? [{ dispatch_id: "dispatch-pending" }]
              : [],
        }),
      },
    });

    await space.syncDispatchOutboxAlarm();

    expect(infoSpy).toHaveBeenCalledWith(
      "[core.openmeld.space.outbox.alarm_rescheduled_stale]",
      expect.objectContaining({
        nextAgentStreamAlarmAtMs: null,
        nextAlarmAtMs: expect.any(Number),
        nextDirtyProjectionAlarmAtMs: null,
        nextDispatchAlarmAtMs: expect.any(Number),
        nextMemberLivenessAlarmAtMs: null,
        nextProjectionAlarmAtMs: null,
        replacementAlarmAtMs: expect.any(Number),
      })
    );
    infoSpy.mockRestore();
  });

  it("does not redrive a handed-off outbox candidate when dispatch intake evidence is unavailable", async () => {
    const space = createSpaceHarness({ db: null });

    await expect(
      space.resolveHandedOffOutboxCandidateDecision(
        handedOffOutboxCandidate,
        1_700_000_030_000,
        buildLogContext()
      )
    ).rejects.toThrow("OPENMELD_POSTGRESQL Hyperdrive binding is required");
  });

  it("does not redrive a handed-off outbox candidate when dispatch intake evidence is missing", async () => {
    const db = createProjectionPostgresBinding(() => []);
    const space = createSpaceHarness({ db });

    await expect(
      space.resolveHandedOffOutboxCandidateDecision(
        handedOffOutboxCandidate,
        1_700_000_030_000,
        buildLogContext()
      )
    ).resolves.toMatchObject({
      intakeEvidenceState: "missing",
      kind: "skip",
      reason: "dispatch_intake_evidence_missing",
    });
  });

  it.each([
    "pending",
    "handed_off",
  ])("does not treat a %s hosted ledger read failure as missing intake evidence", async (outboxStatus) => {
    const db = createProjectionPostgresBinding(() => {
      throw new Error("PostgreSQL read failed");
    });
    const space = createSpaceHarness({ db });
    const candidate = {
      ...handedOffOutboxCandidate,
      outboxStatus,
      controllerSnapshot: {
        agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
        targetBindingEnabled: true,
        targetBindingState: "bound" as const,
      },
    };
    await expect(
      space.resolveHandedOffOutboxCandidateDecision(
        candidate,
        1_700_000_030_000,
        buildLogContext()
      )
    ).resolves.toMatchObject({
      intakeEvidenceState: "unavailable",
      kind: "skip",
      reason: "dispatch_ledger_read_failed",
    });
  });

  it.each([
    "pending",
    "handed_off",
  ])("redrives a %s hosted Wake on its original identity when native admission never became durable", async (outboxStatus) => {
    const db = createProjectionPostgresBinding((query) =>
      query.text?.includes("openMeldRemoteAgent_native_delivery_ledger")
        ? []
        : [
            {
              connection_generation: null,
              daemon_session_id: null,
              last_attempt_at_ms: 1_700_000_001_000,
              latest_attempt_error_code: null,
              latest_attempt_status: "dispatching",
              lease_epoch: null,
              status: "queued",
            },
          ]
    );
    const space = createSpaceHarness({ db });
    const candidate = {
      ...handedOffOutboxCandidate,
      outboxStatus,
      controllerSnapshot: {
        agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
        targetBindingEnabled: true,
        targetBindingState: "bound" as const,
      },
    };

    await expect(
      space.resolveHandedOffOutboxCandidateDecision(
        candidate,
        1_700_000_030_000,
        buildLogContext()
      )
    ).resolves.toMatchObject({
      deliveryRecoveryReason: "hosted_admission_incomplete",
      kind: "submit",
    });
  });

  it("uses the frozen hosted route when the current Binding may have changed", async () => {
    const db = createProjectionPostgresBinding(() => []);
    const space = createSpaceHarness({ db }) as ReturnType<
      typeof createSpaceHarness
    > & {
      readHostedNativeDeliveryHandoffState: (
        candidate: typeof handedOffOutboxCandidate & {
          controllerSnapshot: {
            agentControllerRef: string;
            targetBindingEnabled: boolean;
            targetBindingState: "bound";
          };
        }
      ) => Promise<string>;
    };

    await expect(
      space.readHostedNativeDeliveryHandoffState({
        ...handedOffOutboxCandidate,
        controllerSnapshot: {
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          targetBindingEnabled: true,
          targetBindingState: "bound",
        },
      })
    ).resolves.toBe("admission_incomplete");
    // The frozen hosted route does not depend on a mutable Binding.
  });

  it("redrives a handed-off outbox seed when RuntimeCoordinator reports route reconnect", async () => {
    const outboxRecord = createRuntimeCoordinatorRedriveOutboxRecord();
    const queueSend = vi.fn(async () => undefined);
    const space = createInternalRedriveHarness({
      dispatchId: outboxRecord.dispatchId,
      payloadJson: outboxRecord.payloadJson,
      queueSend,
    });

    const response = await space.fetch(
      new Request(
        `https://space.test/internal/dispatches/${outboxRecord.dispatchId}/redrive?space=space-1`,
        {
          body: JSON.stringify({
            reason: "runtime_coordinator_head_waiting_recovery",
            targetProfileId: "agt-1",
            targetWakeLifecycleId: "twl_v1|7:space-1|8:signal-1|5:agt-1",
          }),
          headers: {
            "content-type": "application/json",
            "x-openmeld-internal-dispatch-redrive":
              "runtime_coordinator_head_waiting_recovery",
          },
          method: "POST",
        }
      )
    );

    await expect(response.json()).resolves.toMatchObject({
      dispatchId: outboxRecord.dispatchId,
      ok: true,
      status: "enqueued",
      targetProfileId: "agt-1",
    });
    expect(queueSend).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryRecoveryReason: "route_lost",
        dispatchId: outboxRecord.dispatchId,
        targetProfileId: "agt-1",
      })
    );
  });

  it("redrives the exact Space-owned outbox seed after coordinator promotion", async () => {
    const outboxRecord = createRuntimeCoordinatorRedriveOutboxRecord();
    const queueSend = vi.fn(async () => undefined);
    const space = createInternalRedriveHarness({
      dispatchId: outboxRecord.dispatchId,
      payloadJson: outboxRecord.payloadJson,
      queueSend,
    });

    const response = await space.fetch(
      new Request(
        `https://space.test/internal/dispatches/${outboxRecord.dispatchId}/redrive?space=space-1`,
        {
          body: JSON.stringify({
            reason: "agent_profile_work_coordinator_promotion",
            targetProfileId: "agt-1",
            targetWakeLifecycleId: "twl_v1|7:space-1|8:signal-1|5:agt-1",
          }),
          headers: {
            "content-type": "application/json",
            "x-openmeld-internal-dispatch-redrive":
              "agent_profile_work_coordinator_promotion",
          },
          method: "POST",
        }
      )
    );

    await expect(response.json()).resolves.toMatchObject({
      dispatchId: outboxRecord.dispatchId,
      ok: true,
      status: "enqueued",
      targetProfileId: "agt-1",
    });
    expect(queueSend).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryRecoveryReason: "agent_profile_work_coordinator_promoted",
        dispatchId: outboxRecord.dispatchId,
        enqueuedAtMs: handedOffOutboxCandidate.handedOffAtMs,
        sourceSignalSnapshot: {
          profileId: "human-1",
          profileKind: "human",
          text: "@agent(wake) hello",
        },
        targetProfileId: "agt-1",
      })
    );
  });

  it("reports a durable workstation outbox retry without inventing a Queue failure", async () => {
    const outboxRecord = createRuntimeCoordinatorRedriveOutboxRecord();
    const directDelivery = vi
      .spyOn(dispatchQueueService, "dispatchOutboxMessageDirectly")
      .mockResolvedValue({
        reasonCode: "dispatch_direct_retry_requested",
        recoveryTransport: "outbox",
        retryDelaySeconds: 1,
        status: "retry_scheduled",
      });
    const space = createInternalRedriveHarness({
      deliveryMode: "direct",
      dispatchId: outboxRecord.dispatchId,
      payloadJson: outboxRecord.payloadJson,
    });

    const response = await space.fetch(
      new Request(
        `https://space.test/internal/dispatches/${outboxRecord.dispatchId}/redrive?space=space-1`,
        {
          body: JSON.stringify({
            reason: "runtime_coordinator_head_waiting_recovery",
            targetProfileId: "agt-1",
            targetWakeLifecycleId: "twl_v1|7:space-1|8:signal-1|5:agt-1",
          }),
          headers: {
            "content-type": "application/json",
            "x-openmeld-internal-dispatch-redrive":
              "runtime_coordinator_head_waiting_recovery",
          },
          method: "POST",
        }
      )
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      dispatchId: outboxRecord.dispatchId,
      ok: true,
      status: "retry_scheduled",
      targetProfileId: "agt-1",
    });
    expect(directDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({
          dispatchId: outboxRecord.dispatchId,
          targetProfileId: "agt-1",
        }),
      })
    );
  });

  it("does not redrive when the request target Wake lifecycle id does not match the outbox seed", async () => {
    const outboxRecord = createRuntimeCoordinatorRedriveOutboxRecord();
    const queueSend = vi.fn(async () => undefined);
    const space = createInternalRedriveHarness({
      dispatchId: outboxRecord.dispatchId,
      payloadJson: outboxRecord.payloadJson,
      queueSend,
    });

    const response = await space.fetch(
      new Request(
        `https://space.test/internal/dispatches/${outboxRecord.dispatchId}/redrive?space=space-1`,
        {
          body: JSON.stringify({
            reason: "runtime_coordinator_head_waiting_recovery",
            targetProfileId: "agt-1",
            targetWakeLifecycleId: "twl_v1|7:space-1|8:signal-1|7:agt-old",
          }),
          headers: {
            "content-type": "application/json",
            "x-openmeld-internal-dispatch-redrive":
              "runtime_coordinator_head_waiting_recovery",
          },
          method: "POST",
        }
      )
    );

    await expect(response.json()).resolves.toMatchObject({
      dispatchId: outboxRecord.dispatchId,
      ok: false,
      reasonCode: "space.dispatch_outbox_redrive_lifecycle_mismatch",
      status: "lifecycle_mismatch",
      targetProfileId: "agt-1",
    });
    expect(queueSend).not.toHaveBeenCalled();
  });

  it("keeps flushing the remaining outbox candidates when one candidate throws", async () => {
    const failing = createOutboxRecordForSource("signal-poison");
    const healthy = createOutboxRecordForSource("signal-2");
    const decisionSpy = vi.fn((candidate: { dispatchId: string }) =>
      candidate.dispatchId === failing.dispatchId
        ? Promise.reject(new Error("identity projection failed"))
        : Promise.resolve(buildSkipDecision())
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {
      // silence expected candidate failure diagnostics
    });
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {
      // silence flush progress logs
    });
    const { space } = createFlushHarness({
      candidateRows: [toOutboxRow(failing), toOutboxRow(healthy)],
      resolveDecision: decisionSpy,
    });

    await space.flushPendingDispatchOutbox();

    expect(decisionSpy).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledWith(
      "[core.openmeld.space.outbox.candidate_failed]",
      expect.objectContaining({
        dispatchId: failing.dispatchId,
        failureCount: 1,
      })
    );
    errorSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it("processes only 20 candidates and requests an immediate continuation for the backlog", async () => {
    const records = Array.from({ length: 21 }, (_, index) =>
      createOutboxRecordForSource(`signal-burst-${index + 1}`)
    );
    const decisionSpy = vi.fn(() =>
      Promise.resolve({
        human: {
          sourceProfileName: null,
          spaceName: "Test Space",
          targetProfileName: "Codex Agent",
        },
        kind: "delete",
      })
    );
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {
      // silence flush progress logs
    });
    const { space } = createFlushHarness({
      candidateRows: records.map(toOutboxRow),
      resolveDecision: decisionSpy,
    });

    await space.flushPendingDispatchOutbox();

    expect(decisionSpy).toHaveBeenCalledTimes(20);
    expect(
      (
        space as typeof space & {
          dispatchOutboxContinuationDueAtMs: number | null;
        }
      ).dispatchOutboxContinuationDueAtMs
    ).toEqual(expect.any(Number));
    expect(infoSpy).toHaveBeenCalledWith(
      "[core.openmeld.space.outbox.flush_completed]",
      expect.objectContaining({
        candidateCount: 20,
        continuationRequested: true,
      })
    );
    infoSpy.mockRestore();
  });

  it("retains terminal outbox evidence while clearing its replay payload", async () => {
    const terminal = createOutboxRecordForSource("signal-terminal");
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {
      // silence flush progress logs
    });
    const { exec, space } = createFlushHarness({
      candidateRows: [toOutboxRow(terminal)],
      resolveDecision: vi.fn(() =>
        Promise.resolve({
          human: {
            sourceProfileName: null,
            spaceName: "Test Space",
            targetProfileName: "Codex Agent",
          },
          kind: "delete",
        })
      ),
    });

    await space.flushPendingDispatchOutbox();

    expect(exec).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE openMeldDaemon_outbox"),
      terminal.dispatchId
    );
    infoSpy.mockRestore();
  });

  it("keeps the same Wake recoverable through repeated PostgreSQL overload without rapid retries or a false account failure", async () => {
    const candidate = createOutboxRecordForSource("signal-storage-overload");
    let nowMs = 1_700_000_100_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => nowMs);
    const decision = vi.fn((_candidate: { dispatchId: string }) =>
      Promise.reject(
        Object.assign(new Error("too many connections"), { code: "53300" })
      )
    );
    const { poisonStateByDispatchId, space, terminalSignals } =
      createFlushHarness({
        candidateRows: [toOutboxRow(candidate)],
        resolveDecision: decision,
      });
    try {
      await space.flushPendingDispatchOutbox();
      nowMs += 1000;
      await space.flushPendingDispatchOutbox();
      expect(decision).toHaveBeenCalledTimes(1);
      nowMs += 14_000;
      await space.flushPendingDispatchOutbox();
      nowMs += 15_000;
      await space.flushPendingDispatchOutbox();
      expect(decision).toHaveBeenCalledTimes(3);
      expect(terminalSignals).toHaveLength(0);
      expect(poisonStateByDispatchId.get(candidate.dispatchId)).toEqual({
        failureCount: 0,
        poisonedAtMs: null,
      });
      nowMs += 15_000;
      await space.flushPendingDispatchOutbox();
      expect(decision).toHaveBeenCalledTimes(4);
      expect(
        decision.mock.calls.every(
          ([entry]) => entry.dispatchId === candidate.dispatchId
        )
      ).toBe(true);
      expect(terminalSignals).toHaveLength(0);
    } finally {
      clock.mockRestore();
    }
  });

  it("shares an in-flight outbox flush instead of processing the same Wake concurrently", async () => {
    const candidate = createOutboxRecordForSource("signal-concurrent-flush");
    let finish: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const decision = vi.fn(async () => {
      await pending;
      return { kind: "keep" };
    });
    const { space } = createFlushHarness({
      candidateRows: [toOutboxRow(candidate)],
      resolveDecision: decision,
    });
    const first = space.flushPendingDispatchOutbox();
    const second = space.flushPendingDispatchOutbox();
    finish?.();
    await Promise.all([first, second]);
    expect(decision).toHaveBeenCalledTimes(1);
  });

  it("parks a poison outbox candidate after repeated failures", async () => {
    const poison = createOutboxRecordForSource("signal-poison");
    const decisionSpy = vi.fn(() =>
      Promise.reject(new Error("identity projection failed"))
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {
      // silence expected candidate failure diagnostics
    });
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {
      // silence flush progress logs
    });
    const { broadcastSignal, poisonStateByDispatchId, terminalSignals, space } =
      createFlushHarness({
        candidateRows: [toOutboxRow(poison)],
        resolveDecision: decisionSpy,
      });

    await space.flushPendingDispatchOutbox();
    await space.flushPendingDispatchOutbox();
    expect(poisonStateByDispatchId.get(poison.dispatchId)).toMatchObject({
      failureCount: 2,
      poisonedAtMs: null,
    });

    await space.flushPendingDispatchOutbox();
    expect(poisonStateByDispatchId.get(poison.dispatchId)).toEqual({
      failureCount: 3,
      poisonedAtMs: expect.any(Number),
    });
    expect(terminalSignals).toHaveLength(1);
    expect(terminalSignals[0]).toMatchObject({
      data: {
        actorName: "Codex Agent",
        actorProfileId: poison.targetProfileId,
        coreReadinessFactsChanged: {
          agentProfileId: poison.targetProfileId,
          kind: CORE_READINESS_FACTS_CHANGED_MARKER_KIND,
        },
        dispatchId: poison.dispatchId,
        generatedBy: "openmeld",
        noticeType: "terminal_failure",
        reason: "dispatch.outbox.candidate_failed",
        text: "OpenMeld could not prepare this request for @Codex Agent. Try again. If it keeps failing, report the issue from the message details.",
      },
      type: "signal.system_notice",
    });
    expect(broadcastSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        id: terminalSignals[0]?.id,
      }),
      {
        finalOutcomeAuthority: "runtime_coordinator_failure_publication",
      },
      { persisted: true }
    );
    expect(errorSpy).toHaveBeenCalledWith(
      "[core.openmeld.space.outbox.candidate_poisoned]",
      expect.objectContaining({
        dispatchId: poison.dispatchId,
        failureCount: 3,
      })
    );
    await space.flushPendingDispatchOutbox();
    expect(decisionSpy).toHaveBeenCalledTimes(3);
    errorSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it("keeps a poison outbox candidate retryable when the terminal notice is not visible", async () => {
    const poison = createOutboxRecordForSource("signal-poison");
    const decisionSpy = vi.fn(() =>
      Promise.reject(new Error("identity projection failed"))
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {
      // silence expected candidate failure diagnostics
    });
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {
      // silence flush progress logs
    });
    const { poisonStateByDispatchId, space, terminalSignals } =
      createFlushHarness({
        candidateRows: [toOutboxRow(poison)],
        persistTerminalFailure: false,
        resolveDecision: decisionSpy,
      });

    await space.flushPendingDispatchOutbox();
    await space.flushPendingDispatchOutbox();
    await space.flushPendingDispatchOutbox();

    expect(poisonStateByDispatchId.get(poison.dispatchId)).toEqual({
      failureCount: 3,
      poisonedAtMs: null,
    });
    expect(terminalSignals).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalledWith(
      "[core.openmeld.space.outbox.candidate_poison_terminal_failure_failed]",
      expect.objectContaining({
        dispatchId: poison.dispatchId,
        failureCount: 3,
        publicationErrorCode:
          "space.outbox_poison.terminal_failure_not_persisted",
      })
    );

    await space.flushPendingDispatchOutbox();
    expect(decisionSpy).toHaveBeenCalledTimes(4);
    expect(poisonStateByDispatchId.get(poison.dispatchId)).toEqual({
      failureCount: 4,
      poisonedAtMs: null,
    });
    errorSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it("runs the remaining alarm lanes when one lane fails", async () => {
    const lanes = {
      flushDirtyMemberProjection: vi.fn(() => Promise.resolve(undefined)),
      flushPendingDispatchOutbox: vi.fn(() => Promise.resolve(undefined)),
      flushPendingSpaceIndexProjectionOutbox: vi.fn(() =>
        Promise.reject(new Error("projection lane down"))
      ),
      reconcileDeletedAgentProfileMemberLiveness: vi.fn(() =>
        Promise.resolve(undefined)
      ),
      syncSpaceBackgroundAlarm: vi.fn(() => Promise.resolve(undefined)),
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {
      // silence expected lane failure diagnostics
    });
    const space = createAlarmLaneHarness(lanes);

    await space.alarm();

    expect(lanes.flushPendingDispatchOutbox).toHaveBeenCalledTimes(1);
    expect(
      lanes.reconcileDeletedAgentProfileMemberLiveness
    ).toHaveBeenCalledTimes(1);
    expect(lanes.flushDirtyMemberProjection).toHaveBeenCalledTimes(1);
    // A failed lane persists its backoff and re-arms before the final sync.
    expect(lanes.syncSpaceBackgroundAlarm).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledWith(
      "[core.openmeld.space.alarm_step_failed]",
      expect.objectContaining({ step: "space_index_projection_outbox" })
    );
    errorSpy.mockRestore();
  });

  it("lets a failing final alarm re-sync surface to the platform retry", async () => {
    const space = createAlarmLaneHarness({
      flushDirtyMemberProjection: vi.fn(() => Promise.resolve(undefined)),
      flushPendingDispatchOutbox: vi.fn(() => Promise.resolve(undefined)),
      flushPendingSpaceIndexProjectionOutbox: vi.fn(() =>
        Promise.resolve(undefined)
      ),
      reconcileDeletedAgentProfileMemberLiveness: vi.fn(() =>
        Promise.resolve(undefined)
      ),
      syncSpaceBackgroundAlarm: vi.fn(() =>
        Promise.reject(new Error("alarm sync down"))
      ),
    });

    await expect(space.alarm()).rejects.toThrow("alarm sync down");
  });
});

const createSpaceHarness = (input: { db: PostgreSQLBinding | null }) => {
  const space = Object.create(Space.prototype) as {
    bindings: { OPENMELD_POSTGRESQL: PostgreSQLBinding | null };
    ctx: { storage: { sql: unknown } };
    resolveHandedOffOutboxCandidateDecision: (
      candidate: typeof handedOffOutboxCandidate,
      nowMs: number,
      logContext: ReturnType<typeof buildLogContext>
    ) => Promise<unknown>;
    spaceId: string;
  };
  Object.defineProperties(space, {
    bindings: {
      value: {
        OPENMELD_POSTGRESQL: input.db,
      },
    },
    ctx: {
      value: {
        storage: {
          sql: {
            exec: () => ({
              toArray: () => [],
            }),
          },
        },
      },
    },
    spaceId: { value: "space-1", writable: true },
  });
  return space;
};

const buildLogContext = () => ({
  profileNameByProfileId: new Map<string, string>(),
  spaceName: "Test Space",
});

const createSpaceAlarmHarness = (input: {
  bindings?: Record<string, unknown>;
  deleteAlarm: () => Promise<void>;
  getAlarm: () => Promise<number | null>;
  setAlarm: (scheduledTime: number) => Promise<void>;
  sql: {
    exec: (query: string, ...params: unknown[]) => { toArray: () => unknown[] };
  };
}) => {
  const bindings = input.bindings ?? {
    OPENMELD_DAEMON_DISPATCH_QUEUE: {},
  };
  const space = Object.create(Space.prototype) as {
    bindings: Record<string, unknown>;
    ctx: {
      storage: {
        deleteAlarm: () => Promise<void>;
        getAlarm: () => Promise<number | null>;
        list<T>(options: { prefix: string }): Promise<Map<string, T>>;
        setAlarm: (scheduledTime: number) => Promise<void>;
        sql: typeof input.sql;
      };
    };
    env: Record<string, unknown>;
    spaceId: string;
    syncDispatchOutboxAlarm: () => Promise<void>;
  };
  Object.defineProperty(space, "bindings", {
    value: { OPENMELD_POSTGRESQL: createProjectionPostgresBinding(() => []) },
    configurable: true,
  });
  Object.defineProperties(space, {
    bindings: {
      value: {
        OPENMELD_POSTGRESQL: createProjectionPostgresBinding(() => []),
        ...bindings,
      },
    },
    ctx: {
      value: {
        storage: {
          get: <T>() => Promise.resolve<T | undefined>(undefined),
          deleteAlarm: input.deleteAlarm,
          getAlarm: input.getAlarm,
          list: <T>() => Promise.resolve(new Map<string, T>()),
          setAlarm: input.setAlarm,
          sql: input.sql,
        },
      },
    },
    env: { value: bindings },
    spaceId: { value: "space-1", writable: true },
  });
  return space;
};

const createSpaceSubmissionHarness = (input: {
  bindings: Record<string, unknown>;
  sqlExec: (
    query: string,
    ...params: unknown[]
  ) => {
    toArray: () => unknown[];
  };
  syncDispatchOutboxAlarm: () => Promise<void>;
}) => {
  const space = Object.create(Space.prototype) as {
    bindings: Record<string, unknown>;
    ctx: {
      storage: {
        sql: {
          exec: typeof input.sqlExec;
        };
      };
      waitUntil(promise: Promise<unknown>): void;
    };
    spaceId: string;
    submitDispatchOutboxMessage: (
      message: ReturnType<typeof createRuntimeCoordinatorRedriveOutboxRecord>,
      reason: "flush_pending_outbox"
    ) => Promise<boolean>;
    syncDispatchOutboxAlarm: () => Promise<void>;
  };
  Object.defineProperty(space, "bindings", {
    value: { OPENMELD_POSTGRESQL: createProjectionPostgresBinding(() => []) },
    configurable: true,
  });
  Object.defineProperties(space, {
    bindings: {
      value: {
        OPENMELD_POSTGRESQL: createProjectionPostgresBinding(() => []),
        ...input.bindings,
      },
    },
    ctx: {
      value: {
        storage: {
          sql: {
            exec: input.sqlExec,
          },
        },
        waitUntil: vi.fn(),
      },
    },
    spaceId: { value: "space-1", writable: true },
    syncDispatchOutboxAlarm: {
      value: input.syncDispatchOutboxAlarm,
    },
  });
  return space;
};

const createOutboxRecordForSource = (sourceEventId: string) =>
  createDispatchOutboxRecord({
    bindingEnabled: true,
    bindingState: "bound",
    dispatchPolicy: "mention_only",
    nowMs: 1_700_000_000_000,
    ruleId: "registry.default.all_members.v1",
    ruleReason: "default allow all members mention",
    ruleSource: "registry",
    senderProfileId: "human-1",
    sourceClientMessageId: "client-message-1",
    sourceEventId,
    sourceSignalSnapshot: {
      profileId: "human-1",
      profileKind: "human",
      text: "@agent(wake) hello",
    },
    spaceId: "space-1",
    targetProfileId: "agt-1",
    targetProfileNameSnapshot: "Codex Agent",
  });

const toOutboxRow = (record: { payloadJson: string }) => ({
  created_at_ms: 1_700_000_000_000,
  payload_json: record.payloadJson,
  queued_at_ms: 1_700_000_000_100,
  status: "queued",
});

const buildSkipDecision = () => ({
  human: {
    sourceProfileName: null,
    spaceName: "Test Space",
    targetProfileName: "Codex Agent",
  },
  intakeEvidenceState: "found",
  kind: "skip",
  reason: "dispatch_intake_evidence_exists",
});

const createFlushHarness = (input: {
  candidateRows: ReturnType<typeof toOutboxRow>[];
  persistTerminalFailure?: boolean;
  resolveDecision: (
    candidate: { dispatchId: string },
    nowMs: number,
    logContext: unknown
  ) => Promise<unknown>;
}) => {
  const finalClaimByDispatchAndProfile = new Map<string, string>();
  const poisonStateByDispatchId = new Map(
    input.candidateRows.map((row) => [
      readDispatchIdFromOutboxRow(row),
      { failureCount: 0, poisonedAtMs: null as number | null },
    ])
  );
  const signalRows = new Map<string, SignalEnvelope>();
  const terminalSignals: SignalEnvelope[] = [];
  const exec = vi.fn((query: string, ...params: unknown[]) => {
    if (
      query.includes(
        "poison_failure_count = COALESCE(poison_failure_count, 0) + 1"
      )
    ) {
      const dispatchId = String(params[0] ?? "");
      const state = poisonStateByDispatchId.get(dispatchId);
      if (state) {
        state.failureCount += 1;
      }
      return { rowsWritten: state ? 1 : 0, toArray: () => [] };
    }
    if (query.includes("poisoned_at_ms = COALESCE(poisoned_at_ms")) {
      const dispatchId = String(params[2] ?? "");
      const state = poisonStateByDispatchId.get(dispatchId);
      if (state && state.failureCount >= Number(params[3] ?? 0)) {
        state.poisonedAtMs = Number(params[0] ?? 0);
      }
      return { rowsWritten: state ? 1 : 0, toArray: () => [] };
    }
    if (query.includes("SELECT poison_failure_count, poisoned_at_ms")) {
      const state = poisonStateByDispatchId.get(String(params[0] ?? ""));
      return {
        toArray: () => [
          {
            poison_failure_count: state?.failureCount ?? 0,
            poisoned_at_ms: state?.poisonedAtMs ?? null,
          },
        ],
      };
    }
    if (query.includes("FROM space_final_reply_claims")) {
      const signalId =
        finalClaimByDispatchAndProfile.get(
          `${String(params[0] ?? "")}:${String(params[1] ?? "")}`
        ) ?? null;
      return {
        toArray: () => (signalId ? [{ signal_id: signalId }] : []),
      };
    }
    if (query.includes("poison_failure_count = 0")) {
      const state = poisonStateByDispatchId.get(String(params[0] ?? ""));
      if (state) {
        state.failureCount = 0;
        state.poisonedAtMs = null;
      }
      return { rowsWritten: state ? 1 : 0, toArray: () => [] };
    }
    if (
      query.includes("FROM openMeldDaemon_outbox") &&
      query.includes("SELECT")
    ) {
      return {
        toArray: () =>
          input.candidateRows.filter((row) => {
            const dispatchId = readDispatchIdFromOutboxRow(row);
            return (
              poisonStateByDispatchId.get(dispatchId)?.poisonedAtMs === null
            );
          }),
      };
    }
    return { toArray: () => [] };
  });
  let terminalSignalCount = 0;
  const broadcastSignal = vi.fn();
  const persistSignalWithOptionalOutbox = vi.fn((signal: SignalEnvelope) => {
    if (input.persistTerminalFailure === false) {
      return {
        dispatchMessages: [],
        duplicateFinalReplyBlocked: false,
        persistedSignal: false,
      };
    }
    if (signal.type === "signal.system_notice") {
      finalClaimByDispatchAndProfile.set(
        `${signal.data.dispatchId}:${signal.data.actorProfileId}`,
        signal.id
      );
      signalRows.set(signal.id, signal);
      terminalSignals.push(signal);
    }
    return {
      dispatchMessages: [],
      duplicateFinalReplyBlocked: false,
      persistedSignal: true,
    };
  });
  const space = Object.create(Space.prototype) as {
    broadcastSignal: typeof broadcastSignal;
    buildSystemNoticeSignal: (
      profile: SignalEnvelope["profile"],
      data: Extract<SignalEnvelope, { type: "signal.system_notice" }>["data"]
    ) => SignalEnvelope;
    flushPendingDispatchOutbox: () => Promise<void>;
    persistSignalWithOptionalOutbox: typeof persistSignalWithOptionalOutbox;
    readSignalById: (signalId: string) => SignalEnvelope | null;
    resolveThreadContextForSignal: () => null;
    spaceId: string;
  };
  Object.defineProperty(space, "bindings", {
    value: { OPENMELD_POSTGRESQL: createProjectionPostgresBinding(() => []) },
    configurable: true,
  });
  Object.defineProperties(space, {
    broadcastSignal: { value: broadcastSignal },
    buildSystemNoticeSignal: {
      value: (
        profile: SignalEnvelope["profile"],
        data: Extract<SignalEnvelope, { type: "signal.system_notice" }>["data"]
      ) =>
        ({
          v: 1,
          id: `sig-terminal-${++terminalSignalCount}`,
          spaceId: "space-1",
          ts: 1_700_000_000_300 + terminalSignalCount,
          profile,
          type: "signal.system_notice",
          data,
        }) satisfies SignalEnvelope,
    },
    ctx: {
      value: {
        storage: {
          sql: { exec },
        },
      },
    },
    persistSignalWithOptionalOutbox: { value: persistSignalWithOptionalOutbox },
    readSignalById: {
      value: vi.fn((signalId: string) => signalRows.get(signalId) ?? null),
    },
    resolveHandedOffOutboxCandidateDecision: { value: input.resolveDecision },
    resolveThreadContextForSignal: { value: vi.fn(() => null) },
    spaceId: { value: "space-1", writable: true },
    syncDispatchOutboxAlarm: { value: vi.fn(async () => undefined) },
  });
  return {
    broadcastSignal,
    exec,
    persistSignalWithOptionalOutbox,
    poisonStateByDispatchId,
    space,
    terminalSignals,
  };
};

const readDispatchIdFromOutboxRow = (
  row: ReturnType<typeof toOutboxRow>
): string => {
  const parsed = JSON.parse(row.payload_json) as { dispatchId?: unknown };
  return String(parsed.dispatchId ?? "");
};

const createAlarmLaneHarness = (lanes: {
  flushDirtyMemberProjection: () => Promise<void>;
  flushPendingDispatchOutbox: () => Promise<void>;
  flushPendingSpaceIndexProjectionOutbox: () => Promise<void>;
  reconcileDeletedAgentProfileMemberLiveness: () => Promise<void>;
  syncSpaceBackgroundAlarm: () => Promise<void>;
}) => {
  const storedValues = new Map<string, unknown>();
  const space = Object.create(Space.prototype) as {
    alarm: () => Promise<void>;
    spaceId: string;
  };
  Object.defineProperty(space, "bindings", {
    value: { OPENMELD_POSTGRESQL: createProjectionPostgresBinding(() => []) },
    configurable: true,
  });
  Object.defineProperties(space, {
    ctx: {
      value: {
        storage: {
          get: (key: string) => Promise.resolve(storedValues.get(key)),
          put: (key: string, value: unknown) => {
            storedValues.set(key, value);
            return Promise.resolve();
          },
          delete: (key: string) => Promise.resolve(storedValues.delete(key)),
        },
      },
    },
    flushDirtyMemberProjection: { value: lanes.flushDirtyMemberProjection },
    flushPendingDispatchOutbox: { value: lanes.flushPendingDispatchOutbox },
    flushPendingSpaceIndexProjectionOutbox: {
      value: lanes.flushPendingSpaceIndexProjectionOutbox,
    },
    reconcileDeletedAgentProfileMemberLiveness: {
      value: lanes.reconcileDeletedAgentProfileMemberLiveness,
    },
    spaceId: { value: "space-1", writable: true },
    syncSpaceBackgroundAlarm: { value: lanes.syncSpaceBackgroundAlarm },
  });
  return space;
};

const createInternalRedriveHarness = (input: {
  deliveryMode?: "direct" | "queue";
  dispatchId: string;
  payloadJson: string;
  queueSend?: (message: unknown) => Promise<void>;
}) => {
  const exec = vi.fn((query: string, ...params: unknown[]) => {
    if (
      query.includes("FROM openMeldDaemon_outbox") &&
      params.includes(input.dispatchId)
    ) {
      return {
        toArray: () => [
          {
            created_at_ms: 1_700_000_000_000,
            payload_json: input.payloadJson,
            queued_at_ms: 1_700_000_000_100,
            status: "queued",
          },
        ],
      };
    }
    return { toArray: () => [] };
  });
  const space = Object.create(Space.prototype) as {
    bindings: {
      OPENMELD_DAEMON_DISPATCH_OUTBOX_DELIVERY_MODE?: string;
      OPENMELD_DAEMON_DISPATCH_QUEUE?: {
        send: (message: unknown) => Promise<void>;
      };
      OPENMELD_WORKER_ENVIRONMENT?: string;
    };
    ctx: { storage: { sql: { exec: typeof exec } } };
    durableObjectId: string;
    fetch: (request: Request) => Promise<Response>;
    spaceId: string;
    syncDispatchOutboxAlarm: () => Promise<void>;
  };
  Object.defineProperty(space, "bindings", {
    value: { OPENMELD_POSTGRESQL: createProjectionPostgresBinding(() => []) },
    configurable: true,
  });
  Object.defineProperties(space, {
    bindings: {
      value: {
        OPENMELD_POSTGRESQL: createProjectionPostgresBinding(() => []),
        ...(input.deliveryMode === "direct"
          ? {
              OPENMELD_DAEMON_DISPATCH_OUTBOX_DELIVERY_MODE: "direct",
              OPENMELD_WORKER_ENVIRONMENT: "prod",
            }
          : {
              OPENMELD_DAEMON_DISPATCH_QUEUE: {
                send: input.queueSend,
              },
            }),
      },
    },
    ctx: {
      value: {
        storage: {
          sql: { exec },
        },
      },
    },
    durableObjectId: { value: "space-1" },
    spaceId: { value: "space-1", writable: true },
    syncDispatchOutboxAlarm: { value: vi.fn(async () => undefined) },
  });
  return space;
};
