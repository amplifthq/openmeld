import { describe, expect, it, vi } from "vitest";
import app from "../src/index";

const SPACE_ID = "space-recovery-1";
const DISPATCH_ID = "dispatch-recovery-1";
const SLACK_CONVERSATION_ID = "C0123456789:1738203600.000100";
const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const TEST_EXECUTION_CONTEXT = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
  props: {},
  exports: {},
} as unknown as ExecutionContext;

const identity = {
  agentControllerConversationId: null,
  agentControllerRef: "builtin:codex",
  attemptId: "attempt-1",
  dispatchId: DISPATCH_ID,
  resultRef: null,
  runtimeCoordinatorExecutionId: "execution-1",
  spaceId: SPACE_ID,
  targetProfileId: "agent-1",
  taskId: "task-1",
};

const destination = {
  spaceId: SPACE_ID,
  surface: "space" as const,
  threadId: null,
};

const slackIdentity = {
  ...identity,
  spaceId: SLACK_CONVERSATION_ID,
};

const slackDestination = {
  conversationId: "C0123456789",
  messageId: "1738203600.000100",
  spaceId: SLACK_CONVERSATION_ID,
  surface: "slack" as const,
};

const recovery = {
  actions: {
    recoverResult: {
      action: "recover_result" as const,
      enabled: false,
      label: "Recover result" as const,
      reasonCode: "execution_recovery.retained_result_unavailable",
      warning: null,
    },
    resumeControllerConversation: {
      action: "resume_controller_conversation" as const,
      enabled: false,
      label: "Continue conversation" as const,
      reasonCode: "execution_recovery.exact_conversation_unavailable",
      warning: null,
    },
    retryAsNewExecution: {
      action: "retry_as_new_execution" as const,
      enabled: true,
      label: "Retry as new execution" as const,
      reasonCode: "execution_recovery.fresh_execution_only",
      warning:
        "This creates a new execution and may run the task again, including external side effects.",
    },
  },
  destination,
  identity,
  recommendedAction: "retry_as_new_execution" as const,
  recoveredPublicationId: null,
  status: "available" as const,
  tier: "fresh_execution" as const,
  updatedAtMs: 1,
};

function makeEnv(input?: { authenticated?: boolean }) {
  const authenticated = input?.authenticated ?? true;
  const authResult = authenticated
    ? {
        claims: {
          authenticated: true as const,
          authMethod: "session" as const,
          ownerIds: ["owner-1"],
          requestId: "request-recovery-1",
        },
        ok: true as const,
        profile: {
          ok: true as const,
          resolvedProfile: {
            ownerUserId: "owner-1",
            profileKind: "human" as const,
            profileName: "Mira",
            openMeldProfileId: PROFILE_ID,
          },
        },
      }
    : {
        code: "auth.unauthenticated" as const,
        message: "Authentication is required.",
        ok: false as const,
      };
  const inspectExecutionRecovery = vi.fn(async () => ({ recovery }));
  const executeExecutionRecovery = vi.fn(async () => ({
    action: "retry_as_new_execution" as const,
    newExecutionId: "fresh-client-message-1",
    operationId: "operation-1",
    publicationId: null,
    reasonCode: "execution_recovery.fresh_execution_requested",
    recovery,
    status: "new_execution_requested" as const,
  }));
  return {
    authRpc: {
      resolveRequestAuthWithProfile: vi.fn(async () => authResult),
    },
    coreRpc: {
      executeExecutionRecovery,
      inspectExecutionRecovery,
    },
    env: {
      OPENMELD_AUTH_WORKER: {
        resolveRequestAuthWithProfile: vi.fn(async () => authResult),
      },
      OPENMELD_CORE_WORKER: {
        executeExecutionRecovery,
        inspectExecutionRecovery,
      },
    } as unknown as CloudflareBindings,
  };
}

describe("execution recovery routes", () => {
  it("forwards authenticated inspect and execute requests with exact path identity", async () => {
    const { coreRpc, env } = makeEnv();
    const inspectResponse = await app.fetch(
      new Request(
        `http://local/v1/spaces/${SPACE_ID}/dispatches/${DISPATCH_ID}/recovery`,
        {
          headers: { "x-openmeld-space-password": "  password-1  " },
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(inspectResponse.status).toBe(200);
    await expect(inspectResponse.json()).resolves.toEqual({ recovery });
    expect(coreRpc.inspectExecutionRecovery).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          actorContext: expect.objectContaining({
            openMeldProfileId: PROFILE_ID,
          }),
        }),
        dispatchId: DISPATCH_ID,
        password: "password-1",
        spaceId: SPACE_ID,
      })
    );

    const body = {
      action: "retry_as_new_execution" as const,
      destination,
      expectedIdentity: identity,
      operationId: "operation-1",
    };
    const executeResponse = await app.fetch(
      new Request(
        `http://local/v1/spaces/${SPACE_ID}/dispatches/${DISPATCH_ID}/recovery`,
        {
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
          method: "POST",
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(executeResponse.status).toBe(200);
    expect(coreRpc.executeExecutionRecovery).toHaveBeenCalledWith(
      expect.objectContaining({
        body,
        context: expect.objectContaining({
          actorContext: expect.objectContaining({
            openMeldProfileId: PROFILE_ID,
          }),
        }),
        spaceId: SPACE_ID,
      })
    );
  });

  it("rejects a path/body dispatch mismatch before calling Core", async () => {
    const { coreRpc, env } = makeEnv();
    const response = await app.fetch(
      new Request(
        `http://local/v1/spaces/${SPACE_ID}/dispatches/${DISPATCH_ID}/recovery`,
        {
          body: JSON.stringify({
            action: "retry_as_new_execution",
            destination,
            expectedIdentity: {
              ...identity,
              dispatchId: "different-dispatch",
            },
            operationId: "operation-1",
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(400);
    expect(coreRpc.executeExecutionRecovery).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated recovery reads and writes before calling Core", async () => {
    const { coreRpc, env } = makeEnv({ authenticated: false });
    for (const method of ["GET", "POST"] as const) {
      const response = await app.fetch(
        new Request(
          `http://local/v1/spaces/${SPACE_ID}/dispatches/${DISPATCH_ID}/recovery`,
          {
            ...(method === "POST"
              ? {
                  body: JSON.stringify({
                    action: "retry_as_new_execution",
                    destination,
                    expectedIdentity: identity,
                    operationId: "operation-1",
                  }),
                  headers: { "content-type": "application/json" },
                }
              : {}),
            method,
          }
        ),
        env,
        TEST_EXECUTION_CONTEXT
      );
      expect(response.status).toBe(401);
    }
    expect(coreRpc.inspectExecutionRecovery).not.toHaveBeenCalled();
    expect(coreRpc.executeExecutionRecovery).not.toHaveBeenCalled();
  });

  it("forwards surface-neutral inspect and execute requests without rewriting the frozen conversation", async () => {
    const { coreRpc, env } = makeEnv();
    const inspectResponse = await app.fetch(
      new Request(
        `http://local/v1/executions/${DISPATCH_ID}/recovery?conversationId=${encodeURIComponent(
          SLACK_CONVERSATION_ID
        )}`
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(inspectResponse.status).toBe(200);
    expect(coreRpc.inspectExecutionRecovery).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          actorContext: expect.objectContaining({
            openMeldProfileId: PROFILE_ID,
          }),
        }),
        dispatchId: DISPATCH_ID,
        spaceId: SLACK_CONVERSATION_ID,
      })
    );

    const body = {
      action: "retry_as_new_execution" as const,
      destination: slackDestination,
      expectedIdentity: slackIdentity,
      operationId: "operation-neutral-1",
    };
    const executeResponse = await app.fetch(
      new Request(
        `http://local/v1/executions/${DISPATCH_ID}/recovery?conversationId=${encodeURIComponent(
          SLACK_CONVERSATION_ID
        )}`,
        {
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
          method: "POST",
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(executeResponse.status).toBe(200);
    expect(coreRpc.executeExecutionRecovery).toHaveBeenCalledWith(
      expect.objectContaining({
        body,
        context: expect.objectContaining({
          actorContext: expect.objectContaining({
            openMeldProfileId: PROFILE_ID,
          }),
        }),
        spaceId: SLACK_CONVERSATION_ID,
      })
    );
  });

  it("rejects surface-neutral path, conversation, and authentication mismatches before Core", async () => {
    const authenticated = makeEnv();
    const wrongDispatch = await app.fetch(
      new Request(
        `http://local/v1/executions/${DISPATCH_ID}/recovery?conversationId=${encodeURIComponent(
          SLACK_CONVERSATION_ID
        )}`,
        {
          body: JSON.stringify({
            action: "retry_as_new_execution",
            destination: slackDestination,
            expectedIdentity: {
              ...slackIdentity,
              dispatchId: "different-dispatch",
            },
            operationId: "operation-neutral-2",
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }
      ),
      authenticated.env,
      TEST_EXECUTION_CONTEXT
    );
    const wrongConversation = await app.fetch(
      new Request(
        `http://local/v1/executions/${DISPATCH_ID}/recovery?conversationId=another-conversation`,
        {
          body: JSON.stringify({
            action: "retry_as_new_execution",
            destination: slackDestination,
            expectedIdentity: slackIdentity,
            operationId: "operation-neutral-3",
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }
      ),
      authenticated.env,
      TEST_EXECUTION_CONTEXT
    );
    const unauthenticated = makeEnv({ authenticated: false });
    const unauthenticatedRead = await app.fetch(
      new Request(
        `http://local/v1/executions/${DISPATCH_ID}/recovery?conversationId=${encodeURIComponent(
          SLACK_CONVERSATION_ID
        )}`
      ),
      unauthenticated.env,
      TEST_EXECUTION_CONTEXT
    );

    expect(wrongDispatch.status).toBe(400);
    expect(wrongConversation.status).toBe(400);
    expect(unauthenticatedRead.status).toBe(401);
    expect(
      authenticated.coreRpc.executeExecutionRecovery
    ).not.toHaveBeenCalled();
    expect(
      unauthenticated.coreRpc.inspectExecutionRecovery
    ).not.toHaveBeenCalled();
  });
});
