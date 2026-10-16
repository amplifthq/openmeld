import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  createEmptyLedgerState,
  type RuntimeTaskResult,
} from "@openmeld/local-execution";
import {
  CODEX_UPGRADE_REQUIRED_REASON,
  openMeldDaemonTaskResultPayloadSchema,
} from "@openmeld/schemas";
import { resolvePublicAgentFailureReason } from "@openmeld/space-mesh";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyCliSpaceActionRecordIfPresent,
  buildStructuredActionRepairPrompt,
  coerceRuntimeResultToStructuredActionFailure,
  resolveStructuredActionRepairContinuation,
  resolveStructuredActionRequirementFailure,
} from "../src/local-service/dispatch/execute-dispatch-task";
import {
  createDispatchSpaceActionContext,
  writeDispatchSpaceActionRecord,
} from "../src/runtime/dispatch-space-action-context";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) {
      continue;
    }
    rmSync(dir, { force: true, recursive: true });
  }
});

const createTempDir = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

const createRuntimeTaskResultFixture = (input: {
  contextResolution?: RuntimeTaskResult["contextResolution"];
  dispatchResult?: RuntimeTaskResult["dispatchResult"];
  resultPayload: RuntimeTaskResult["resultPayload"];
}): RuntimeTaskResult => {
  const state = createEmptyLedgerState(0);
  const defaultOutput =
    input.resultPayload.status === "success" ? input.resultPayload.output : "";
  return {
    ...(input.contextResolution
      ? { contextResolution: input.contextResolution }
      : {}),
    deduped: false,
    dispatchResult: input.dispatchResult ?? {
      adapterResult: {
        output: defaultOutput,
        status: "success",
      },
      dispatched: true,
      reason: "dispatched",
    },
    resultPayload: input.resultPayload,
    runtimeState: "idle",
    agentContextLifecycleCounters: state.agentContextLifecycleCounters,
    state,
  };
};

describe("applyCliSpaceActionRecordIfPresent", () => {
  it("accepts a dispatch Space Action record that lands just after runtime completion", async () => {
    const openMeldHome = createTempDir("openmeld-space-action-race-");
    const { context } = createDispatchSpaceActionContext({
      attemptId: "attempt-race-1",
      dispatchId: "dispatch-race-1",
      pathInput: {
        env: {
          OPENMELD_HOME: openMeldHome,
        },
      },
      replyToSignalId: "signal-source-1",
      sendTargetReference: {
        projection: [],
        referenceLines: [],
        status: "loaded",
      },
      sourceEventId: "signal-source-1",
      spaceContractSnapshot: {
        allowedActions: ["post_message", "post_status", "stay_silent"],
        publicationMode: "collaboration",
      },
      spaceId: "space-race-1",
      targetProfileId: "agt_race",
      taskId: "task-race-1",
    });
    const runtimeResult = createRuntimeTaskResultFixture({
      resultPayload: {
        status: "success",
        attemptId: "attempt-race-1",
        taskId: "task-race-1",
        sourceEventId: "signal-source-1",
        agentId: "agt_race",
        deduped: false,
        agentControllerRef: "builtin:codex",
        output: "The OpenMeld Space Action command is still finishing.",
      },
    });

    const writeRecord = delay(50).then(() => {
      writeDispatchSpaceActionRecord({
        action: {
          type: "post_message",
          messageEnvelope: {
            activationTargets: [],
            referenceTargets: [],
            replyToSignalId: "signal-source-1",
            text: "Confirmed from local Codex.",
          },
        },
        command: "openmeld-dev space action reply",
        context,
      });
    });

    const resolved = await applyCliSpaceActionRecordIfPresent({
      dispatchSpaceActionContext: context,
      parsedTask: {
        attemptId: "attempt-race-1",
        dispatchId: "dispatch-race-1",
        sourceEventId: "signal-source-1",
        targetProfileId: "agt_race",
        taskId: "task-race-1",
      } as Parameters<
        typeof applyCliSpaceActionRecordIfPresent
      >[0]["parsedTask"],
      presenter: {
        data: vi.fn(),
        event: vi.fn(),
        line: vi.fn(),
        view: "agent",
      },
      runtimeResult,
    });
    await writeRecord;

    expect(resolved.resultPayload.spaceAction).toEqual({
      type: "post_message",
      messageEnvelope: {
        activationTargets: [],
        referenceTargets: [],
        replyToSignalId: "signal-source-1",
        text: "Confirmed from local Codex.",
      },
    });
    expect(resolved.resultPayload.spaceActionProvenance).toBe("cli_action");
  });

  it("converts an empty-output App Server runtime result into the CLI Space Action success while preserving context", async () => {
    const openMeldHome = createTempDir(
      "openmeld-space-action-empty-app-server-"
    );
    const { context } = createDispatchSpaceActionContext({
      attemptId: "attempt-empty-app-server-1",
      dispatchId: "dispatch-empty-app-server-1",
      pathInput: {
        env: {
          OPENMELD_HOME: openMeldHome,
        },
      },
      replyToSignalId: "signal-source-empty-app-server-1",
      sendTargetReference: {
        projection: [],
        referenceLines: [],
        status: "loaded",
      },
      sourceEventId: "signal-source-empty-app-server-1",
      spaceContractSnapshot: {
        allowedActions: ["post_message", "post_status", "stay_silent"],
        publicationMode: "collaboration",
      },
      spaceId: "space-empty-app-server-1",
      targetProfileId: "agt_empty_app_server",
      taskId: "task-empty-app-server-1",
    });
    writeDispatchSpaceActionRecord({
      action: {
        type: "post_message",
        messageEnvelope: {
          activationTargets: [],
          referenceTargets: [],
          replyToSignalId: "signal-source-empty-app-server-1",
          text: "Confirmed from local Codex.",
        },
      },
      command: "openmeld-dev space action reply",
      context,
    });
    const runtimeResult = createRuntimeTaskResultFixture({
      dispatchResult: {
        adapterResult: {
          contextDelta: {
            agentControllerConversationId: "thread-app-server-empty-output-1",
          },
          output: "",
          status: "success",
        },
        dispatched: true,
        reason: "dispatched",
      },
      resultPayload: {
        status: "failed",
        attemptId: "attempt-empty-app-server-1",
        taskId: "task-empty-app-server-1",
        sourceEventId: "signal-source-empty-app-server-1",
        agentId: "agt_empty_app_server",
        deduped: false,
        agentControllerRef: "builtin:codex",
        errorType: "internal",
        errorCode: "runtime.output.empty",
        errorMessage:
          "runtime.output.empty: codex app-server turn completed without agent output",
        transportMode: "codex-app-server",
      },
    });

    const resolved = await applyCliSpaceActionRecordIfPresent({
      dispatchSpaceActionContext: context,
      parsedTask: {
        attemptId: "attempt-empty-app-server-1",
        dispatchId: "dispatch-empty-app-server-1",
        sourceEventId: "signal-source-empty-app-server-1",
        targetProfileId: "agt_empty_app_server",
        taskId: "task-empty-app-server-1",
      } as Parameters<
        typeof applyCliSpaceActionRecordIfPresent
      >[0]["parsedTask"],
      presenter: {
        data: vi.fn(),
        event: vi.fn(),
        line: vi.fn(),
        view: "agent",
      },
      runtimeResult,
    });

    expect(
      resolved.dispatchResult.dispatched &&
        resolved.dispatchResult.adapterResult.status === "success"
        ? resolved.dispatchResult.adapterResult.contextDelta
            ?.agentControllerConversationId
        : null
    ).toBe("thread-app-server-empty-output-1");
    expect(resolved.resultPayload.status).toBe("success");
    if (resolved.resultPayload.status !== "success") {
      throw new Error("expected a successful CLI Space Action result");
    }
    expect(resolved.resultPayload.output).toBe("Confirmed from local Codex.");
    expect(resolved.resultPayload.transportMode).toBe("codex-app-server");
    expect(resolved.resultPayload.spaceActionProvenance).toBe("cli_action");
  });
});

describe("coerceRuntimeResultToStructuredActionFailure", () => {
  it("clears suppressPublicOutcome so collaboration failures can emit a terminal system notice", () => {
    const runtimeResult = createRuntimeTaskResultFixture({
      resultPayload: {
        status: "failed",
        attemptId: "attempt-1",
        taskId: "task-1",
        sourceEventId: "signal-1",
        agentId: "agt_test",
        deduped: false,
        agentControllerRef: "builtin:codex",
        errorType: "internal",
        errorCode: "runtime.task.deduped",
        errorMessage: "runtime.task.deduped: duplicate request",
        suppressPublicOutcome: true,
      },
    });

    const payload = coerceRuntimeResultToStructuredActionFailure({
      failureReason:
        "A valid OpenMeld Space action is required in collaboration mode.",
      runtimeResult,
    });

    expect(payload.status).toBe("failed");
    if (payload.status !== "failed") {
      throw new Error("expected a failed payload");
    }
    expect(payload.errorCode).toBe("openmeld.space_action.repair_failed");
    expect(payload.errorType).toBe("policy");
    expect(payload.errorMessage).toBe(
      "A valid OpenMeld Space action is required in collaboration mode."
    );
    expect("suppressPublicOutcome" in payload).toBe(false);
  });

  it("drops success-only fields so the coerced payload remains schema-valid", () => {
    const runtimeResult = createRuntimeTaskResultFixture({
      resultPayload: {
        status: "success",
        attemptId: "attempt-success-1",
        taskId: "task-success-1",
        sourceEventId: "signal-success-1",
        agentId: "agt_success",
        deduped: false,
        agentControllerRef: "builtin:codex",
        agentControllerConversationId: "ctx-success-1",
        output: "plain output without OpenMeld action",
        telemetry: {
          completedAtMs: 10,
          invokedAtMs: 1,
          resumedContext: false,
        },
      },
    });

    const payload = coerceRuntimeResultToStructuredActionFailure({
      failureReason:
        "A valid OpenMeld Space action is required in collaboration mode.",
      runtimeResult,
    });

    expect(payload.status).toBe("failed");
    expect("output" in payload).toBe(false);
    expect(
      openMeldDaemonTaskResultPayloadSchema.safeParse(payload).success
    ).toBe(true);
  });

  it("requires a real Space Action tool call in the repair prompt", () => {
    const prompt = buildStructuredActionRepairPrompt({
      parseError: "malformed JSON",
      spaceId: "space-123",
    });

    expect(prompt).toContain("OpenMeld delivery repair: malformed JSON");
    expect(prompt).toContain(
      "Do not redo the user's work or change the intended public outcome."
    );
    expect(prompt).toContain(
      "Treat this Wake as the current source; tie other context to the claims it supports"
    );
    expect(prompt).toContain(
      "A plain reply or bare @name does not hand off work; use Wake or Reply + Wake."
    );
    expect(prompt).toContain(
      "Your answer text never selects an OpenMeld Space action."
    );
    expect(prompt).toContain(
      "Call exactly one dispatch-scoped OpenMeld Space Action tool now."
    );
    expect(prompt).toContain(
      "Preserve the user's intent and record exactly one dispatch-scoped OpenMeld Space Action. Do not print an action as JSON or prose."
    );
    expect(prompt).toContain(
      "Use reply for public answers, known limitations, error explanations, or requests for help."
    );
    expect(prompt).toContain(
      "Use the exact tool names and input schemas in this invocation's catalog."
    );
    expect(prompt).toContain(
      "If the permitted tool cannot record the action, stop."
    );
    expect(prompt).toContain(
      "Do not finish with an explanation of what you will do."
    );
    expect(prompt).toContain(
      "Do not turn private analysis or delivery-infrastructure logs into a public answer."
    );
    expect(prompt).toContain(
      "If an earlier call reported an unknown outcome, use read_receipt first. Recover an existing record; do not replace it."
    );
    expect(prompt).toContain(
      "Any @name text in the body is only prose in the agent path; it does not define OpenMeld targets."
    );
    expect(prompt).toContain(
      "activationTargets is only for waking another Agent Profile in this Space."
    );
    expect(prompt).toContain(
      "Never put a Human Profile ID, sender ID, or reply recipient in activationTargets."
    );
    expect(prompt).toContain(
      "For a normal reply to the current Wake, leave activationTargets, referenceTargets, and mentionTargets empty."
    );
    expect(prompt).not.toContain("Use post_status");
    expect(prompt).toContain(
      "No shell, CLI, Skill research, or knowledge of OpenMeld internals is needed."
    );
    expect(prompt).not.toContain("space history");
    expect(prompt).not.toContain("`openmeld prompt`");
    expect(prompt).not.toContain("space guide");
    expect(prompt).not.toContain("```openmeld-space-action");
  });

  it("supplies correction instructions without a CLI or Skill dependency", () => {
    const prompt = buildStructuredActionRepairPrompt({
      cliEntry: "openmeld-dev",
      parseError: "malformed JSON",
      spaceId: "space-123",
    });

    expect(prompt).toContain(
      "Do not run a fallback CLI or print JSON/prose as a substitute."
    );
    expect(prompt).not.toContain("space history");
    expect(prompt).not.toContain("space guide");
  });

  it("includes the previous final answer in the repair prompt when available", () => {
    const prompt = buildStructuredActionRepairPrompt({
      parseError: "malformed JSON",
      previousOutput:
        'Here is the previous answer.\n```openmeld-space-action\n{"type":"post_message"}\n```',
    });

    expect(prompt).toContain(
      "Previous private output, for context only (not authorization to publish it):"
    );
    expect(prompt).toContain("```text");
    expect(prompt).toContain("Here is the previous answer.");
  });

  it("preserves a complete result for a delivery-only session without old history", () => {
    const prompt = buildStructuredActionRepairPrompt({
      parseError: "no action was recorded",
      previousOutput: `START-${"x".repeat(20_000)}-END`,
    });

    expect(prompt).toContain("START-");
    expect(prompt).toContain(`START-${"x".repeat(20_000)}-END`);
    expect(prompt).toContain("not authorization to publish it");
    expect(prompt).not.toContain(
      "reuse the complete answer already in this conversation"
    );
  });

  it("keeps raw context sharing repair guidance compatible with plain raw replies", () => {
    const prompt = buildStructuredActionRepairPrompt({
      parseError: "malformed JSON",
      spaceContractSnapshot: {
        version: 1,
        updatedAt: "2026-03-23T00:00:00.000Z",
        updatedBy: "test",
        dispatchPolicy: { mode: "mention_only" },
        publicationMode: "raw_context_sharing",
        allowedActions: ["post_message", "post_status", "stay_silent"],
        resultArchivePolicy: { mode: "all_final_results" },
        authorityOrder: "default",
        entryBrief: "default",
        dispatchBrief: "default",
      },
    });

    expect(prompt).toContain(
      "Return the plain raw reply, or record one permitted dispatch-scoped OpenMeld Space Action through the supplied interface for a controlled visible outcome. Answer text never becomes an action."
    );
    expect(prompt).not.toContain(
      "OpenMeld will not publish raw prose for you."
    );
    expect(prompt).toContain(
      "Your answer text never selects an OpenMeld Space action."
    );
    expect(prompt).not.toContain("Use post_status");
    expect(prompt).not.toContain("```openmeld-space-action");
  });

  it("includes current reply target and send target reference lines in the repair prompt", () => {
    const prompt = buildStructuredActionRepairPrompt({
      currentReplyToSignalId: "sig-current-reply",
      parseError: "invalid target profile",
      sendTargetReferenceLines: [
        "Budget Analyst -> agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa (wake | reference)",
        "Mira -> 11111111-1111-4111-8111-111111111111 (mention)",
      ],
      spaceId: "space-123",
    });

    expect(prompt).toContain(
      "post_message.messageEnvelope.replyToSignalId must match the current dispatch reply target: sig-current-reply."
    );
    expect(prompt).toContain("Current send target reference:");
    expect(prompt).toContain(
      "Budget Analyst -> agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa (wake | reference)"
    );
    expect(prompt).toContain(
      "Mira -> 11111111-1111-4111-8111-111111111111 (mention)"
    );
  });

  it("carries structured action diagnostics when coercing a collaboration failure", () => {
    const payload = coerceRuntimeResultToStructuredActionFailure({
      diagnostics: {
        carrierKind: "none",
        invalidOutputPreview: "hi",
        publicFailureReason:
          "A valid OpenMeld Space action is required in collaboration mode.",
        repairMode: "controller_roundtrip",
        spaceActionCandidatePresent: false,
        spaceActionParseError: null,
      },
      failureReason:
        "A valid OpenMeld Space action is required in collaboration mode.",
      runtimeResult: createRuntimeTaskResultFixture({
        resultPayload: {
          status: "success",
          attemptId: "attempt-diagnostics-1",
          taskId: "task-diagnostics-1",
          sourceEventId: "signal-diagnostics-1",
          agentId: "agt_diagnostics_1",
          deduped: false,
          agentControllerRef: "builtin:openclaw",
          output: "hi",
        },
      }),
    });

    expect(payload.status).toBe("failed");
    if (payload.status !== "failed") {
      throw new Error("expected a failed payload");
    }
    expect(payload.spaceActionFailureDiagnostics).toEqual({
      carrierKind: "none",
      invalidOutputPreview: "hi",
      publicFailureReason:
        "A valid OpenMeld Space action is required in collaboration mode.",
      repairMode: "controller_roundtrip",
      spaceActionCandidatePresent: false,
      spaceActionParseError: null,
    });
  });

  it("preserves actionable upstream failure details when action repair never started", () => {
    const runtimeResult = createRuntimeTaskResultFixture({
      resultPayload: {
        status: "failed",
        attemptId: "attempt-upstream-model-1",
        taskId: "task-upstream-model-1",
        sourceEventId: "signal-upstream-model-1",
        agentId: "agt_openclaw_model_1",
        deduped: false,
        agentControllerRef: "builtin:openclaw",
        errorType: "config",
        errorCode: "model.unsupported",
        errorMessage:
          '{"detail":"The \'gpt-5.3-codex-spark\' model is not supported when using Codex with a ChatGPT account."}',
      },
    });
    if (runtimeResult.resultPayload.status !== "failed") {
      throw new Error("expected a failed runtime payload");
    }
    const payload = coerceRuntimeResultToStructuredActionFailure({
      failureReason:
        resolvePublicAgentFailureReason({
          errorCode: runtimeResult.resultPayload.errorCode,
          errorMessage: runtimeResult.resultPayload.errorMessage,
        }) ??
        "The current Codex model is not available for this ChatGPT-backed account.",
      runtimeResult,
    });

    expect(payload.status).toBe("failed");
    if (payload.status !== "failed") {
      throw new Error("expected a failed payload");
    }
    expect(payload.errorCode).toBe("openmeld.space_action.repair_failed");
    expect(payload.errorMessage).toBe(
      "The selected model is no longer available for this account. Choose another model in the Agent Profile, then try again."
    );
  });

  it("preserves upstream failed runtimes instead of routing them into OpenMeld action repair", () => {
    const runtimeResult = createRuntimeTaskResultFixture({
      resultPayload: {
        status: "failed",
        attemptId: "attempt-upgrade-required-1",
        taskId: "task-upgrade-required-1",
        sourceEventId: "signal-upgrade-required-1",
        agentId: "agt_upgrade_required_1",
        deduped: false,
        agentControllerRef: "builtin:codex",
        errorType: "config",
        errorCode: "controller.client.upgrade_required",
        errorMessage:
          "controller.client.upgrade_required: The 'gpt-5.5' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.",
      },
    });
    if (runtimeResult.resultPayload.status !== "failed") {
      throw new Error("expected a failed runtime payload");
    }

    expect(
      resolveStructuredActionRequirementFailure({
        requiresStructuredSpaceAction: true,
        resolution: {
          action: undefined,
          parseError: null,
        },
        runtimeResult,
      })
    ).toEqual({
      failureReason: CODEX_UPGRADE_REQUIRED_REASON,
      kind: "preserve_runtime_failure",
    });
  });

  it("does not turn a denied runtime with a malformed action into a new repair attempt", () => {
    const runtimeResult = createRuntimeTaskResultFixture({
      resultPayload: {
        status: "failed",
        attemptId: "attempt-denied",
        taskId: "task-denied",
        sourceEventId: "event-denied",
        agentId: "agt_denied",
        deduped: false,
        agentControllerRef: "builtin:claude-code",
        errorType: "adapter",
        errorCode: "permission.denied.runtime",
        errorMessage: "Explicitly denied by the user.",
      },
    });
    expect(
      resolveStructuredActionRequirementFailure({
        requiresStructuredSpaceAction: true,
        resolution: {
          action: undefined,
          parseError: "Malformed stale tool result.",
        },
        runtimeResult,
      })?.kind
    ).toBe("preserve_runtime_failure");
  });

  it("prefers the resolved agent controller conversation during controller repair retries", () => {
    const continuation = resolveStructuredActionRepairContinuation({
      runtimeResult: createRuntimeTaskResultFixture({
        contextResolution: {
          agentControllerConversationId: "session-runtime-2",
          mappingVersion: 1,
          sourceField: "agentControllerConversationId",
          agentControllerConversation: {
            agentControllerRef: "builtin:openclaw",
            agentControllerConversationKind: "session",
            agentControllerConversationId: "resolved-session",
          },
        },
        dispatchResult: {
          adapterResult: {
            contextDelta: {
              agentControllerConversationId: "session-runtime-2",
              agentControllerConversation: {
                agentControllerRef: "builtin:openclaw",
                agentControllerConversationKind: "session",
                agentControllerConversationId: "delta-session",
              },
            },
            output: "ok",
            status: "success",
          },
          dispatched: true,
          reason: "dispatched",
        },
        resultPayload: {
          status: "success",
          attemptId: "attempt-repair-4",
          taskId: "task-repair-4",
          sourceEventId: "signal-repair-4",
          agentId: "agt_repair_4",
          deduped: false,
          agentControllerRef: "builtin:openclaw",
          output: "ok",
        },
      }),
      agentControllerConversationOverride: {
        agentControllerRef: "builtin:openclaw",
        agentControllerConversationKind: "session",
        agentControllerConversationId: "override-session",
      },
    });

    expect(continuation).toEqual({
      contextId: "session-runtime-2",
      agentControllerConversationOverride: {
        agentControllerRef: "builtin:openclaw",
        agentControllerConversationKind: "session",
        agentControllerConversationId: "resolved-session",
      },
    });
  });
});
