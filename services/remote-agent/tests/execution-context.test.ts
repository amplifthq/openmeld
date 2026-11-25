import { CENTER_AGENT_ANONYMOUS_MEMBER_TOOL_NAMES } from "@openmeld/schemas";
import { object } from "valibot";
import { describe, expect, it } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import type { RemoteAgentToolDefinition } from "../agent-core/tool-definition";
import { REMOTE_AGENT_ROUTINE_HIDDEN_TOOL_NAMES } from "../agent-core/tools";
import { REMOTE_AGENT_CAPABILITY_DISCOVERY_TOOL_NAMES } from "../flue-adapter/capability-discovery";
import {
  getRemoteAgentExecutionSubmissionId,
  REMOTE_AGENT_EXECUTION_INSTRUMENTATION,
  registerRemoteAgentExecutionPreparation,
  requireRemoteAgentExecutionResources,
  reserveRemoteAgentMessageReadBytes,
  resolveRemoteAgentExecutionCallbackContext,
  runWithRemoteAgentSubmissionExecution,
  updateRemoteAgentMessageReadBudget,
} from "../flue-adapter/execution-context";
import { getTestCapabilityCatalog } from "./capability-catalog.test-support";
import {
  TEST_CODE_MODE_LOADER,
  TEST_CODE_MODE_RUNTIME,
} from "./code-mode-runtime";
import {
  createRoutineTurnEnvelope,
  createSubmitTurnRequest,
  TEST_NOW_MS,
} from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

describe("Remote Agent submission execution context", () => {
  it("binds RPC callbacks to the measured allocation without an async execution context", async () => {
    const messageReadBudget = { remainingBytes: 8192 };
    const dispose = registerRemoteAgentExecutionPreparation(async () => ({
      messageReadBudget,
    }));
    try {
      await REMOTE_AGENT_EXECUTION_INSTRUMENTATION.interceptor(
        { operationId: "rpc-budget", operationKind: "prompt", type: "agent" },
        { submissionId: "rpc-budget" },
        () => {
          updateRemoteAgentMessageReadBudget({
            inputTokenBudget: 20_000,
            estimatedInputTokens: 12_000,
          });
          return Promise.resolve();
        }
      );
      // Invoke outside the execution scope, as Code Mode's RPC bridge does.
      expect(() => requireRemoteAgentExecutionResources()).toThrow();
      expect(reserveRemoteAgentMessageReadBytes(4096, messageReadBudget)).toBe(
        3904
      );
      expect(reserveRemoteAgentMessageReadBytes(4096, messageReadBudget)).toBe(
        0
      );
      expect(reserveRemoteAgentMessageReadBytes(4096)).toBe(0);
    } finally {
      dispose();
    }
  });
  it("shares one measured context budget across parallel reads and refreshes it on the next model round", async () => {
    const allocated = await REMOTE_AGENT_EXECUTION_INSTRUMENTATION.interceptor(
      { operationId: "read-budget", operationKind: "prompt", type: "agent" },
      { submissionId: "read-budget" },
      async () => {
        updateRemoteAgentMessageReadBudget({
          inputTokenBudget: 20_000,
          estimatedInputTokens: 12_000,
        });
        const firstRound = await Promise.all(
          [8192, 8192, 8192].map(async (requested) =>
            reserveRemoteAgentMessageReadBytes(requested)
          )
        );
        expect(firstRound.reduce((total, count) => total + count, 0)).toBe(
          3904
        );
        updateRemoteAgentMessageReadBudget({
          inputTokenBudget: 30_000,
          estimatedInputTokens: 3000,
        });
        return [
          reserveRemoteAgentMessageReadBytes(16_384),
          reserveRemoteAgentMessageReadBytes(4096),
        ];
      }
    );
    expect(allocated).toEqual([16_384, 0]);
  });
  it("keeps queued Routine and ordinary turns bound to their exact Flue submissions", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const routineRequest = createRoutineRequest("routine_run_queued");
    const ordinaryRequest = createSubmitTurnRequest({
      dispatchId: "dispatch_queued_after_routine",
      idempotencyKey: "remote-agent:dispatch_queued_after_routine",
    });
    await putRemoteAgentCallbackContext(
      storage,
      createRemoteAgentCallbackContext({
        ack: createAck("submission_routine_queued"),
        nowMs: TEST_NOW_MS,
        request: routineRequest,
      })
    );
    await putRemoteAgentCallbackContext(
      storage,
      createRemoteAgentCallbackContext({
        ack: createAck("submission_ordinary_queued"),
        nowMs: TEST_NOW_MS + 1,
        request: ordinaryRequest,
      })
    );

    const [routineContext, ordinaryContext] = await Promise.all([
      runWithRemoteAgentSubmissionExecution(
        "submission_routine_queued",
        async () =>
          await resolveRemoteAgentExecutionCallbackContext({ storage })
      ),
      runWithRemoteAgentSubmissionExecution(
        "submission_ordinary_queued",
        async () =>
          await resolveRemoteAgentExecutionCallbackContext({ storage })
      ),
    ]);

    expect(routineContext?.turnEnvelope?.trigger.source).toBe("routine");
    expect(routineContext?.idempotencyKey).toBe("routine_run_queued");
    expect(ordinaryContext?.turnEnvelope?.trigger.source).toBe("web_dm");
    expect(ordinaryContext?.idempotencyKey).toBe(
      "remote-agent:dispatch_queued_after_routine"
    );
    const routineToolNames = (
      await getTestCapabilityCatalog({
        agentActivityReadEnabled: true,
        codeModeRuntime: TEST_CODE_MODE_RUNTIME,
        coreWorker: {},
        env: { LOADER: TEST_CODE_MODE_LOADER },
        storage,
        submissionId: routineContext?.submissionId ?? "missing",
        turnEnvelope: routineContext?.turnEnvelope,
      })
    ).map((tool) => tool.name);
    const ordinaryToolNames = (
      await getTestCapabilityCatalog({
        agentActivityReadEnabled: true,
        codeModeRuntime: TEST_CODE_MODE_RUNTIME,
        coreWorker: {},
        env: { LOADER: TEST_CODE_MODE_LOADER },
        storage,
        submissionId: ordinaryContext?.submissionId ?? "missing",
        turnEnvelope: ordinaryContext?.turnEnvelope,
      })
    ).map((tool) => tool.name);
    expect(routineToolNames).toContain("openmeld_post_slack_channel_message");
    expect(routineToolNames).toContain("openmeld_post_space_message");
    expect(routineToolNames).toContain("openmeld_wake_agent_profiles_in_space");
    expect(routineToolNames).toContain("openmeld_create_space");
    expect(routineToolNames).toContain("openmeld_create_agent_profile");
    expect(routineToolNames).toContain("openmeld_add_members_to_space");
    expect(routineToolNames).toContain("openmeld_add_agent_profiles_to_space");
    expect(routineToolNames).toContain("openmeld_create_routine");
    for (const slackReadToolName of [
      "openmeld_list_slack_channels",
      "openmeld_read_slack_channel_members",
      "openmeld_read_slack_channel_history",
    ] as const) {
      expect(routineToolNames).toContain(slackReadToolName);
    }
    expect(routineToolNames).toContain("browser_screenshot");
    expect(routineToolNames).toContain("codemode");
    expect(routineToolNames).toContain("openmeld_set_final_reply_mentions");
    expect(ordinaryToolNames).not.toContain(
      "openmeld_set_final_reply_mentions"
    );
    const interactiveWorkTargetTools = [
      "openmeld_read_work_target",
      "openmeld_select_work_target",
    ];
    for (const name of interactiveWorkTargetTools) {
      expect(ordinaryToolNames).toContain(name);
      expect(routineToolNames).not.toContain(name);
    }
    expect(
      routineToolNames.filter(
        (name) => name !== "openmeld_set_final_reply_mentions"
      )
    ).toEqual(
      ordinaryToolNames.filter(
        (name) =>
          !(
            interactiveWorkTargetTools.includes(name) ||
            REMOTE_AGENT_ROUTINE_HIDDEN_TOOL_NAMES.some(
              (hiddenName) => hiddenName === name
            )
          )
      )
    );
    for (const hiddenName of REMOTE_AGENT_ROUTINE_HIDDEN_TOOL_NAMES) {
      expect(routineToolNames).not.toContain(hiddenName);
      if (
        hiddenName === "openmeld_remember_for_organization" ||
        hiddenName ===
          "openmeld_set_agent_profile_creation_approval_preferences"
      ) {
        expect(ordinaryToolNames).not.toContain(hiddenName);
      } else {
        expect(ordinaryToolNames).toContain(hiddenName);
      }
    }
    expect(ordinaryToolNames).toContain("openmeld_post_slack_channel_message");
    expect(ordinaryToolNames).toContain("openmeld_post_space_message");
    expect(ordinaryToolNames).toContain(
      "openmeld_wake_agent_profiles_in_space"
    );
    expect(ordinaryToolNames).toContain("openmeld_create_space");
    expect(ordinaryToolNames).toContain("openmeld_create_agent_profile");
    expect(ordinaryToolNames).toContain("openmeld_add_members_to_space");
    expect(ordinaryToolNames).toContain("openmeld_add_agent_profiles_to_space");
  });

  it("gives a connected Message Channel member only ordinary-member OpenMeld tools", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const base = createSubmitTurnRequest();
    const guestRequest = createSubmitTurnRequest({
      author: {
        displayName: "Anonymous member",
        profileId: null,
        profileKind: null,
      },
      onBehalfOf: null,
      turnEnvelope: {
        ...base.turnEnvelope,
        sender: {
          displayName: "Anonymous member",
          id: "slack:T123:U_GUEST",
          kind: "member",
          messageChannelIdentity: {
            connectionId: "T123",
            provider: "slack",
            providerUserId: "U_GUEST",
          },
          verified: false,
        },
        trigger: { source: "slack" },
      },
    });
    await putRemoteAgentCallbackContext(
      storage,
      createRemoteAgentCallbackContext({
        ack: createAck("submission_external_participant"),
        nowMs: TEST_NOW_MS,
        request: guestRequest,
      })
    );

    const toolNames = (
      await getTestCapabilityCatalog({
        agentActivityReadEnabled: true,
        codeModeRuntime: TEST_CODE_MODE_RUNTIME,
        coreWorker: {},
        env: { LOADER: TEST_CODE_MODE_LOADER },
        sandboxDefinitions: [createSandboxToolDefinition()],
        storage,
        submissionId: "submission_external_participant",
        turnEnvelope: guestRequest.turnEnvelope,
      })
    ).map((tool) => tool.name);

    expect(toolNames).toEqual(
      expect.arrayContaining([
        "web_search",
        "web_fetch",
        "browser_read_page",
        "browser_get_links",
        "browser_extract",
        "browser_scrape",
        "browser_screenshot",
      ])
    );
    expect(toolNames).toEqual([
      "openmeld_report_progress",
      ...CENTER_AGENT_ANONYMOUS_MEMBER_TOOL_NAMES.filter(
        (name) => name !== "openmeld_read_channel_file"
      ),
      ...REMOTE_AGENT_CAPABILITY_DISCOVERY_TOOL_NAMES,
      "codemode",
    ]);
    expect(toolNames).toContain("openmeld_get_app_action_status");
  });

  it("keeps legacy unverified participants without provider identity closed", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const base = createSubmitTurnRequest();
    const legacyRequest = createSubmitTurnRequest({
      author: {
        displayName: "Legacy participant",
        profileId: null,
        profileKind: null,
      },
      onBehalfOf: null,
      turnEnvelope: {
        ...base.turnEnvelope,
        sender: {
          displayName: "Legacy participant",
          id: "slack:T123:U_LEGACY",
          kind: "member",
          verified: false,
        },
        trigger: { source: "slack" },
      },
    });
    await putRemoteAgentCallbackContext(
      storage,
      createRemoteAgentCallbackContext({
        ack: createAck("submission_legacy_participant"),
        nowMs: TEST_NOW_MS,
        request: legacyRequest,
      })
    );

    const toolNames = (
      await getTestCapabilityCatalog({
        codeModeRuntime: TEST_CODE_MODE_RUNTIME,
        coreWorker: {},
        env: { LOADER: TEST_CODE_MODE_LOADER },
        sandboxDefinitions: [createSandboxToolDefinition()],
        storage,
        submissionId: "submission_legacy_participant",
        turnEnvelope: legacyRequest.turnEnvelope,
      })
    ).map((tool) => tool.name);

    // Runtime progress/catalog helpers grant no member data or App authority.
    expect(toolNames).toEqual([
      "openmeld_report_progress",
      ...REMOTE_AGENT_CAPABILITY_DISCOVERY_TOOL_NAMES,
      "codemode",
    ]);
  });

  it("waits for the exact admitted submission instead of falling through to a newer turn", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const resolving = runWithRemoteAgentSubmissionExecution(
      "submission_routine_waiting",
      async () =>
        await resolveRemoteAgentExecutionCallbackContext({
          storage,
          waitMs: 1000,
        })
    );
    await putRemoteAgentCallbackContext(
      storage,
      createRemoteAgentCallbackContext({
        ack: createAck("submission_ordinary_newer"),
        nowMs: TEST_NOW_MS + 1,
        request: createSubmitTurnRequest(),
      })
    );
    await putRemoteAgentCallbackContext(
      storage,
      createRemoteAgentCallbackContext({
        ack: createAck("submission_routine_waiting"),
        nowMs: TEST_NOW_MS,
        request: createRoutineRequest("routine_run_waiting"),
      })
    );

    await expect(resolving).resolves.toMatchObject({
      idempotencyKey: "routine_run_waiting",
      submissionId: "submission_routine_waiting",
    });
  });

  it("fails closed when an executing submission has no exact durable context", async () => {
    await expect(
      runWithRemoteAgentSubmissionExecution(
        "submission_context_missing",
        async () =>
          await resolveRemoteAgentExecutionCallbackContext({
            storage: new InMemoryDurableObjectStorage(),
            waitMs: 0,
          })
      )
    ).rejects.toThrow("exact durable callback context is unavailable");
  });

  it("prepares each concurrent submission once and preserves its resources through nested agent operations", async () => {
    const prepared: string[] = [];
    const dispose = registerRemoteAgentExecutionPreparation(async () => {
      const submissionId = getRemoteAgentExecutionSubmissionId();
      if (!submissionId) {
        throw new Error("Missing preparation owner.");
      }
      prepared.push(submissionId);
      await Promise.resolve();
      return { authorizedFor: submissionId };
    });
    try {
      const results = await Promise.all(
        ["a", "b"].map((submissionId) =>
          REMOTE_AGENT_EXECUTION_INSTRUMENTATION.interceptor(
            {
              operationId: submissionId,
              operationKind: "prompt",
              type: "agent",
            },
            { submissionId },
            async () => {
              await Promise.resolve();
              return await REMOTE_AGENT_EXECUTION_INSTRUMENTATION.interceptor(
                {
                  operationId: "nested",
                  operationKind: "prompt",
                  type: "agent",
                },
                { submissionId },
                async () =>
                  requireRemoteAgentExecutionResources<{
                    authorizedFor: string;
                  }>()
              );
            }
          )
        )
      );
      expect(results).toEqual([{ authorizedFor: "a" }, { authorizedFor: "b" }]);
      expect(prepared.sort()).toEqual(["a", "b"]);
      expect(() => requireRemoteAgentExecutionResources()).toThrow(
        "prepared execution resources"
      );
    } finally {
      dispose();
    }
  });

  it("propagates the immutable submission id through Flue agent execution", async () => {
    const seen = await Promise.all([
      REMOTE_AGENT_EXECUTION_INSTRUMENTATION.interceptor(
        { operationId: "submission_a", operationKind: "prompt", type: "agent" },
        { submissionId: "submission_a" },
        async () => {
          await Promise.resolve();
          return getRemoteAgentExecutionSubmissionId();
        }
      ),
      REMOTE_AGENT_EXECUTION_INSTRUMENTATION.interceptor(
        { operationId: "submission_b", operationKind: "prompt", type: "agent" },
        { submissionId: "submission_b" },
        async () => {
          await Promise.resolve();
          return getRemoteAgentExecutionSubmissionId();
        }
      ),
    ]);

    expect(seen).toEqual(["submission_a", "submission_b"]);
  });
});

function createRoutineRequest(runId: string) {
  const base = createSubmitTurnRequest();
  return createSubmitTurnRequest({
    author: {
      displayName: "Center Agent",
      profileId: base.agentProfileId,
      profileKind: "agent",
    },
    dispatchId: runId,
    idempotencyKey: runId,
    onBehalfOf: null,
    sourceClientMessageId: null,
    triggerMessageId: runId,
    turnEnvelope: createRoutineTurnEnvelope({
      routineId: "routine_queued",
      runId,
    }),
  });
}

function createAck(submissionId: string) {
  return {
    accepted: true,
    createdAt: TEST_NOW_MS,
    idempotencyKey: submissionId,
    requestId: submissionId,
    status: "pending" as const,
    submissionId,
  };
}

function createSandboxToolDefinition(): RemoteAgentToolDefinition {
  return {
    description: "Execute a command in the hosted sandbox.",
    execute: async () => ({ ok: true }),
    input: object({}),
    name: "sandbox_bash",
  };
}
