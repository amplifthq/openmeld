import { buildRuntimeWorkspaceFingerprint } from "@openmeld/local-execution";
import { describe, expect, it } from "vitest";
import { resolveDispatchResultPayload } from "../src/local-service/dispatch/send-dispatch-result";

describe("resolveDispatchResultPayload", () => {
  it("preserves direct space action provenance on success payloads", () => {
    const payload = resolveDispatchResultPayload({
      attemptId: "attempt-1",
      basePayload: {
        status: "success",
        attemptId: "attempt-1",
        taskId: "task-1",
        sourceEventId: "signal-1",
        agentId: "agt_test",
        deduped: false,
        output: "hello",
      },
      contextDelta: null,
      contextResolution: null,
      agentControllerRef: "builtin:codex",
      existingContextId: "ctx-1",
      sourceEventId: "signal-1",
      spaceAction: {
        type: "post_message",
        messageEnvelope: {
          activationTargets: [],
          referenceTargets: [],
          text: "hello",
        },
      },
      spaceActionProvenance: "direct",
      targetProfileId: "agt_test",
      taskId: "task-1",
    });

    expect(payload.status).toBe("success");
    if (payload.status !== "success") {
      throw new Error("expected success payload");
    }
    expect(payload.spaceActionProvenance).toBe("direct");
  });

  it("preserves repair-origin provenance on success payloads", () => {
    const payload = resolveDispatchResultPayload({
      attemptId: "attempt-2",
      basePayload: {
        status: "success",
        attemptId: "attempt-2",
        taskId: "task-2",
        sourceEventId: "signal-2",
        agentId: "agt_test",
        deduped: false,
        output: "private",
      },
      contextDelta: null,
      contextResolution: null,
      agentControllerRef: "builtin:claude-code",
      existingContextId: "ctx-2",
      sourceEventId: "signal-2",
      spaceAction: {
        type: "stay_silent",
        reason: "Keeping this private.",
      },
      spaceActionProvenance: "controller_repair",
      targetProfileId: "agt_test",
      taskId: "task-2",
    });

    expect(payload.status).toBe("success");
    if (payload.status !== "success") {
      throw new Error("expected success payload");
    }
    expect(payload.spaceActionProvenance).toBe("controller_repair");
  });

  it("preserves local repair provenance on success payloads", () => {
    const payload = resolveDispatchResultPayload({
      attemptId: "attempt-3",
      basePayload: {
        status: "success",
        attemptId: "attempt-3",
        taskId: "task-3",
        sourceEventId: "signal-3",
        agentId: "agt_test",
        deduped: false,
        output: "private",
      },
      contextDelta: null,
      contextResolution: null,
      agentControllerRef: "builtin:claude-code",
      existingContextId: "ctx-3",
      sourceEventId: "signal-3",
      spaceAction: {
        type: "stay_silent",
        reason: "Keeping this private.",
      },
      spaceActionProvenance: "local_repair",
      targetProfileId: "agt_test",
      taskId: "task-3",
    });

    expect(payload.status).toBe("success");
    if (payload.status !== "success") {
      throw new Error("expected success payload");
    }
    expect(payload.spaceActionProvenance).toBe("local_repair");
  });

  it("preserves CLI action provenance on normalized payloads", () => {
    const payload = resolveDispatchResultPayload({
      attemptId: "attempt-cli",
      basePayload: {
        status: "success",
        attemptId: "attempt-cli",
        taskId: "task-cli",
        sourceEventId: "signal-cli",
        agentId: "agt_test",
        deduped: false,
        output: "plain final output",
      },
      contextDelta: null,
      contextResolution: null,
      agentControllerRef: "builtin:codex",
      existingContextId: "ctx-cli",
      sourceEventId: "signal-cli",
      spaceAction: {
        type: "post_message",
        messageEnvelope: {
          activationTargets: [],
          referenceTargets: [],
          text: "reply from CLI action",
        },
      },
      spaceActionProvenance: "cli_action",
      targetProfileId: "agt_test",
      taskId: "task-cli",
    });

    expect(payload.status).toBe("success");
    if (payload.status !== "success") {
      throw new Error("expected success payload");
    }
    expect(payload.spaceActionProvenance).toBe("cli_action");
  });

  it("preserves effectiveRuntimeWorkingDirectory verbatim in normalized success payloads", () => {
    const payload = resolveDispatchResultPayload({
      attemptId: "attempt-4",
      basePayload: {
        status: "success",
        attemptId: "attempt-4",
        taskId: "task-4",
        sourceEventId: "signal-4",
        agentId: "agt_test",
        deduped: false,
        output: "hello",
      },
      contextDelta: null,
      contextResolution: null,
      agentControllerRef: "builtin:claude-code",
      existingContextId: "ctx-4",
      sourceEventId: "signal-4",
      targetProfileId: "agt_test",
      taskId: "task-4",
      workingDirectory: " /tmp/My Project ",
    });

    expect(payload.status).toBe("success");
    if (payload.status !== "success") {
      throw new Error("expected success payload");
    }
    expect(payload.effectiveRuntimeWorkingDirectory).toBe(" /tmp/My Project ");
    expect(payload.runtimeWorkspaceFingerprint).toBe(
      buildRuntimeWorkspaceFingerprint(" /tmp/My Project ")
    );
  });

  it("drops invalid effectiveRuntimeWorkingDirectory values instead of rewriting them", () => {
    const payload = resolveDispatchResultPayload({
      attemptId: "attempt-5",
      basePayload: {
        status: "success",
        attemptId: "attempt-5",
        taskId: "task-5",
        sourceEventId: "signal-5",
        agentId: "agt_test",
        deduped: false,
        output: "hello",
      },
      contextDelta: null,
      contextResolution: null,
      agentControllerRef: "builtin:claude-code",
      existingContextId: "ctx-5",
      sourceEventId: "signal-5",
      targetProfileId: "agt_test",
      taskId: "task-5",
      workingDirectory: `/tmp/${"x".repeat(4097)}`,
    });

    expect(payload.status).toBe("success");
    if (payload.status !== "success") {
      throw new Error("expected success payload");
    }
    expect(payload.effectiveRuntimeWorkingDirectory).toBeUndefined();
  });

  it("preserves the compact dispatch-brief preview in normalized success payloads", () => {
    const payload = resolveDispatchResultPayload({
      attemptId: "attempt-6",
      basePayload: {
        status: "success",
        attemptId: "attempt-6",
        taskId: "task-6",
        sourceEventId: "signal-6",
        agentId: "agt_test",
        deduped: false,
        output: "hello",
      },
      contextDelta: null,
      contextResolution: null,
      agentControllerRef: "builtin:openclaw",
      existingContextId: "ctx-6",
      promptTrace: {
        fingerprint: "sha256:prompt-6",
        length: 321,
        preview:
          "Space Dispatch Brief:\n- Actions: Complete this Wake with exactly one final outcome",
      },
      sourceEventId: "signal-6",
      targetProfileId: "agt_test",
      taskId: "task-6",
    });

    expect(payload.status).toBe("success");
    if (payload.status !== "success") {
      throw new Error("expected success payload");
    }
    expect(payload.promptTrace).toEqual({
      fingerprint: "sha256:prompt-6",
      length: 321,
      preview:
        "Space Dispatch Brief:\n- Actions: Complete this Wake with exactly one final outcome",
    });
  });

  it("includes agentControllerConversationId and agentControllerConversation in normalized success payloads", () => {
    const payload = resolveDispatchResultPayload({
      attemptId: "attempt-7",
      basePayload: {
        status: "success",
        attemptId: "attempt-7",
        taskId: "task-7",
        sourceEventId: "signal-7",
        agentId: "agt_test",
        deduped: false,
        output: "continued reply",
      },
      contextDelta: {
        agentControllerConversationId: "thread-imported-7",
        agentControllerConversation: {
          agentControllerRef: "builtin:codex",
          agentControllerConversationKind: "thread",
          agentControllerConversationId: "thread-imported-7",
        },
      },
      contextResolution: null,
      agentControllerRef: "builtin:codex",
      existingContextId: null,
      sourceEventId: "signal-7",
      targetProfileId: "agt_test",
      taskId: "task-7",
    });

    expect(payload.status).toBe("success");
    if (payload.status !== "success") {
      throw new Error("expected success payload");
    }
    expect(payload.agentControllerConversationId).toBe("thread-imported-7");
    expect(payload.agentControllerConversation).toEqual({
      agentControllerRef: "builtin:codex",
      agentControllerConversationKind: "thread",
      agentControllerConversationId: "thread-imported-7",
    });
  });

  it("keeps a successful visible reply when no agent controller conversation id is available", () => {
    const payload = resolveDispatchResultPayload({
      attemptId: "attempt-unbound",
      basePayload: {
        status: "success",
        attemptId: "attempt-unbound",
        taskId: "task-unbound",
        sourceEventId: "signal-unbound",
        agentId: "agt_test",
        deduped: false,
        output: "reply from an unbound profile",
      },
      contextDelta: null,
      contextResolution: null,
      agentControllerRef: "builtin:codex",
      existingContextId: null,
      sourceEventId: "signal-unbound",
      spaceAction: {
        type: "post_message",
        messageEnvelope: {
          activationTargets: [],
          referenceTargets: [],
          text: "reply from an unbound profile",
        },
      },
      spaceActionProvenance: "cli_action",
      targetProfileId: "agt_test",
      taskId: "task-unbound",
    });

    expect(payload.status).toBe("success");
    if (payload.status !== "success") {
      throw new Error("expected success payload");
    }
    expect(payload.agentControllerConversationId).toBeUndefined();
    expect(payload.spaceAction?.type).toBe("post_message");
    expect(payload.suppressPublicOutcome).toBeUndefined();
  });
});
