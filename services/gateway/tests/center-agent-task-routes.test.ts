import { CENTER_AGENT_TASK_RESPONSE_CONTRACT_VERSION_HEADER } from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import app from "../src/index";

const HUMAN_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const TASK_ID = "task_11111111-1111-4111-8111-111111111111";

const TASK = {
  activeAttemptGeneration: 1,
  createdAt: "2026-08-08T00:00:00.000Z",
  finishedAt: null,
  goal: "Compare competitor onboarding flows.",
  id: TASK_ID,
  organizationId: "org-1",
  origin: { kind: "open_meld" as const },
  requesterUserId: "owner-1",
  status: "running" as const,
  title: "Research competitor onboarding",
  updatedAt: "2026-08-08T00:01:00.000Z",
  version: 2,
};

const DETAIL = {
  attempts: [
    {
      createdAt: "2026-08-08T00:00:00.000Z",
      failureCode: null,
      finishedAt: null,
      generation: 1,
      id: "attempt-1",
      startedAt: "2026-08-08T00:00:01.000Z",
      status: "running" as const,
      taskHandle: {
        deliveryId: "delivery-1",
        kind: "native_delivery" as const,
        v: 1 as const,
      },
      taskId: TASK_ID,
    },
  ],
  events: [
    {
      actor: "requester" as const,
      attemptGeneration: 1,
      id: "event-1",
      kind: "task_created" as const,
      occurredAt: "2026-08-08T00:00:00.000Z",
      taskId: TASK_ID,
      text: "Compare competitor onboarding flows.",
    },
  ],
  task: TASK,
};

type CoreRpcMock = {
  continueCenterAgentTask: ReturnType<typeof vi.fn>;
  getCenterAgentTask: ReturnType<typeof vi.fn>;
  listCenterAgentTasks: ReturnType<typeof vi.fn>;
  retryCenterAgentTask: ReturnType<typeof vi.fn>;
  stopCenterAgentTask: ReturnType<typeof vi.fn>;
};

const TEST_EXECUTION_CONTEXT = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
  props: {},
  exports: {},
} as unknown as ExecutionContext;

describe("Center Agent Task routes", () => {
  it("forwards list, detail, conversation, Stop, and Retry to Core", async () => {
    const { coreRpc, env } = makeEnv();
    const responses = await Promise.all([
      app.fetch(
        new Request(
          "http://local/v1/organizations/current/center-agent/tasks?limit=20"
        ),
        env,
        TEST_EXECUTION_CONTEXT
      ),
      app.fetch(
        new Request(
          `http://local/v1/organizations/current/center-agent/tasks/${TASK_ID}`
        ),
        env,
        TEST_EXECUTION_CONTEXT
      ),
      app.fetch(
        jsonRequest(
          `http://local/v1/organizations/current/center-agent/tasks/${TASK_ID}/messages`,
          {
            expectedVersion: 2,
            idempotencyKey: "message-1",
            text: "Focus on setup friction.",
          }
        ),
        env,
        TEST_EXECUTION_CONTEXT
      ),
      app.fetch(
        jsonRequest(
          `http://local/v1/organizations/current/center-agent/tasks/${TASK_ID}/stop`,
          { expectedVersion: 2 }
        ),
        env,
        TEST_EXECUTION_CONTEXT
      ),
      app.fetch(
        jsonRequest(
          `http://local/v1/organizations/current/center-agent/tasks/${TASK_ID}/retry`,
          { expectedVersion: 2, idempotencyKey: "retry-1" }
        ),
        env,
        TEST_EXECUTION_CONTEXT
      ),
    ]);

    expect(responses.map((response) => response.status)).toEqual([
      200, 200, 200, 200, 200,
    ]);
    expect(coreRpc.listCenterAgentTasks).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 20 })
    );
    expect(coreRpc.listCenterAgentTasks.mock.calls[0]?.[0]).not.toHaveProperty(
      "responseContractVersion"
    );
    expect(coreRpc.getCenterAgentTask).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: TASK_ID })
    );
    expect(coreRpc.continueCenterAgentTask).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 2,
        idempotencyKey: "message-1",
        taskId: TASK_ID,
        text: "Focus on setup friction.",
      })
    );
    expect(coreRpc.stopCenterAgentTask).toHaveBeenCalledWith(
      expect.objectContaining({ expectedVersion: 2, taskId: TASK_ID })
    );
    expect(coreRpc.retryCenterAgentTask).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 2,
        idempotencyKey: "retry-1",
        taskId: TASK_ID,
      })
    );
  });

  it("negotiates the current Task response only for current Web callers", async () => {
    const { coreRpc, env } = makeEnv();
    const headers = {
      [CENTER_AGENT_TASK_RESPONSE_CONTRACT_VERSION_HEADER]: "3",
    };
    const responses = await Promise.all([
      app.fetch(
        new Request(
          "http://local/v1/organizations/current/center-agent/tasks?limit=20",
          { headers }
        ),
        env,
        TEST_EXECUTION_CONTEXT
      ),
      app.fetch(
        jsonRequest(
          `http://local/v1/organizations/current/center-agent/tasks/${TASK_ID}/stop`,
          { expectedVersion: 2 },
          headers
        ),
        env,
        TEST_EXECUTION_CONTEXT
      ),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(coreRpc.listCenterAgentTasks).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 20, responseContractVersion: 3 })
    );
    expect(coreRpc.stopCenterAgentTask).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 2,
        responseContractVersion: 3,
        taskId: TASK_ID,
      })
    );
  });

  it("rejects unsupported Task response versions before calling Core", async () => {
    const { coreRpc, env } = makeEnv();
    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/center-agent/tasks?limit=20",
        {
          headers: {
            [CENTER_AGENT_TASK_RESPONSE_CONTRACT_VERSION_HEADER]: "1",
          },
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(400);
    expect(coreRpc.listCenterAgentTasks).not.toHaveBeenCalled();
  });

  it("rejects unknown mutation fields before calling Core", async () => {
    const { coreRpc, env } = makeEnv();
    const response = await app.fetch(
      jsonRequest(
        `http://local/v1/organizations/current/center-agent/tasks/${TASK_ID}/stop`,
        { expectedVersion: 2, completed: true }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(400);
    expect(coreRpc.stopCenterAgentTask).not.toHaveBeenCalled();
  });
});

function makeEnv() {
  const coreRpc: CoreRpcMock = {
    continueCenterAgentTask: vi.fn(async () => DETAIL),
    getCenterAgentTask: vi.fn(async () => DETAIL),
    listCenterAgentTasks: vi.fn(async () => ({
      nextCursor: null,
      organizationId: "org-1",
      tasks: [TASK],
    })),
    retryCenterAgentTask: vi.fn(async () => DETAIL),
    stopCenterAgentTask: vi.fn(async () => DETAIL),
  };
  const authRpc = {
    resolveProfile: vi.fn(async () => ({
      ok: true,
      resolvedProfile: {
        ownerUserId: "owner-1",
        profileKind: "human",
        profileName: "Mira",
        openMeldProfileId: HUMAN_PROFILE_ID,
      },
    })),
    resolveRequestAuth: vi.fn(async () => ({
      claims: {
        activeOrganizationId: "org-1",
        authenticated: true,
        authMethod: "session",
        ownerIds: ["owner-1"],
        requestId: "req-center-agent-task-route",
      },
      ok: true,
    })),
    resolveRequestAuthWithProfile: vi.fn(async () => ({
      claims: {
        activeOrganizationId: "org-1",
        authenticated: true,
        authMethod: "session",
        ownerIds: ["owner-1"],
        requestId: "req-center-agent-task-route",
      },
      ok: true,
      profile: {
        ok: true,
        resolvedProfile: {
          ownerUserId: "owner-1",
          profileKind: "human",
          profileName: "Mira",
          openMeldProfileId: HUMAN_PROFILE_ID,
        },
      },
    })),
  };
  return {
    coreRpc,
    env: {
      OPENMELD_AUTH_WORKER: authRpc,
      OPENMELD_CORE_WORKER: coreRpc,
    } as unknown as CloudflareBindings,
  };
}

function jsonRequest(
  url: string,
  body: unknown,
  headers?: Record<string, string>
): Request {
  return new Request(url, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
    method: "POST",
  });
}
