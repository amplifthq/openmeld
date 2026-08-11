import { CENTER_AGENT_ANONYMOUS_MEMBER_TOOL_NAMES } from "@openmeld/schemas";
import { object } from "valibot";
import { describe, expect, it } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import type { RemoteAgentToolDefinition } from "../agent-core/tool-definition";
import { REMOTE_AGENT_ROUTINE_HIDDEN_TOOL_NAMES } from "../agent-core/tools";
import {
  getRemoteAgentExecutionSubmissionId,
  REMOTE_AGENT_EXECUTION_INSTRUMENTATION,
  resolveRemoteAgentExecutionCallbackContext,
  runWithRemoteAgentSubmissionExecution,
} from "../flue-adapter/execution-context";
import { getRemoteAgentFlueTools } from "../flue-adapter/tools";
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
      await getRemoteAgentFlueTools({
        codeModeRuntime: TEST_CODE_MODE_RUNTIME,
        coreWorker: {},
        env: { LOADER: TEST_CODE_MODE_LOADER },
        storage,
        submissionId: routineContext?.submissionId ?? "missing",
        turnEnvelope: routineContext?.turnEnvelope,
      })
    ).map((tool) => tool.name);
    const ordinaryToolNames = (
      await getRemoteAgentFlueTools({
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
    expect(routineToolNames).toEqual(
      ordinaryToolNames.filter(
        (name) =>
          !REMOTE_AGENT_ROUTINE_HIDDEN_TOOL_NAMES.some(
            (hiddenName) => hiddenName === name
          )
      )
    );
    for (const hiddenName of REMOTE_AGENT_ROUTINE_HIDDEN_TOOL_NAMES) {
      expect(routineToolNames).not.toContain(hiddenName);
      expect(ordinaryToolNames).toContain(hiddenName);
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
      await getRemoteAgentFlueTools({
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
      ...CENTER_AGENT_ANONYMOUS_MEMBER_TOOL_NAMES,
      "codemode",
    ]);
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
      await getRemoteAgentFlueTools({
        codeModeRuntime: TEST_CODE_MODE_RUNTIME,
        coreWorker: {},
        env: { LOADER: TEST_CODE_MODE_LOADER },
        sandboxDefinitions: [createSandboxToolDefinition()],
        storage,
        submissionId: "submission_legacy_participant",
        turnEnvelope: legacyRequest.turnEnvelope,
      })
    ).map((tool) => tool.name);

    expect(toolNames).toEqual(["codemode"]);
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
