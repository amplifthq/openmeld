import { createCodexAdapter } from "@openmeld/adapter-codex";
import {
  type AdapterInterruptSignal,
  DEFAULT_GRACEFUL_INTERRUPT_TIMEOUT_MS,
} from "@openmeld/adapter-core";
import { describe, expect, it, vi } from "vitest";
import { dispatchMentionOnlyTask } from "../src/mention-dispatch-integration";

const INTERRUPT_ESCALATION_JITTER_MS = 5;

const baseDispatchRequest = {
  agentId: "agent-codex",
  prompt: "hello from mention-dispatch",
  sourceEventId: "evt-1",
  spaceId: "space-1",
  taskId: "task-1",
} as const;

describe("mention-dispatch mention-only trigger contract", () => {
  it("does not dispatch when mention_only is not mentioned", async () => {
    const invoke = vi.fn().mockResolvedValue({
      output: "should-not-run",
    });
    const adapter = createCodexAdapter({
      invoke,
    });

    const result = await dispatchMentionOnlyTask({
      adapter,
      mentioned: false,
      request: baseDispatchRequest,
    });

    expect(result).toEqual({
      dispatched: false,
      reason: "not_mentioned",
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("dispatches through codex adapter when mentioned", async () => {
    const adapter = createCodexAdapter({
      invoke: vi.fn().mockResolvedValue({
        output: "codex-output",
      }),
    });

    const result = await dispatchMentionOnlyTask({
      adapter,
      mentioned: true,
      request: baseDispatchRequest,
    });

    expect(result).toEqual({
      adapterResult: {
        output: "codex-output",
        status: "success",
      },
      dispatched: true,
      reason: "dispatched",
    });
  });

  it("uses graceful then force interrupt escalation with 10s timeout", async () => {
    const signals: AdapterInterruptSignal[] = [];
    const waitForMs = vi.fn().mockResolvedValue(undefined);
    const adapter = createCodexAdapter({
      invoke: vi.fn().mockResolvedValue({
        output: "ok",
      }),
      sendInterrupt: (signal) => {
        signals.push(signal);
      },
      waitForMs,
    });

    const interruptResult = await adapter.interrupt({
      taskId: "task-1",
    });

    expect(interruptResult.accepted).toBe(true);
    expect(interruptResult.signalDelivery).toBe("sent");
    expect(interruptResult.plan.initial.mode).toBe("graceful");
    expect(interruptResult.plan.escalation).toMatchObject({
      delayMs: DEFAULT_GRACEFUL_INTERRUPT_TIMEOUT_MS,
      mode: "force",
      taskId: "task-1",
    });
    expect(waitForMs).toHaveBeenCalledWith(
      DEFAULT_GRACEFUL_INTERRUPT_TIMEOUT_MS
    );
    expect(signals).toEqual([
      {
        mode: "graceful",
        reason: "service.interrupt",
        taskId: "task-1",
      },
      {
        mode: "force",
        reason: "service.interrupt",
        taskId: "task-1",
      },
    ]);
  });

  it("allows explicit force interrupt without graceful pre-step", async () => {
    const signals: AdapterInterruptSignal[] = [];
    const waitForMs = vi.fn().mockResolvedValue(undefined);
    const adapter = createCodexAdapter({
      invoke: vi.fn().mockResolvedValue({
        output: "ok",
      }),
      sendInterrupt: (signal) => {
        signals.push(signal);
      },
      waitForMs,
    });

    const interruptResult = await adapter.interrupt({
      mode: "force",
      taskId: "task-1",
    });

    expect(interruptResult.plan.initial.mode).toBe("force");
    expect(interruptResult.plan.escalation).toBeUndefined();
    expect(interruptResult.signalDelivery).toBe("sent");
    expect(waitForMs).not.toHaveBeenCalled();
    expect(signals).toEqual([
      {
        mode: "force",
        reason: "service.interrupt",
        taskId: "task-1",
      },
    ]);
  });

  it("keeps a real delay before force escalation on default wait path", async () => {
    const gracefulTimeoutMs = 20;
    const minimumEscalationDelayMs =
      gracefulTimeoutMs - INTERRUPT_ESCALATION_JITTER_MS;
    const signalRecords: Array<{
      atMs: number;
      signal: AdapterInterruptSignal;
    }> = [];
    const adapter = createCodexAdapter({
      gracefulTimeoutMs,
      invoke: vi.fn().mockResolvedValue({
        output: "ok",
      }),
      sendInterrupt: (signal) => {
        signalRecords.push({
          atMs: performance.now(),
          signal,
        });
      },
    });

    await adapter.interrupt({
      taskId: "task-2",
    });

    expect(signalRecords).toHaveLength(2);
    expect(signalRecords[0]?.signal.mode).toBe("graceful");
    expect(signalRecords[1]?.signal.mode).toBe("force");
    expect(
      signalRecords[1].atMs - signalRecords[0].atMs
    ).toBeGreaterThanOrEqual(minimumEscalationDelayMs);
  });

  it("reports planned-only interrupt when signal sender is unavailable", async () => {
    const adapter = createCodexAdapter({
      invoke: vi.fn().mockResolvedValue({
        output: "ok",
      }),
    });

    const interruptResult = await adapter.interrupt({
      taskId: "task-3",
    });

    expect(interruptResult).toMatchObject({
      accepted: false,
      signalDelivery: "not_sent",
      taskId: "task-3",
    });
    expect(interruptResult.plan.initial.mode).toBe("graceful");
  });
});
