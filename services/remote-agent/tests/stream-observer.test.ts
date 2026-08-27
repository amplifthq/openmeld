import type { FlueObservation } from "@flue/runtime";
import {
  OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS,
  OBSERVABILITY_CLOUDFLARE_ANALYTICS_DOUBLES,
  REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES,
} from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
  readRemoteAgentCallbackContext,
  recordRemoteAgentWorkLoopCheckpoint,
} from "../agent-core/callback-context";
import { readRemoteAgentTurnObservability } from "../agent-core/turn-observability";
import { createRemoteAgentConversationCompactionObserver } from "../flue-adapter/conversation-compaction";
import { runWithRemoteAgentSubmissionExecution } from "../flue-adapter/execution-context";
import {
  handleCenterAgentObservation,
  resolveRemoteAgentObservationSubmissionId,
} from "../flue-adapter/stream-observer";
import { createRemoteAgentStreamPublisher } from "../flue-adapter/streaming";
import { createSubmitTurnRequest, TEST_NOW_MS } from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

const SUBMISSION_ID = "flue_submission_123";

describe("Center Agent stream observation", () => {
  it("publishes real Flue tool lifecycle events without their arguments", async () => {
    const storage = new InMemoryDurableObjectStorage();
    await putRemoteAgentCallbackContext(
      storage,
      createRemoteAgentCallbackContext({
        ack: {
          accepted: true,
          createdAt: TEST_NOW_MS,
          idempotencyKey: "remote-agent:dispatch_123",
          requestId: SUBMISSION_ID,
          status: "pending",
          submissionId: SUBMISSION_ID,
        },
        nowMs: TEST_NOW_MS,
        request: createSubmitTurnRequest(),
      })
    );
    const submitRemoteAgentStreamPart = vi.fn(
      async (body: { sequence: number }) => ({
        status: "accepted" as const,
        lastSequence: body.sequence,
      })
    );
    const resolveDependencies = () => ({
      coreWorker: { submitRemoteAgentStreamPart },
      env: {} as CloudflareBindings,
      storage,
    });
    const { submissionId: _omittedSubmissionId, ...productionShapedToolStart } =
      toolStartObservation();

    await runWithRemoteAgentSubmissionExecution(SUBMISSION_ID, () =>
      handleCenterAgentObservation({
        event: productionShapedToolStart as FlueObservation,
        resolveDependencies,
        streamPublisher: createRemoteAgentStreamPublisher(),
      })
    );

    expect(submitRemoteAgentStreamPart).toHaveBeenCalledWith({
      agentProfileId: expect.any(String),
      bindingId: expect.any(String),
      dispatchId: expect.any(String),
      idempotencyKey: expect.any(String),
      observedAtMs: TEST_NOW_MS + 10,
      organizationId: expect.any(String),
      part: {
        type: "tool",
        toolCallId: "tool_call_1",
        toolName: "openmeld_list_spaces",
        state: "input-available",
        work: {
          v: 1,
          key: "spaces.read",
        },
      },
      sequence: 1,
      source: "flue.tool",
      spaceId: expect.any(String),
      streamId: `stream:${SUBMISSION_ID}`,
      submissionId: SUBMISSION_ID,
      triggerMessageId: expect.any(String),
      v: 1,
    });
    await expect(
      readRemoteAgentTurnObservability({ storage, submissionId: SUBMISSION_ID })
    ).resolves.toMatchObject({
      firstVisibleContentAtMs: expect.any(Number),
    });
  });

  it("keeps the GitHub repository label when the tool completion omits arguments", async () => {
    const storage = new InMemoryDurableObjectStorage();
    await putRemoteAgentCallbackContext(
      storage,
      createRemoteAgentCallbackContext({
        ack: {
          accepted: true,
          createdAt: TEST_NOW_MS,
          idempotencyKey: "remote-agent:dispatch_123",
          requestId: SUBMISSION_ID,
          status: "pending",
          submissionId: SUBMISSION_ID,
        },
        nowMs: TEST_NOW_MS,
        request: createSubmitTurnRequest(),
      })
    );
    const submitRemoteAgentStreamPart = vi.fn(
      async (body: { sequence: number }) => ({
        status: "accepted" as const,
        lastSequence: body.sequence,
      })
    );
    const resolveDependencies = () => ({
      coreWorker: { submitRemoteAgentStreamPart },
      env: {} as CloudflareBindings,
      storage,
    });

    await handleCenterAgentObservation({
      event: toolStartObservation("github_get_repository", {
        owner: "amplifthq",
        repo: "openmeld",
      }),
      resolveDependencies,
      streamPublisher: createRemoteAgentStreamPublisher(),
    });
    await handleCenterAgentObservation({
      event: toolCompletionObservation("github_get_repository"),
      resolveDependencies,
      streamPublisher: createRemoteAgentStreamPublisher(),
    });

    expect(submitRemoteAgentStreamPart).toHaveBeenCalledTimes(2);
    expect(submitRemoteAgentStreamPart.mock.calls[1]?.[0]).toMatchObject({
      part: {
        state: "output-available",
        toolCallId: "tool_call_1",
        toolName: "github_get_repository",
        type: "tool",
        work: {
          key: "github.repository.read",
          subject: {
            kind: "repository",
            label: "amplifthq/openmeld",
          },
          v: 1,
        },
      },
    });
  });

  it("publishes connected app completion with the safe label from its start", async () => {
    const storage = new InMemoryDurableObjectStorage();
    await putRemoteAgentCallbackContext(
      storage,
      createRemoteAgentCallbackContext({
        ack: {
          accepted: true,
          createdAt: TEST_NOW_MS,
          idempotencyKey: "remote-agent:dispatch_123",
          requestId: SUBMISSION_ID,
          status: "pending",
          submissionId: SUBMISSION_ID,
        },
        nowMs: TEST_NOW_MS,
        request: createSubmitTurnRequest(),
      })
    );
    const submitRemoteAgentStreamPart = vi.fn(
      async (body: { sequence: number }) => ({
        status: "accepted" as const,
        lastSequence: body.sequence,
      })
    );
    const resolveDependencies = () => ({
      coreWorker: { submitRemoteAgentStreamPart },
      env: {} as CloudflareBindings,
      storage,
    });

    await handleCenterAgentObservation({
      event: toolStartObservation("openmeld_execute_app_action", {
        actionId: "gmail.fetch_emails",
        service: "gmail",
      }),
      resolveDependencies,
      streamPublisher: createRemoteAgentStreamPublisher(),
    });
    await handleCenterAgentObservation({
      event: toolCompletionObservation("openmeld_execute_app_action"),
      resolveDependencies,
      streamPublisher: createRemoteAgentStreamPublisher(),
    });

    expect(submitRemoteAgentStreamPart).toHaveBeenCalledTimes(2);
    expect(submitRemoteAgentStreamPart.mock.calls[1]?.[0]).toMatchObject({
      part: {
        state: "output-available",
        toolCallId: "tool_call_1",
        toolName: "openmeld_execute_app_action",
        type: "tool",
        work: {
          key: "connected_app.action.execute",
          subject: {
            kind: "connected_app",
            label: "Gmail: fetch emails",
          },
          v: 1,
        },
      },
    });
  });

  it("keeps the Code Mode wrapper out of user-visible work", async () => {
    const storage = new InMemoryDurableObjectStorage();
    await putRemoteAgentCallbackContext(
      storage,
      createRemoteAgentCallbackContext({
        ack: {
          accepted: true,
          createdAt: TEST_NOW_MS,
          idempotencyKey: "remote-agent:dispatch_123",
          requestId: SUBMISSION_ID,
          status: "pending",
          submissionId: SUBMISSION_ID,
        },
        nowMs: TEST_NOW_MS,
        request: createSubmitTurnRequest(),
      })
    );
    const submitRemoteAgentStreamPart = vi.fn();

    await handleCenterAgentObservation({
      event: toolStartObservation("codemode"),
      resolveDependencies: () => ({
        coreWorker: { submitRemoteAgentStreamPart },
        env: {} as CloudflareBindings,
        storage,
      }),
      streamPublisher: createRemoteAgentStreamPublisher(),
    });

    expect(submitRemoteAgentStreamPart).not.toHaveBeenCalled();
  });

  it("keeps the Code Mode wrapper hidden when it finishes", async () => {
    const storage = new InMemoryDurableObjectStorage();
    await putRemoteAgentCallbackContext(
      storage,
      createRemoteAgentCallbackContext({
        ack: {
          accepted: true,
          createdAt: TEST_NOW_MS,
          idempotencyKey: "remote-agent:dispatch_123",
          requestId: SUBMISSION_ID,
          status: "pending",
          submissionId: SUBMISSION_ID,
        },
        nowMs: TEST_NOW_MS,
        request: createSubmitTurnRequest(),
      })
    );
    const submitRemoteAgentStreamPart = vi.fn();

    await handleCenterAgentObservation({
      event: toolCompletionObservation("codemode"),
      resolveDependencies: () => ({
        coreWorker: { submitRemoteAgentStreamPart },
        env: {} as CloudflareBindings,
        storage,
      }),
      streamPublisher: createRemoteAgentStreamPublisher(),
    });

    expect(submitRemoteAgentStreamPart).not.toHaveBeenCalled();
  });

  it("records a successful Organization Skill activation without exposing its arguments", async () => {
    const storage = new InMemoryDurableObjectStorage();
    await putRemoteAgentCallbackContext(
      storage,
      createRemoteAgentCallbackContext({
        ack: {
          accepted: true,
          createdAt: TEST_NOW_MS,
          idempotencyKey: "remote-agent:dispatch_123",
          requestId: SUBMISSION_ID,
          status: "pending",
          submissionId: SUBMISSION_ID,
        },
        nowMs: TEST_NOW_MS,
        request: createSubmitTurnRequest({
          organizationSkillReleases: [
            {
              digest: "a".repeat(64),
              name: "release-review",
              releaseId: "release_123",
              skillId: "skill_123",
            },
          ],
        }),
      })
    );
    const recordOrganizationSkillActivation = vi.fn(async () => ({
      recorded: true,
    }));
    const submitRemoteAgentStreamPart = vi.fn();
    const resolveDependencies = () => ({
      coreWorker: {
        recordOrganizationSkillActivation,
        submitRemoteAgentStreamPart,
      },
      env: {} as CloudflareBindings,
      storage,
    });

    await handleCenterAgentObservation({
      event: toolStartObservation("activate_skill", {
        name: "release-review",
      }),
      resolveDependencies,
      streamPublisher: createRemoteAgentStreamPublisher(),
    });
    await handleCenterAgentObservation({
      event: toolCompletionObservation("activate_skill"),
      resolveDependencies,
      streamPublisher: createRemoteAgentStreamPublisher(),
    });

    expect(recordOrganizationSkillActivation).toHaveBeenCalledWith({
      context: {
        activeOrganizationId: "org_123",
        actorContext: {
          agentControllerRef: "hosted:center-agent",
          callerPrincipalId: "user_1",
          ownerUserId: "user_1",
          profileKind: "agent",
          requestId: `remote-agent-skill-activation:${SUBMISSION_ID}:skill_123`,
          openMeldProfileId: expect.any(String),
        },
        agentControllerConversationId: SUBMISSION_ID,
      },
      digest: "a".repeat(64),
      releaseId: "release_123",
      routineRunId: null,
      skillId: "skill_123",
      submissionId: SUBMISSION_ID,
    });
    expect(submitRemoteAgentStreamPart).not.toHaveBeenCalled();
  });

  it("keeps private model reasoning out of the user-visible stream", async () => {
    const storage = new InMemoryDurableObjectStorage();
    await putRemoteAgentCallbackContext(
      storage,
      createRemoteAgentCallbackContext({
        ack: {
          accepted: true,
          createdAt: TEST_NOW_MS,
          idempotencyKey: "remote-agent:dispatch_123",
          requestId: SUBMISSION_ID,
          status: "pending",
          submissionId: SUBMISSION_ID,
        },
        nowMs: TEST_NOW_MS,
        request: createSubmitTurnRequest(),
      })
    );
    const submitRemoteAgentStreamDelta = vi.fn(
      async (body: { sequence: number }) => ({
        status: "accepted" as const,
        lastSequence: body.sequence,
      })
    );
    const thinking = "Checking ".repeat(25);

    await handleCenterAgentObservation({
      event: thinkingDeltaObservation(thinking),
      resolveDependencies: () => ({
        coreWorker: { submitRemoteAgentStreamDelta },
        env: {} as CloudflareBindings,
        storage,
      }),
      streamPublisher: createRemoteAgentStreamPublisher(),
    });

    expect(submitRemoteAgentStreamDelta).not.toHaveBeenCalled();
  });

  it("keeps post-checkpoint stop prose out of the user-visible stream", async () => {
    const storage = new InMemoryDurableObjectStorage();
    await putRemoteAgentCallbackContext(
      storage,
      createRemoteAgentCallbackContext({
        ack: {
          accepted: true,
          createdAt: TEST_NOW_MS,
          idempotencyKey: "remote-agent:dispatch_123",
          requestId: SUBMISSION_ID,
          status: "pending",
          submissionId: SUBMISSION_ID,
        },
        nowMs: TEST_NOW_MS,
        request: createSubmitTurnRequest(),
      })
    );
    await recordRemoteAgentWorkLoopCheckpoint({
      checkpoint: {
        reason: "tool_call_budget_exhausted",
        toolCallLimit: 64,
        v: 1,
      },
      storage,
      submissionId: SUBMISSION_ID,
    });
    const submitRemoteAgentStreamDelta = vi.fn();

    await handleCenterAgentObservation({
      event: textDeltaObservation("I stopped before testing. ".repeat(10)),
      resolveDependencies: () => ({
        coreWorker: { submitRemoteAgentStreamDelta },
        env: {} as CloudflareBindings,
        storage,
      }),
      streamPublisher: createRemoteAgentStreamPublisher(),
    });

    expect(submitRemoteAgentStreamDelta).not.toHaveBeenCalled();
  });

  it("uses the immutable Flue execution identity when a live delta omits submissionId", async () => {
    const storage = new InMemoryDurableObjectStorage();
    await putRemoteAgentCallbackContext(
      storage,
      createRemoteAgentCallbackContext({
        ack: {
          accepted: true,
          createdAt: TEST_NOW_MS,
          idempotencyKey: "remote-agent:dispatch_123",
          requestId: SUBMISSION_ID,
          status: "pending",
          submissionId: SUBMISSION_ID,
        },
        nowMs: TEST_NOW_MS,
        request: createSubmitTurnRequest(),
      })
    );
    const submitRemoteAgentStreamDelta = vi.fn(
      async (body: { sequence: number }) => ({
        status: "accepted" as const,
        lastSequence: body.sequence,
      })
    );
    const text = "Streaming ".repeat(25);
    const { submissionId: _omittedSubmissionId, ...productionShapedDelta } =
      textDeltaObservation(text);

    await runWithRemoteAgentSubmissionExecution(SUBMISSION_ID, () =>
      handleCenterAgentObservation({
        event: productionShapedDelta as FlueObservation,
        resolveDependencies: () => ({
          coreWorker: { submitRemoteAgentStreamDelta },
          env: {} as CloudflareBindings,
          storage,
        }),
        streamPublisher: createRemoteAgentStreamPublisher(),
      })
    );

    expect(submitRemoteAgentStreamDelta).toHaveBeenCalledWith(
      expect.objectContaining({
        delta: text,
        kind: "text",
        snapshot: text,
        source: "flue.text_delta",
        submissionId: SUBMISSION_ID,
        v: 2,
      })
    );
  });

  it("persists the first published stream content with end-to-end correlation", async () => {
    const storage = new InMemoryDurableObjectStorage();
    await putRemoteAgentCallbackContext(
      storage,
      createRemoteAgentCallbackContext({
        ack: {
          accepted: true,
          createdAt: TEST_NOW_MS,
          idempotencyKey: "remote-agent:dispatch_123",
          requestId: SUBMISSION_ID,
          status: "pending",
          submissionId: SUBMISSION_ID,
        },
        nowMs: TEST_NOW_MS,
        request: createSubmitTurnRequest(),
      })
    );
    const writeDataPoint = vi.fn();
    const submitRemoteAgentStreamDelta = vi.fn(
      async (body: { sequence: number }) => ({
        status: "accepted" as const,
        lastSequence: body.sequence,
      })
    );

    await handleCenterAgentObservation({
      event: textDeltaObservation("Streaming ".repeat(25)),
      resolveDependencies: () => ({
        coreWorker: { submitRemoteAgentStreamDelta },
        env: {
          OPENMELD_OBSERVABILITY: { writeDataPoint },
          OPENMELD_WORKER_ENVIRONMENT: "test",
        } as unknown as CloudflareBindings,
        storage,
      }),
      streamPublisher: createRemoteAgentStreamPublisher(),
    });

    expect(writeDataPoint).toHaveBeenCalledOnce();
    const point = writeDataPoint.mock.calls[0]?.[0] as AnalyticsPoint;
    expect(readBlob(point, "event")).toBe(
      "remote_agent.openmeld.execution_stage.stream.first_content_text"
    );
    expect(readBlob(point, "dispatchId")).toBe("dispatch_123");
    expect(readBlob(point, "spaceId")).toBe("space_123");
    expect(readBlob(point, "requestId")).toBe(SUBMISSION_ID);
    expect(readDouble(point, "durationMs")).toBeGreaterThanOrEqual(0);
  });

  it("fails closed when a live delta has no immutable submission identity", async () => {
    const { submissionId: _omittedSubmissionId, ...unattributedDelta } =
      textDeltaObservation("Unattributed");

    await expect(
      handleCenterAgentObservation({
        event: unattributedDelta as FlueObservation,
        resolveDependencies: () => ({
          coreWorker: {},
          env: {} as CloudflareBindings,
          storage: new InMemoryDurableObjectStorage(),
        }),
        streamPublisher: createRemoteAgentStreamPublisher(),
      })
    ).rejects.toThrow(
      "Remote Agent observation is missing immutable submission identity."
    );
  });

  it("fails closed when a live delta and Flue execution identities disagree", async () => {
    await expect(
      runWithRemoteAgentSubmissionExecution(
        "submission_different_execution",
        async () =>
          handleCenterAgentObservation({
            event: textDeltaObservation("Mismatched"),
            resolveDependencies: () => ({
              coreWorker: {},
              env: {} as CloudflareBindings,
              storage: new InMemoryDurableObjectStorage(),
            }),
            streamPublisher: createRemoteAgentStreamPublisher(),
          })
      )
    ).rejects.toThrow(
      "Remote Agent observation submission identity does not match its Flue execution."
    );
  });

  it("still sends the authoritative final callback when delta delivery fails", async () => {
    const storage = new InMemoryDurableObjectStorage();
    await putRemoteAgentCallbackContext(
      storage,
      createRemoteAgentCallbackContext({
        ack: {
          accepted: true,
          createdAt: TEST_NOW_MS,
          idempotencyKey: "remote-agent:dispatch_123",
          requestId: SUBMISSION_ID,
          status: "pending",
          submissionId: SUBMISSION_ID,
        },
        nowMs: TEST_NOW_MS,
        request: createSubmitTurnRequest(),
      })
    );
    const submitRemoteAgentStreamDelta = vi.fn(() =>
      Promise.reject(new Error("stream callback unavailable"))
    );
    const completeRemoteAgentSubmission = vi.fn(async () => ({
      publishedSignalId: "signal_final_1",
      status: "accepted" as const,
    }));
    const resolveDependencies = () => ({
      coreWorker: {
        completeRemoteAgentSubmission,
        submitRemoteAgentStreamDelta,
      },
      env: {} as CloudflareBindings,
      storage,
    });
    const streamPublisher = createRemoteAgentStreamPublisher({
      sleep: async () => undefined,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      await handleCenterAgentObservation({
        event: textDeltaObservation("Partial"),
        resolveDependencies,
        streamPublisher,
      });
      await handleCenterAgentObservation({
        event: completedPromptObservation("Authoritative final"),
        resolveDependencies,
        streamPublisher,
      });
    } finally {
      warn.mockRestore();
    }

    expect(submitRemoteAgentStreamDelta).toHaveBeenCalledTimes(2);
    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionId: SUBMISSION_ID,
        text: "Authoritative final",
      })
    );
  });

  it("keeps the authoritative final answer durable when its first Core callback fails", async () => {
    const storage = new InMemoryDurableObjectStorage();
    await putRemoteAgentCallbackContext(
      storage,
      createRemoteAgentCallbackContext({
        ack: {
          accepted: true,
          createdAt: TEST_NOW_MS,
          idempotencyKey: "remote-agent:dispatch_123",
          requestId: SUBMISSION_ID,
          status: "pending",
          submissionId: SUBMISSION_ID,
        },
        nowMs: TEST_NOW_MS,
        request: createSubmitTurnRequest(),
      })
    );
    const completeRemoteAgentSubmission = vi.fn(() =>
      Promise.reject(new Error("Core callback connection closed"))
    );

    await handleCenterAgentObservation({
      event: completedPromptObservation("Durable authoritative final"),
      resolveDependencies: () => ({
        coreWorker: { completeRemoteAgentSubmission },
        env: {} as CloudflareBindings,
        storage,
      }),
      streamPublisher: createRemoteAgentStreamPublisher(),
    });

    await expect(
      readRemoteAgentCallbackContext(storage, SUBMISSION_ID)
    ).resolves.toMatchObject({
      callbackStatus: "retryable",
      completedText: "Durable authoritative final",
    });
  });

  it("uses the immutable Flue execution identity when a prompt observation omits submissionId", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const staleSubmissionId = "submission_stale_pending";
    const currentSubmissionId = "submission_current_execution";
    for (const [submissionId, createdAt] of [
      [staleSubmissionId, TEST_NOW_MS],
      [currentSubmissionId, TEST_NOW_MS + 1],
    ] as const) {
      await putRemoteAgentCallbackContext(
        storage,
        createRemoteAgentCallbackContext({
          ack: {
            accepted: true,
            createdAt,
            idempotencyKey: `remote-agent:${submissionId}`,
            requestId: submissionId,
            status: "pending",
            submissionId,
          },
          nowMs: createdAt,
          request: createSubmitTurnRequest({
            dispatchId: submissionId,
            idempotencyKey: `remote-agent:${submissionId}`,
          }),
        })
      );
    }
    const completeRemoteAgentSubmission = vi.fn(async () => ({
      publishedSignalId: "signal_current_reply",
      status: "accepted" as const,
    }));
    const {
      submissionId: _omittedSubmissionId,
      ...observationWithoutSubmissionId
    } = completedPromptObservation("Current reply.");

    await runWithRemoteAgentSubmissionExecution(currentSubmissionId, () =>
      handleCenterAgentObservation({
        event: observationWithoutSubmissionId as FlueObservation,
        resolveDependencies: () => ({
          coreWorker: { completeRemoteAgentSubmission },
          env: {} as CloudflareBindings,
          storage,
        }),
        streamPublisher: createRemoteAgentStreamPublisher(),
      })
    );

    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatchId: currentSubmissionId,
        submissionId: currentSubmissionId,
        text: "Current reply.",
      })
    );
    await expect(
      readRemoteAgentCallbackContext(storage, staleSubmissionId)
    ).resolves.toMatchObject({
      callbackAttempts: 0,
      callbackStatus: "pending",
    });
    await expect(
      readRemoteAgentCallbackContext(storage, currentSubmissionId)
    ).resolves.toMatchObject({
      callbackAttempts: 1,
      callbackStatus: "completed",
    });
  });

  it("fails closed when a prompt observation has no immutable submission identity", () => {
    const {
      submissionId: _omittedSubmissionId,
      ...observationWithoutSubmissionId
    } = completedPromptObservation("Unattributed reply.");

    expect(() => resolveRemoteAgentObservationSubmissionId()).toThrow(
      "Remote Agent observation is missing immutable submission identity."
    );
    expect(observationWithoutSubmissionId).not.toHaveProperty("submissionId");
  });

  it("fails closed when prompt and Flue execution identities disagree", async () => {
    const observation = completedPromptObservation("Mismatched reply.");

    await expect(
      runWithRemoteAgentSubmissionExecution(
        "submission_different_execution",
        async () =>
          resolveRemoteAgentObservationSubmissionId(observation.submissionId)
      )
    ).rejects.toThrow(
      "Remote Agent observation submission identity does not match its Flue execution."
    );
  });

  it("carries a successful Flue conversation compaction into the final callback", async () => {
    const storage = new InMemoryDurableObjectStorage();
    await putRemoteAgentCallbackContext(
      storage,
      createRemoteAgentCallbackContext({
        ack: {
          accepted: true,
          createdAt: TEST_NOW_MS,
          idempotencyKey: "remote-agent:dispatch_123",
          requestId: SUBMISSION_ID,
          status: "pending",
          submissionId: SUBMISSION_ID,
        },
        nowMs: TEST_NOW_MS,
        request: createSubmitTurnRequest(),
      })
    );
    const completeRemoteAgentSubmission = vi.fn(async () => ({
      publishedSignalId: "signal_final_1",
      status: "accepted" as const,
    }));
    const resolveDependencies = () => ({
      coreWorker: { completeRemoteAgentSubmission },
      env: {} as CloudflareBindings,
      storage,
    });
    const conversationCompactionObserver =
      createRemoteAgentConversationCompactionObserver();
    const streamPublisher = createRemoteAgentStreamPublisher();

    await handleCenterAgentObservation({
      conversationCompactionObserver,
      event: conversationCompactionStartObservation(),
      resolveDependencies,
      streamPublisher,
    });
    await handleCenterAgentObservation({
      conversationCompactionObserver,
      event: conversationCompactionCompletedObservation(),
      resolveDependencies,
      streamPublisher,
    });
    await handleCenterAgentObservation({
      conversationCompactionObserver,
      event: completedPromptObservation("Authoritative final"),
      resolveDependencies,
      streamPublisher,
    });

    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationCompaction: {
          completedAtMs: TEST_NOW_MS + 20,
          count: 1,
          v: 1,
        },
        submissionId: SUBMISSION_ID,
        text: "Authoritative final",
      })
    );
  });

  it("does not claim a failed Flue conversation compaction succeeded", async () => {
    const storage = new InMemoryDurableObjectStorage();
    await putRemoteAgentCallbackContext(
      storage,
      createRemoteAgentCallbackContext({
        ack: {
          accepted: true,
          createdAt: TEST_NOW_MS,
          idempotencyKey: "remote-agent:dispatch_123",
          requestId: SUBMISSION_ID,
          status: "pending",
          submissionId: SUBMISSION_ID,
        },
        nowMs: TEST_NOW_MS,
        request: createSubmitTurnRequest(),
      })
    );
    const completeRemoteAgentSubmission = vi.fn(async () => ({
      publishedSignalId: "signal_final_1",
      status: "accepted" as const,
    }));
    const resolveDependencies = () => ({
      coreWorker: { completeRemoteAgentSubmission },
      env: {} as CloudflareBindings,
      storage,
    });
    const conversationCompactionObserver =
      createRemoteAgentConversationCompactionObserver();
    const streamPublisher = createRemoteAgentStreamPublisher();

    await handleCenterAgentObservation({
      conversationCompactionObserver,
      event: conversationCompactionStartObservation(),
      resolveDependencies,
      streamPublisher,
    });
    await handleCenterAgentObservation({
      conversationCompactionObserver,
      event: conversationCompactionCompletedObservation(true),
      resolveDependencies,
      streamPublisher,
    });
    await handleCenterAgentObservation({
      conversationCompactionObserver,
      event: completedPromptObservation("Authoritative final"),
      resolveDependencies,
      streamPublisher,
    });

    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      expect.not.objectContaining({
        conversationCompaction: expect.anything(),
      })
    );
  });

  it("does not publish a compaction marker when the prompt fails after successful compaction", async () => {
    const storage = new InMemoryDurableObjectStorage();
    await putRemoteAgentCallbackContext(
      storage,
      createRemoteAgentCallbackContext({
        ack: {
          accepted: true,
          createdAt: TEST_NOW_MS,
          idempotencyKey: "remote-agent:dispatch_123",
          requestId: SUBMISSION_ID,
          status: "pending",
          submissionId: SUBMISSION_ID,
        },
        nowMs: TEST_NOW_MS,
        request: createSubmitTurnRequest(),
      })
    );
    const completeRemoteAgentSubmission = vi.fn(async () => ({
      status: "accepted" as const,
    }));
    const resolveDependencies = () => ({
      coreWorker: { completeRemoteAgentSubmission },
      env: {} as CloudflareBindings,
      storage,
    });
    const conversationCompactionObserver =
      createRemoteAgentConversationCompactionObserver();
    const streamPublisher = createRemoteAgentStreamPublisher();

    await handleCenterAgentObservation({
      conversationCompactionObserver,
      event: conversationCompactionStartObservation(),
      resolveDependencies,
      streamPublisher,
    });
    await handleCenterAgentObservation({
      conversationCompactionObserver,
      event: conversationCompactionCompletedObservation(),
      resolveDependencies,
      streamPublisher,
    });
    await handleCenterAgentObservation({
      conversationCompactionObserver,
      event: failedPromptObservation(),
      resolveDependencies,
      streamPublisher,
    });

    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        submissionId: SUBMISSION_ID,
      })
    );
    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      expect.not.objectContaining({
        conversationCompaction: expect.anything(),
      })
    );
  });

  it("writes one successful turn evidence row without prompt or message text", async () => {
    const storage = new InMemoryDurableObjectStorage();
    await putRemoteAgentCallbackContext(
      storage,
      createRemoteAgentCallbackContext({
        ack: {
          accepted: true,
          createdAt: TEST_NOW_MS,
          idempotencyKey: "remote-agent:dispatch_123",
          requestId: SUBMISSION_ID,
          status: "pending",
          submissionId: SUBMISSION_ID,
        },
        nowMs: TEST_NOW_MS,
        request: createSubmitTurnRequest(),
      })
    );
    const writeDataPoint = vi.fn();
    const completeRemoteAgentSubmission = vi.fn(async () => ({
      publishedSignalId: "signal_final_1",
      status: "accepted" as const,
    }));

    await handleCenterAgentObservation({
      event: completedPromptObservation("Sensitive final answer"),
      resolveDependencies: () => ({
        coreWorker: { completeRemoteAgentSubmission },
        env: {
          OPENMELD_OBSERVABILITY: { writeDataPoint },
          OPENMELD_WORKER_ENVIRONMENT: "test",
        } as unknown as CloudflareBindings,
        storage,
      }),
      streamPublisher: createRemoteAgentStreamPublisher(),
    });

    const point = writeDataPoint.mock.calls[0]?.[0] as {
      blobs: string[];
      doubles: number[];
      indexes: string[];
    };
    expect(readBlob(point, "event")).toBe("remote_agent.openmeld.turn");
    expect(readBlob(point, "workerName")).toBe("openmeld-remote-agent");
    expect(readBlob(point, "runtimeKind")).toBe("durable_object");
    expect(readBlob(point, "status")).toBe("succeeded");
    expect(readBlob(point, "reasonCode")).toBe(
      REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES.TURN_COMPLETED
    );
    expect(readBlob(point, "spaceId")).toBe("space_123");
    expect(readBlob(point, "clientMessageId")).toBe("client_msg_123");
    expect(readBlob(point, "sourceSignalId")).toBe("");
    expect(readBlob(point, "targetProfileId")).toBe(
      "agt_11111111-1111-4111-8111-111111111111"
    );
    expect(readBlob(point, "dispatchId")).toBe("dispatch_123");
    expect(readBlob(point, "bindingId")).toBe("binding_123");
    expect(readBlob(point, "requestId")).toBe(SUBMISSION_ID);
    expect(point.blobs).not.toContain("Sensitive final answer");
    expect(readDouble(point, "durationMs")).toBe(42);
    expect(point.indexes).toEqual(["client_msg_123"]);
  });

  it("does not let terminal stream cleanup block Flue turn settlement", async () => {
    const storage = new InMemoryDurableObjectStorage();
    await putRemoteAgentCallbackContext(
      storage,
      createRemoteAgentCallbackContext({
        ack: {
          accepted: true,
          createdAt: TEST_NOW_MS,
          idempotencyKey: "remote-agent:dispatch_123",
          requestId: SUBMISSION_ID,
          status: "pending",
          submissionId: SUBMISSION_ID,
        },
        nowMs: TEST_NOW_MS,
        request: createSubmitTurnRequest(),
      })
    );
    const streamPublisher = createRemoteAgentStreamPublisher();
    streamPublisher.close = vi.fn(
      async () => await new Promise<void>(() => undefined)
    );
    const backgroundTasks: Promise<void>[] = [];
    const scheduleBackground = vi.fn((task: Promise<void>) => {
      backgroundTasks.push(task);
    });
    const observation = handleCenterAgentObservation({
      event: completedPromptObservation("Authoritative final"),
      resolveDependencies: () => ({
        coreWorker: {
          completeRemoteAgentSubmission: vi.fn(async () => ({
            publishedSignalId: "signal_final_1",
            status: "accepted" as const,
          })),
        },
        env: {} as CloudflareBindings,
        storage,
      }),
      scheduleBackground,
      streamPublisher,
    });

    const outcome = await Promise.race([
      observation.then(() => "completed" as const),
      new Promise<"blocked">((resolve) => {
        setTimeout(() => resolve("blocked"), 25);
      }),
    ]);

    expect(outcome).toBe("completed");
    expect(scheduleBackground).toHaveBeenCalledOnce();
    expect(backgroundTasks).toHaveLength(1);
  });

  it("writes provider failure classification for a failed turn", async () => {
    const storage = new InMemoryDurableObjectStorage();
    await putRemoteAgentCallbackContext(
      storage,
      createRemoteAgentCallbackContext({
        ack: {
          accepted: true,
          createdAt: TEST_NOW_MS,
          idempotencyKey: "remote-agent:dispatch_123",
          requestId: SUBMISSION_ID,
          status: "pending",
          submissionId: SUBMISSION_ID,
        },
        nowMs: TEST_NOW_MS,
        request: createSubmitTurnRequest(),
      })
    );
    const writeDataPoint = vi.fn();
    const completeRemoteAgentSubmission = vi.fn(async () => ({
      publishedSignalId: "signal-provider-rate-limited",
      status: "accepted" as const,
    }));

    await handleCenterAgentObservation({
      event: failedPromptObservation(),
      resolveDependencies: () => ({
        coreWorker: { completeRemoteAgentSubmission },
        env: {
          OPENMELD_OBSERVABILITY: { writeDataPoint },
          OPENMELD_WORKER_ENVIRONMENT: "test",
        } as unknown as CloudflareBindings,
        storage,
      }),
      streamPublisher: createRemoteAgentStreamPublisher(),
    });

    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode:
          REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES.PROVIDER_RATE_LIMITED,
        failureDetail: "private provider response",
        failureMessage:
          "The model provider rate-limited this request. Wait a moment, then wake the agent again.",
        status: "failed",
        submissionId: SUBMISSION_ID,
      })
    );
    const point = writeDataPoint.mock.calls[0]?.[0] as AnalyticsPoint;
    expect(readBlob(point, "status")).toBe("failed");
    expect(readBlob(point, "reasonCode")).toBe(
      REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES.PROVIDER_RATE_LIMITED
    );
    expect(point.blobs).not.toContain("private provider response");
  });

  it("keeps structured context-window evidence aligned through the final Core callback", async () => {
    const storage = new InMemoryDurableObjectStorage();
    await putRemoteAgentCallbackContext(
      storage,
      createRemoteAgentCallbackContext({
        ack: {
          accepted: true,
          createdAt: TEST_NOW_MS,
          idempotencyKey: "remote-agent:dispatch_123",
          requestId: SUBMISSION_ID,
          status: "pending",
          submissionId: SUBMISSION_ID,
        },
        nowMs: TEST_NOW_MS,
        request: createSubmitTurnRequest(),
      })
    );
    const writeDataPoint = vi.fn();
    const completeRemoteAgentSubmission = vi.fn(async () => ({
      publishedSignalId: "signal_context_window_failure",
      status: "accepted" as const,
    }));

    await handleCenterAgentObservation({
      event: contextWindowFailedPromptObservation(),
      resolveDependencies: () => ({
        coreWorker: { completeRemoteAgentSubmission },
        env: {
          OPENMELD_OBSERVABILITY: { writeDataPoint },
          OPENMELD_WORKER_ENVIRONMENT: "test",
        } as unknown as CloudflareBindings,
        storage,
      }),
      streamPublisher: createRemoteAgentStreamPublisher(),
    });

    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: "remote_agent.turn.context_window_exceeded",
        failureDetail: "The request is too large.",
        status: "failed",
        submissionId: SUBMISSION_ID,
      })
    );
    const point = writeDataPoint.mock.calls[0]?.[0] as AnalyticsPoint;
    expect(readBlob(point, "status")).toBe("failed");
    expect(readBlob(point, "reasonCode")).toBe(
      REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES.TURN_CONTEXT_WINDOW_EXCEEDED
    );
  });

  it("writes timeout evidence when the prompt operation is interrupted", async () => {
    const storage = new InMemoryDurableObjectStorage();
    await putRemoteAgentCallbackContext(
      storage,
      createRemoteAgentCallbackContext({
        ack: {
          accepted: true,
          createdAt: TEST_NOW_MS,
          idempotencyKey: "remote-agent:dispatch_123",
          requestId: SUBMISSION_ID,
          status: "pending",
          submissionId: SUBMISSION_ID,
        },
        nowMs: TEST_NOW_MS,
        request: createSubmitTurnRequest(),
      })
    );
    const writeDataPoint = vi.fn();

    await handleCenterAgentObservation({
      event: timedOutPromptObservation(),
      resolveDependencies: () => ({
        coreWorker: {
          completeRemoteAgentSubmission: vi.fn(async () => ({
            status: "accepted" as const,
          })),
        },
        env: {
          OPENMELD_OBSERVABILITY: { writeDataPoint },
          OPENMELD_WORKER_ENVIRONMENT: "test",
        } as unknown as CloudflareBindings,
        storage,
      }),
      streamPublisher: createRemoteAgentStreamPublisher(),
    });

    expect(writeDataPoint).toHaveBeenCalledOnce();
    const point = writeDataPoint.mock.calls[0]?.[0] as AnalyticsPoint;
    expect(readBlob(point, "status")).toBe("failed");
    expect(readBlob(point, "reasonCode")).toBe(
      REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES.TURN_TIMEOUT
    );
    expect(point.blobs).not.toContain("private timeout detail");
  });
});

type AnalyticsPoint = {
  blobs: string[];
  doubles: number[];
  indexes: string[];
};

function readBlob(
  point: AnalyticsPoint,
  field: (typeof OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS)[number]
): string | undefined {
  return point.blobs[OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS.indexOf(field)];
}

function readDouble(
  point: AnalyticsPoint,
  field: (typeof OBSERVABILITY_CLOUDFLARE_ANALYTICS_DOUBLES)[number]
): number | undefined {
  return point.doubles[
    OBSERVABILITY_CLOUDFLARE_ANALYTICS_DOUBLES.indexOf(field)
  ];
}

function textDeltaObservation(text: string): FlueObservation {
  return {
    agentName: "center-agent",
    eventIndex: 1,
    submissionId: SUBMISSION_ID,
    text,
    timestamp: new Date(TEST_NOW_MS + 10).toISOString(),
    type: "text_delta",
    v: 3,
  } satisfies FlueObservation;
}

function thinkingDeltaObservation(delta: string): FlueObservation {
  return {
    agentName: "center-agent",
    delta,
    eventIndex: 1,
    submissionId: SUBMISSION_ID,
    timestamp: new Date(TEST_NOW_MS + 10).toISOString(),
    type: "thinking_delta",
    v: 3,
  } satisfies FlueObservation;
}

function toolStartObservation(
  toolName = "openmeld_list_spaces",
  args: Record<string, unknown> = { private: "must not leave the worker" }
): FlueObservation {
  return {
    agentName: "center-agent",
    args,
    eventIndex: 1,
    submissionId: SUBMISSION_ID,
    timestamp: new Date(TEST_NOW_MS + 10).toISOString(),
    toolCallId: "tool_call_1",
    toolName,
    type: "tool_start",
    v: 3,
  } satisfies FlueObservation;
}

function toolCompletionObservation(toolName: string): FlueObservation {
  return {
    agentName: "center-agent",
    durationMs: 10,
    eventIndex: 2,
    isError: false,
    result: {},
    submissionId: SUBMISSION_ID,
    timestamp: new Date(TEST_NOW_MS + 10).toISOString(),
    toolCallId: "tool_call_1",
    toolName,
    type: "tool",
    v: 3,
  } as FlueObservation;
}

function conversationCompactionStartObservation(): FlueObservation {
  return {
    agentName: "center-agent",
    estimatedTokens: 120_000,
    eventIndex: 1,
    reason: "threshold",
    submissionId: SUBMISSION_ID,
    timestamp: new Date(TEST_NOW_MS + 10).toISOString(),
    type: "compaction_start",
    v: 3,
  } satisfies FlueObservation;
}

function conversationCompactionCompletedObservation(
  isError = false
): FlueObservation {
  return {
    agentName: "center-agent",
    durationMs: 250,
    eventIndex: 2,
    isError,
    messagesAfter: isError ? 24 : 8,
    messagesBefore: 24,
    submissionId: SUBMISSION_ID,
    timestamp: new Date(TEST_NOW_MS + 20).toISOString(),
    type: "compaction",
    v: 3,
  } satisfies FlueObservation;
}

function completedPromptObservation(text: string): FlueObservation {
  return {
    agentName: "center-agent",
    agentOutput: {
      finishReason: "stop",
      text,
      type: "text",
    },
    durationMs: 42,
    eventIndex: 2,
    isError: false,
    operationId: "operation_1",
    operationKind: "prompt",
    submissionId: SUBMISSION_ID,
    timestamp: new Date(TEST_NOW_MS + 20).toISOString(),
    type: "operation",
    v: 3,
  } satisfies FlueObservation;
}

function failedPromptObservation(): FlueObservation {
  return {
    agentName: "center-agent",
    durationMs: 84,
    error: {
      code: "rate_limit_exceeded",
      message: "private provider response",
      name: "APIError",
    },
    errorInfo: {
      code: "rate_limit_exceeded",
      message: "private provider response",
      name: "APIError",
      type: "provider_error",
    },
    eventIndex: 3,
    isError: true,
    operationId: "operation_2",
    operationKind: "prompt",
    submissionId: SUBMISSION_ID,
    timestamp: new Date(TEST_NOW_MS + 30).toISOString(),
    type: "operation",
    v: 3,
  } satisfies FlueObservation;
}

function contextWindowFailedPromptObservation(): FlueObservation {
  return {
    agentName: "center-agent",
    durationMs: 120,
    error: {
      message: "The request is too large.",
      name: "APIError",
    },
    errorInfo: {
      code: "context_length_exceeded",
      message: "The request is too large.",
      name: "APIError",
      type: "provider_error",
    },
    eventIndex: 4,
    isError: true,
    operationId: "operation_context_window",
    operationKind: "prompt",
    submissionId: SUBMISSION_ID,
    timestamp: new Date(TEST_NOW_MS + 40).toISOString(),
    type: "operation",
    v: 3,
  } satisfies FlueObservation;
}

function timedOutPromptObservation(): FlueObservation {
  return {
    agentName: "center-agent",
    durationMs: 30_000,
    error: {
      message: "private timeout detail",
      name: "SubmissionTimeoutError",
      type: "submission_timeout",
    },
    errorInfo: {
      message: "The operation did not complete.",
      name: "OperationFailedError",
      type: "operation_error",
    },
    eventIndex: 4,
    isError: true,
    operationId: "operation_3",
    operationKind: "prompt",
    submissionId: SUBMISSION_ID,
    timestamp: new Date(TEST_NOW_MS + 40).toISOString(),
    type: "operation",
    v: 3,
  } satisfies FlueObservation;
}
