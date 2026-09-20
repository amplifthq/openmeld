import { runtimeTransportDispatchLifecycleRequestSchema } from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import type { CurrentDaemonSocketRef } from "../src/local-service/core/types";
import { createExecutionAdmissionConfirmation } from "../src/local-service/execution-host/execution-admission";

describe("Coordinator-confirmed provider admission", () => {
  it("does not treat a delayed positive response as fresh permission", async () => {
    let clock = 0;
    const time = vi.spyOn(performance, "now").mockImplementation(() => clock);
    try {
      const frames: string[] = [];
      const admission = createExecutionAdmissionConfirmation({
        connectionGeneration: 1,
        socket: {
          send: (frame) => {
            frames.push(frame);
          },
        },
      });
      const provider = vi.fn();
      const work = admission
        .confirm({
          dispatchId: "dispatch",
          attemptId: "attempt",
          daemonSessionId: "session",
          leaseEpoch: 1,
          payload: { runtimeCoordinatorExecutionId: "execution-test" },
        })
        .then(provider);
      const first = JSON.parse(String(frames.at(-1))).payload;
      clock = 2000;
      const reply = {
        acknowledgementId: first.acknowledgementId,
        dispatchId: "dispatch",
        attemptId: "attempt",
        connectionGeneration: 1,
        accepted: true,
        reasonCode: null,
        validForMs: 1000,
      };
      admission.receive(reply);
      await Promise.resolve();
      expect(provider).not.toHaveBeenCalled();
      admission.resend();
      admission.receive(reply);
      await Promise.resolve();
      expect(provider).not.toHaveBeenCalled();
      const fresh = JSON.parse(String(frames.at(-1))).payload;
      admission.receive({
        ...reply,
        acknowledgementId: fresh.acknowledgementId,
      });
      await work;
      expect(provider).toHaveBeenCalledTimes(1);
    } finally {
      time.mockRestore();
    }
  });
  it("never starts a provider after terminal refusal, and ignores a retired connection's acknowledgement", async () => {
    const frames: string[] = [];
    const socketRef: CurrentDaemonSocketRef = {
      connectionGeneration: 1,
      socket: {
        send: (frame) => {
          frames.push(frame);
        },
      },
    };
    const admission = createExecutionAdmissionConfirmation(socketRef);
    const provider = vi.fn();
    const request = {
      dispatchId: "dispatch",
      attemptId: "attempt",
      daemonSessionId: "session",
      leaseEpoch: 1,
      payload: { runtimeCoordinatorExecutionId: "execution-test" },
    };
    const work = admission.confirm(request).then(provider);
    const refused = expect(work).rejects.toMatchObject({
      code: "execution_token_terminal_late",
    });
    const sent = runtimeTransportDispatchLifecycleRequestSchema.parse(
      JSON.parse(String(frames[0])).payload
    );
    await Promise.resolve();
    expect(provider).not.toHaveBeenCalled();
    admission.receive({
      acknowledgementId: sent.acknowledgementId,
      dispatchId: "dispatch",
      attemptId: "attempt",
      connectionGeneration: 1,
      accepted: false,
      validForMs: 0,
      reasonCode: "execution_token_terminal_late",
    });
    await refused;
    expect(provider).not.toHaveBeenCalled();

    const fresh = admission
      .confirm({ ...request, dispatchId: "new-dispatch" })
      .then(provider);
    const next = runtimeTransportDispatchLifecycleRequestSchema.parse(
      JSON.parse(String(frames.at(-1))).payload
    );
    socketRef.connectionGeneration = 2;
    admission.resend();
    const reply = {
      acknowledgementId: next.acknowledgementId,
      dispatchId: "new-dispatch",
      attemptId: "attempt",
      connectionGeneration: 1,
      accepted: true,
      validForMs: 10_000,
      reasonCode: null,
    };
    admission.receive(reply);
    await Promise.resolve();
    expect(provider).not.toHaveBeenCalled();
    const resent = runtimeTransportDispatchLifecycleRequestSchema.parse(
      JSON.parse(String(frames.at(-1))).payload
    );
    admission.receive({
      ...reply,
      acknowledgementId: resent.acknowledgementId,
      connectionGeneration: 2,
      validForMs: 0,
    });
    await Promise.resolve();
    expect(provider).not.toHaveBeenCalled();
    admission.resend();
    const confirmed = runtimeTransportDispatchLifecycleRequestSchema.parse(
      JSON.parse(String(frames.at(-1))).payload
    );
    admission.receive({
      ...reply,
      acknowledgementId: confirmed.acknowledgementId,
      connectionGeneration: 2,
    });
    await fresh;
    admission.receive({ ...reply, connectionGeneration: 2 });
    expect(provider).toHaveBeenCalledTimes(1);
  });
});

import { performance } from "node:perf_hooks";
