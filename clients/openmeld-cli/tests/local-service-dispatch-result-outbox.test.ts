import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION } from "@openmeld/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CurrentDaemonSocketRef,
  LedgerPaths,
} from "../src/local-service/core/types";
import { readRecentDaemonDispatchJournalEvents } from "../src/local-service/dispatch/daemon-dispatch-journal";
import {
  acknowledgeDispatchResultOutboxRecord,
  enqueueDispatchResultOutboxRecord,
  flushDispatchResultOutbox,
  waitForDispatchResultOutboxAcknowledgement,
  waitForDispatchResultOutboxSettlement,
} from "../src/local-service/dispatch/dispatch-result-outbox";
import type { Presenter } from "../src/runtime/presenter/types";
import { withTempHome } from "./helpers/fs";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const createPresenter = (): Presenter =>
  ({
    data: vi.fn(),
    event: vi.fn(),
    line: vi.fn(),
    view: "agent",
  }) as Presenter;

const createLedgerPaths = (): LedgerPaths => {
  const rootDirPath = mkdtempSync(join(tmpdir(), "openmeld-result-outbox-"));
  tempDirs.push(rootDirPath);
  return {
    backupStateFilePath: join(rootDirPath, "backup.json"),
    historyFilePath: join(rootDirPath, "history.json"),
    historyTempFilePath: join(rootDirPath, "history.tmp.json"),
    rootDirPath,
    stateFilePath: join(rootDirPath, "state.json"),
    stateTempFilePath: join(rootDirPath, "state.tmp.json"),
  };
};

const createResultIdentityEcho = () => ({
  echoSource: "daemon_delivery_context" as const,
  core: {
    modelVersion: RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
    spaceId: "space-1",
    dispatchId: "dispatch-1",
    targetProfileId: "agent-1",
    openMeldServiceRuntimeId: {
      source: "runtime_registry_authority" as const,
      value: "runtime-1",
    },
    bindingId: "binding-1",
    agentControllerRef: "builtin:codex",
  },
});

const createExecutionTokenEcho = () => ({
  executionToken:
    "rcet_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  runId: "run-1",
  runtimeCoordinatorExecutionId: "rce-space-1-dispatch-1-agent-1",
  tokenFingerprint: "etfp_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
});

const readOutboxFile = (ledgerPaths: LedgerPaths) => {
  return JSON.parse(
    readFileSync(join(ledgerPaths.rootDirPath, "dispatch-result-outbox.json"), {
      encoding: "utf8",
    })
  ) as {
    records: Array<{
      attemptCount: number;
      attemptId: string;
      blockedReasonCode: string | null;
      dispatchId: string;
      lastFailureReason: string | null;
      nextAttemptAtMs: number;
      taskResult: {
        payload: {
          output?: string;
          promptTrace?: unknown;
          bootstrapTemplateFacts?: unknown;
        };
      };
    }>;
  };
};

const enqueueSuccessResult = (input: {
  currentSocketRef: CurrentDaemonSocketRef;
  ledgerPaths: LedgerPaths;
  output?: string;
  waitForSettlement?: boolean;
}) => {
  return enqueueDispatchResultOutboxRecord({
    attemptId: "attempt-1",
    connectionGeneration: 1,
    currentSocketRef: input.currentSocketRef,
    daemonSessionId: "session-1",
    dispatchId: "dispatch-1",
    executionIdentityEcho: createResultIdentityEcho(),
    executionTokenEcho: createExecutionTokenEcho(),
    ledgerPaths: input.ledgerPaths,
    leaseEpoch: 2,
    payload: {
      agentId: "agent-1",
      attemptId: "attempt-1",
      bootstrapTemplateFacts: {
        contentFingerprint: "template-fingerprint",
        templateVersion: "test-template",
      },
      deduped: false,
      output: input.output ?? "reply",
      promptTrace: {
        fingerprint: "prompt-fingerprint",
        length: 100,
        preview: "do not persist",
      },
      sourceEventId: "signal-1",
      status: "success",
      taskId: "task-1",
    },
    presenter: createPresenter(),
    taskId: "task-1",
    waitForSettlement: input.waitForSettlement,
  });
};

describe("local service dispatch result outbox", () => {
  it("keeps a result when sending fails after the durable write", () => {
    const ledgerPaths = createLedgerPaths();
    const send = vi.fn(() => {
      throw new Error("socket closed");
    });

    enqueueSuccessResult({
      currentSocketRef: {
        connectionGeneration: 2,
        socket: { send } as never,
      },
      ledgerPaths,
    });

    expect(send).toHaveBeenCalledTimes(1);
    const outbox = readOutboxFile(ledgerPaths);
    expect(outbox.records).toHaveLength(1);
    expect(outbox.records[0]).toMatchObject({
      attemptCount: 1,
      attemptId: "attempt-1",
      dispatchId: "dispatch-1",
      lastFailureReason: "socket closed",
    });
    expect(outbox.records[0]?.taskResult.payload.promptTrace).toBeUndefined();
    expect(
      outbox.records[0]?.taskResult.payload.bootstrapTemplateFacts
    ).toBeUndefined();
  });

  it("keeps a disconnected result and flushes it after reconnect", async () => {
    await withTempHome(async () => {
      const ledgerPaths = createLedgerPaths();
      const currentSocketRef: CurrentDaemonSocketRef = {
        connectionGeneration: null,
        socket: null,
      };

      enqueueSuccessResult({ currentSocketRef, ledgerPaths });
      expect(readOutboxFile(ledgerPaths).records).toHaveLength(1);

      const sentFrames: string[] = [];
      currentSocketRef.connectionGeneration = 3;
      currentSocketRef.socket = {
        send: (frame: string) => sentFrames.push(frame),
      } as never;
      flushDispatchResultOutbox({
        currentSocketRef,
        ledgerPaths,
        presenter: createPresenter(),
      });

      expect(sentFrames).toHaveLength(1);
      const frame = JSON.parse(sentFrames[0] ?? "{}") as {
        code?: string;
        payload?: {
          connectionGeneration?: number;
          executionTokenEcho?: { executionToken?: string };
        };
      };
      expect(frame.code).toBe("daemon.dispatch.result");
      expect(frame.payload?.connectionGeneration).toBe(3);
      expect(frame.payload?.executionTokenEcho?.executionToken).toBe(
        "rcet_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      );
      const sentEvents = readRecentDaemonDispatchJournalEvents({
        dispatchId: "dispatch-1",
      });
      expect(sentEvents).toEqual([
        expect.objectContaining({
          attemptId: "attempt-1",
          connectionGeneration: 3,
          dispatchId: "dispatch-1",
          metadata: expect.objectContaining({
            delivery: "outbox_flush",
            outboxAttemptCount: 1,
          }),
          taskId: "task-1",
          type: "dispatch.result.sent",
        }),
      ]);
      const serializedEvents = JSON.stringify(sentEvents);
      expect(serializedEvents).not.toContain("reply");
      expect(serializedEvents).not.toContain("rcet_v1_");
      expect(readOutboxFile(ledgerPaths).records).toHaveLength(1);

      acknowledgeDispatchResultOutboxRecord({
        attemptId: "attempt-1",
        dispatchId: "dispatch-1",
        ledgerPaths,
        ok: true,
        presenter: createPresenter(),
      });
      expect(readOutboxFile(ledgerPaths).records).toHaveLength(0);
      await Promise.resolve();
    });
  });

  it("keeps controlled shutdown waiting until the accepted result is durably acknowledged", async () => {
    const ledgerPaths = createLedgerPaths();
    enqueueSuccessResult({
      currentSocketRef: {
        connectionGeneration: 1,
        socket: { send: vi.fn() } as never,
      },
      ledgerPaths,
    });

    let acknowledged = false;
    const acknowledgement = waitForDispatchResultOutboxAcknowledgement({
      ledgerPaths,
      recordKeys: ["dispatch-1::attempt-1"],
    });
    const observedAcknowledgement = acknowledgement.then((result) => {
      acknowledged = true;
      return result;
    });
    await Promise.resolve();
    expect(acknowledged).toBe(false);

    acknowledgeDispatchResultOutboxRecord({
      attemptId: "attempt-1",
      dispatchId: "dispatch-1",
      ledgerPaths,
      ok: true,
      presenter: createPresenter(),
    });

    await expect(observedAcknowledgement).resolves.toBe("acknowledged");
    expect(acknowledged).toBe(true);
  });

  it("returns review_required and removes the stale proposal from the outbox", async () => {
    const ledgerPaths = createLedgerPaths();
    enqueueSuccessResult({
      currentSocketRef: {
        connectionGeneration: 1,
        socket: { send: vi.fn() } as never,
      },
      ledgerPaths,
    });

    const settlement = waitForDispatchResultOutboxSettlement({
      attemptId: "attempt-1",
      dispatchId: "dispatch-1",
      ledgerPaths,
    });
    acknowledgeDispatchResultOutboxRecord({
      attemptId: "attempt-1",
      dispatchId: "dispatch-1",
      ledgerPaths,
      ok: false,
      presenter: createPresenter(),
      reasonCode: "space.agent_reply.context_changed",
      status: "review_required",
    });

    await expect(settlement).resolves.toEqual({
      reasonCode: "space.agent_reply.context_changed",
      status: "review_required",
    });
    expect(readOutboxFile(ledgerPaths).records).toHaveLength(0);
  });

  it("registers settlement before sending so an immediate review response is not lost", async () => {
    const ledgerPaths = createLedgerPaths();
    const settlement = enqueueSuccessResult({
      currentSocketRef: {
        connectionGeneration: 1,
        socket: {
          send: vi.fn(() => {
            acknowledgeDispatchResultOutboxRecord({
              attemptId: "attempt-1",
              dispatchId: "dispatch-1",
              ledgerPaths,
              ok: false,
              presenter: createPresenter(),
              reasonCode: "space.agent_reply.context_changed",
              status: "review_required",
            });
          }),
        } as never,
      },
      ledgerPaths,
      waitForSettlement: true,
    });

    await expect(settlement).resolves.toEqual({
      reasonCode: "space.agent_reply.context_changed",
      status: "review_required",
    });
  });

  it("releases controlled shutdown when its cloud connection closes before acknowledgement", async () => {
    const ledgerPaths = createLedgerPaths();
    enqueueSuccessResult({
      currentSocketRef: {
        connectionGeneration: 1,
        socket: { send: vi.fn() } as never,
      },
      ledgerPaths,
    });
    const abortController = new AbortController();
    let released = false;
    const acknowledgement = waitForDispatchResultOutboxAcknowledgement({
      abortSignal: abortController.signal,
      ledgerPaths,
      recordKeys: ["dispatch-1::attempt-1"],
    });
    const observedAcknowledgement = acknowledgement.then((result) => {
      released = true;
      return result;
    });

    abortController.abort();
    await expect(observedAcknowledgement).resolves.toBe("aborted");

    expect(released).toBe(true);
    expect(readOutboxFile(ledgerPaths).records).toHaveLength(1);
  });

  it("restores an unacked result after local service restart and flushes it", () => {
    const ledgerPaths = createLedgerPaths();
    enqueueSuccessResult({
      currentSocketRef: { connectionGeneration: null, socket: null },
      ledgerPaths,
      output: "reply after restart",
    });

    const sentFrames: string[] = [];
    const restartedSocketRef: CurrentDaemonSocketRef = {
      connectionGeneration: 4,
      socket: {
        send: (frame: string) => sentFrames.push(frame),
      } as never,
    };
    flushDispatchResultOutbox({
      currentSocketRef: restartedSocketRef,
      ledgerPaths,
      presenter: createPresenter(),
    });

    expect(sentFrames).toHaveLength(1);
    expect(sentFrames[0]).toContain("reply after restart");
  });

  it("does not retry a sent result before the ack grace window expires", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-05-13T00:00:00.000Z"));
      const ledgerPaths = createLedgerPaths();
      const sentFrames: string[] = [];
      const currentSocketRef: CurrentDaemonSocketRef = {
        connectionGeneration: 5,
        socket: {
          send: (frame: string) => sentFrames.push(frame),
        } as never,
      };

      enqueueSuccessResult({ currentSocketRef, ledgerPaths });
      expect(sentFrames).toHaveLength(1);

      vi.setSystemTime(new Date("2026-05-13T00:00:05.000Z"));
      flushDispatchResultOutbox({
        currentSocketRef,
        ledgerPaths,
        presenter: createPresenter(),
      });
      expect(sentFrames).toHaveLength(1);

      vi.setSystemTime(new Date("2026-05-13T00:00:15.000Z"));
      flushDispatchResultOutbox({
        currentSocketRef,
        ledgerPaths,
        presenter: createPresenter(),
      });
      expect(sentFrames).toHaveLength(2);
      expect(readOutboxFile(ledgerPaths).records[0]).toMatchObject({
        attemptCount: 2,
        lastFailureReason: null,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps retryable ack failures flushable instead of permanently blocking the result", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-05-13T00:00:00.000Z"));
      const ledgerPaths = createLedgerPaths();
      const sentFrames: string[] = [];
      const currentSocketRef: CurrentDaemonSocketRef = {
        connectionGeneration: 5,
        socket: {
          send: (frame: string) => sentFrames.push(frame),
        } as never,
      };

      enqueueSuccessResult({ currentSocketRef, ledgerPaths });
      expect(sentFrames).toHaveLength(1);

      acknowledgeDispatchResultOutboxRecord({
        attemptId: "attempt-1",
        dispatchId: "dispatch-1",
        ledgerPaths,
        ok: false,
        presenter: createPresenter(),
        reasonCode: "daemon.result.inbox_unavailable",
        status: "retry_later",
      });

      let outbox = readOutboxFile(ledgerPaths);
      expect(outbox.records).toHaveLength(1);
      expect(outbox.records[0]).toMatchObject({
        blockedReasonCode: null,
        lastFailureReason: "daemon.result.inbox_unavailable",
      });

      vi.setSystemTime(new Date("2026-05-13T00:00:05.000Z"));
      flushDispatchResultOutbox({
        currentSocketRef,
        ledgerPaths,
        presenter: createPresenter(),
      });
      expect(sentFrames).toHaveLength(1);

      vi.setSystemTime(new Date("2026-05-13T00:00:15.000Z"));
      flushDispatchResultOutbox({
        currentSocketRef,
        ledgerPaths,
        presenter: createPresenter(),
      });
      expect(sentFrames).toHaveLength(2);
      outbox = readOutboxFile(ledgerPaths);
      expect(outbox.records[0]).toMatchObject({
        attemptCount: 2,
        blockedReasonCode: null,
        lastFailureReason: null,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
