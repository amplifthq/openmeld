import type { SignalEnvelope } from "@openmeld/protocol";
import { describe, expect, it } from "vitest";
import {
  type DispatchExecutionContext,
  DispatchExecutionValidationError,
  normalizePostPublicationDispatchError,
} from "../dispatch/application/dispatch-execution-service";

const EXECUTION_CONTEXT: DispatchExecutionContext = {
  attemptId: "attempt-1",
  daemonSessionId: "daemon-session-1",
  leaseEpoch: 1,
  connectionGeneration: 1,
  replyingHintActive: false,
};

const EMITTED_SIGNAL = {
  id: "sig-1",
} as SignalEnvelope;

describe("dispatch execution service post-publication errors", () => {
  it("marks plain post-publication errors as terminalReplySettled when a signal already exists", () => {
    const error = normalizePostPublicationDispatchError({
      emittedSignal: EMITTED_SIGNAL,
      error: new Error("archive write failed"),
      executionContext: EXECUTION_CONTEXT,
    });

    expect(error).toBeInstanceOf(DispatchExecutionValidationError);
    expect(error.terminalReplySettled).toBe(true);
    expect(error.message).toBe("archive write failed");
  });

  it("preserves unsettled state when no terminal signal was published", () => {
    const error = normalizePostPublicationDispatchError({
      emittedSignal: null,
      error: new Error("archive write failed"),
      executionContext: EXECUTION_CONTEXT,
    });

    expect(error.terminalReplySettled).toBe(false);
  });
});
