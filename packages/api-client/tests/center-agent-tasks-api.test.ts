import {
  CENTER_AGENT_TASK_RESPONSE_CONTRACT_VERSION_HEADER,
  centerAgentTaskDetailSchema,
} from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import {
  buildCenterAgentTaskMessagesPath,
  buildCenterAgentTaskPath,
  buildCenterAgentTaskRetryPath,
  buildCenterAgentTaskStopPath,
  buildCenterAgentTasksPath,
  createCenterAgentTasksApi,
  createOpenMeldApiClient,
  type OpenMeldApiClientTransport,
} from "../src";

const TASK = {
  activeAttemptGeneration: 1,
  createdAt: "2026-08-08T01:00:00.000Z",
  finishedAt: null,
  goal: "Compare the current onboarding flow with three competitors.",
  id: "task/with spaces",
  organizationId: "org-1",
  origin: { kind: "open_meld" as const },
  requesterUserId: "user-1",
  status: "running" as const,
  title: "Research onboarding flows",
  updatedAt: "2026-08-08T01:01:00.000Z",
  version: 2,
};
const RAW_TASK_DETAIL = { attempts: [], events: [], task: TASK };
const TASK_DETAIL = centerAgentTaskDetailSchema.parse(RAW_TASK_DETAIL);

describe("api-client Center Agent Tasks API", () => {
  it("builds encoded canonical Task routes", () => {
    expect(buildCenterAgentTasksPath()).toBe(
      "/v1/organizations/current/center-agent/tasks"
    );
    expect(
      buildCenterAgentTasksPath({
        cursor: "next page",
        limit: 25,
        status: "needs_attention",
      })
    ).toBe(
      "/v1/organizations/current/center-agent/tasks?cursor=next+page&limit=25&status=needs_attention"
    );
    expect(buildCenterAgentTaskPath("task/with spaces")).toBe(
      "/v1/organizations/current/center-agent/tasks/task%2Fwith%20spaces"
    );
    expect(buildCenterAgentTaskMessagesPath("task/with spaces")).toBe(
      "/v1/organizations/current/center-agent/tasks/task%2Fwith%20spaces/messages"
    );
    expect(buildCenterAgentTaskStopPath("task/with spaces")).toBe(
      "/v1/organizations/current/center-agent/tasks/task%2Fwith%20spaces/stop"
    );
    expect(buildCenterAgentTaskRetryPath("task/with spaces")).toBe(
      "/v1/organizations/current/center-agent/tasks/task%2Fwith%20spaces/retry"
    );
  });

  it("uses the shared Task contracts for list, detail, continue, stop, and retry", async () => {
    const transport = vi.fn<OpenMeldApiClientTransport>((call) => {
      const route = `${call.init?.method ?? "GET"} ${new URL(call.url).pathname}`;
      if (route === "GET /v1/organizations/current/center-agent/tasks") {
        return Promise.resolve(
          jsonResponse({
            nextCursor: null,
            organizationId: TASK.organizationId,
            tasks: [TASK],
          })
        );
      }
      return Promise.resolve(jsonResponse(RAW_TASK_DETAIL));
    });
    const api = createCenterAgentTasksApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(api.list()).resolves.toMatchObject({
      tasks: [{ id: TASK.id }],
    });
    await expect(api.get({ taskId: TASK.id })).resolves.toEqual(TASK_DETAIL);
    await expect(
      api.continue({
        expectedVersion: 2,
        idempotencyKey: "continue-1",
        taskId: TASK.id,
        text: "Also include the Slack entry point.",
      })
    ).resolves.toEqual(TASK_DETAIL);
    await expect(
      api.stop({ expectedVersion: 2, taskId: TASK.id })
    ).resolves.toEqual(TASK_DETAIL);
    await expect(
      api.retry({
        expectedVersion: 2,
        idempotencyKey: "retry-1",
        taskId: TASK.id,
      })
    ).resolves.toEqual(TASK_DETAIL);

    expect(
      transport.mock.calls.map(([call]) => ({
        body: call.init?.body,
        responseContractVersion: new Headers(call.init?.headers).get(
          CENTER_AGENT_TASK_RESPONSE_CONTRACT_VERSION_HEADER
        ),
        method: call.init?.method,
        operation: call.operation,
        path: new URL(call.url).pathname,
      }))
    ).toEqual([
      {
        body: undefined,
        method: "GET",
        operation: "center_agent_task.list",
        path: "/v1/organizations/current/center-agent/tasks",
        responseContractVersion: "3",
      },
      {
        body: undefined,
        method: "GET",
        operation: "center_agent_task.get",
        path: "/v1/organizations/current/center-agent/tasks/task%2Fwith%20spaces",
        responseContractVersion: "3",
      },
      {
        body: JSON.stringify({
          expectedVersion: 2,
          idempotencyKey: "continue-1",
          text: "Also include the Slack entry point.",
        }),
        method: "POST",
        operation: "center_agent_task.continue",
        path: "/v1/organizations/current/center-agent/tasks/task%2Fwith%20spaces/messages",
        responseContractVersion: "3",
      },
      {
        body: JSON.stringify({ expectedVersion: 2 }),
        method: "POST",
        operation: "center_agent_task.stop",
        path: "/v1/organizations/current/center-agent/tasks/task%2Fwith%20spaces/stop",
        responseContractVersion: "3",
      },
      {
        body: JSON.stringify({
          expectedVersion: 2,
          idempotencyKey: "retry-1",
        }),
        method: "POST",
        operation: "center_agent_task.retry",
        path: "/v1/organizations/current/center-agent/tasks/task%2Fwith%20spaces/retry",
        responseContractVersion: "3",
      },
    ]);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}
